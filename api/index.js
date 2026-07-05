import express from "express";
import pg from "pg";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import path from "path";
import dotenv from "dotenv";
import { getNextPhaseId, normalizePhase } from "../lib/followupPhase.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

app.use(cookieParser());
app.use(express.static(path.join(process.cwd(), "public")));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const { Pool } = pg;
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

console.log("✅ Connected to Postgres database");

db.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS designation TEXT`).catch(() => {});
db.query(`ALTER TABLE enquiry ADD COLUMN IF NOT EXISTS fc_confirmed BOOLEAN DEFAULT FALSE`).catch(() => {});
db.query(`ALTER TABLE enquiry ADD COLUMN IF NOT EXISTS is_direct_second_year BOOLEAN DEFAULT FALSE`).catch(() => {});
db.query(`ALTER TABLE enquiries_status ADD COLUMN IF NOT EXISTS followup1_date TIMESTAMPTZ`).catch(() => {});
db.query(`ALTER TABLE enquiries_status ADD COLUMN IF NOT EXISTS followup2_date TIMESTAMPTZ`).catch(() => {});
db.query(`ALTER TABLE enquiries_status ADD COLUMN IF NOT EXISTS followup3_date TIMESTAMPTZ`).catch(() => {});
db.query(`ALTER TABLE enquiries_status ADD COLUMN IF NOT EXISTS followup4_date TIMESTAMPTZ`).catch(() => {});
db.query(`ALTER TABLE enquiries_status ADD COLUMN IF NOT EXISTS followup5_date TIMESTAMPTZ`).catch(() => {});
db.query(`ALTER TABLE enquiries_status ADD COLUMN IF NOT EXISTS followup6_date TIMESTAMPTZ`).catch(() => {});
db.query(`ALTER TABLE enquiries_status ADD COLUMN IF NOT EXISTS followup7_date TIMESTAMPTZ`).catch(() => {});


db.query(`
  CREATE TABLE IF NOT EXISTS data_backups (
    id SERIAL PRIMARY KEY,
    snapshot JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(err => console.error("Backup table init error:", err));

db.query(`
  CREATE TABLE IF NOT EXISTS unavailability_requests (
    id SERIAL PRIMARY KEY,
    staff_name TEXT NOT NULL,
    days INTEGER NOT NULL,
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    admin_note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
  )
`).catch(err => console.error("Table init error:", err));

// ─── JWT Helpers ─────────────────────────────────────────────────────────────

function signToken(user) {
  return jwt.sign(user, JWT_SECRET, { expiresIn: "8h" });
}

function setTokenCookie(res, token) {
  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 8 * 60 * 60 * 1000 // 8 hours
  });
}

function getUser(req) {
  try {
    const token = req.cookies?.token;
    if (!token) return null;
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// ─── Auto Backup ─────────────────────────────────────────────────────────────
// Called fire-and-forget after every write. Stores a full snapshot in
// data_backups so data is recoverable even if rows are accidentally deleted.

async function triggerBackup() {
  try {
    const { rows } = await db.query(`
      SELECT DISTINCT ON (e.student_name)
        e.student_name, e.phone_number, e.department, e.board,
        e.caste, e.annual_income, e.percentage,
        e."AssignedTo", e."CreatedBy",
        e.created_at AS enquiry_created_at,
        COALESCE(e.fc_confirmed, FALSE) AS fc_confirmed,
        s.followup1, s.followup2, s.followup3,
        s.followup4, s.followup5, s.followup6, s.followup7,
        COALESCE(GREATEST(s.followup1_date, s.followup2_date, s.followup3_date, s.followup4_date, s.followup5_date, s.followup6_date, s.followup7_date), s.created_at) AS last_followup_date
      FROM enquiry e
      LEFT JOIN enquiries_status s ON e.student_name = s.student_name
      ORDER BY e.student_name ASC, s.created_at DESC NULLS LAST
    `);
    await db.query(`INSERT INTO data_backups (snapshot) VALUES ($1)`, [JSON.stringify(rows)]);
    // Keep only the 20 most recent snapshots to prevent table bloat
    await db.query(`
      DELETE FROM data_backups
      WHERE id NOT IN (SELECT id FROM data_backups ORDER BY created_at DESC LIMIT 20)
    `);
  } catch (err) {
    console.error("Backup error:", err.message);
  }
}

// ─── Routes ─────────────────────────────────────────────────────────────────-

// Helper to process follow-up saving for a given phase
async function processSaveFollowup(req, res, phase) {
  console.log('processSaveFollowup payload:', req.body);
  const {
    student_name,
    status,
    followup_date,
    branchChange,
    branchChangeBool,
    exitFromSystembool,
    AssignedTo = null
  } = req.body;
  const targetColumn = `followup${phase}`;
  const targetDateColumn = `followup${phase}_date`;

  if (branchChangeBool === true) {
    try {
      const newAssignedStaff = await autoAssignStaff(branchChange);
      await db.query(
        `UPDATE enquiry SET department = $1, "AssignedTo" = $2 WHERE student_name = $3`,
        [branchChange, newAssignedStaff, student_name]
      );
      const { rows: existingRows } = await db.query(
        `SELECT id FROM enquiries_status WHERE student_name = $1`,
        [student_name]
      );
      if (existingRows.length > 0) {
        await db.query(
          `UPDATE enquiries_status SET ${targetColumn} = $1, ${targetDateColumn} = $2, assigned_to = $3 WHERE student_name = $4`,
          [status, followup_date || new Date().toISOString(), newAssignedStaff, student_name]
        );
      }
      triggerBackup();
      return res.status(200).send("Branch and Assigned Staff Updated Successfully");
    } catch (err) {
      console.error(err);
      return res.status(500).send("Database Error");
    }
  } else if (exitFromSystembool === true) {
    try {
      const { rows: rowsEnquiry } = await db.query(
        `SELECT id FROM enquiry WHERE student_name = $1`,
        [student_name]
      );
      if (rowsEnquiry.length > 0) {
        await db.query(`UPDATE enquiry SET "AssignedTo" = 'null' WHERE id = $1`, [rowsEnquiry[0].id]);
      }
      const { rows: rowsStatus } = await db.query(
        `SELECT id FROM enquiries_status WHERE student_name = $1`,
        [student_name]
      );
      if (rowsStatus.length > 0) {
        await db.query(`DELETE FROM enquiries_status WHERE id = $1`, [rowsStatus[0].id]);
      }
      triggerBackup();
      return res.status(200).send("Student exited from system successfully");
    } catch (err) {
      console.error("Exit system error:", err);
      return res.status(500).send("Database Error during exit");
    }
  } else if (status === "Direct 2nd Year Admission" || status === "Shift to Direct 2nd Year Admission") {
    try {
      const { rows: enqRows } = await db.query(`SELECT department FROM enquiry WHERE student_name = $1 LIMIT 1`, [student_name]);
      const dept = enqRows.length > 0 ? enqRows[0].department : null;
      let hodName = null;
      if (dept) {
        const { rows: hodRows } = await db.query(
          `SELECT staff_name FROM staff WHERE department = $1 AND LOWER(designation) = 'hod' LIMIT 1`,
          [dept]
        );
        hodName = hodRows.length > 0 ? hodRows[0].staff_name : null;
      }
      if (!hodName) return res.status(500).send(`No HOD found for department ${dept}`);
      await db.query(`UPDATE enquiry SET "AssignedTo" = $1 WHERE student_name = $2`, [hodName, student_name]);
      const { rows: existingRows } = await db.query(`SELECT id FROM enquiries_status WHERE student_name = $1`, [student_name]);
      if (existingRows.length > 0) {
        await db.query(
          `UPDATE enquiries_status SET ${targetColumn} = $1, ${targetDateColumn} = $2, assigned_to = $3 WHERE student_name = $4`,
          [status, followup_date || new Date().toISOString(), hodName, student_name]
        );
      } else {
        await db.query(
          `INSERT INTO enquiries_status (student_name, ${targetColumn}, ${targetDateColumn}, created_at, assigned_to) VALUES ($1, $2, $3, $4, $5)`,
          [student_name, status, followup_date || new Date().toISOString(), followup_date || new Date().toISOString(), hodName]
        );
      }
      triggerBackup();
      return res.status(200).send("Assigned to HOD");
    } catch (err) {
      console.error(err);
      return res.status(500).send("Database Error during shift to direct 2nd year admission");
    }
  } else if (status === "Shift to Management") {
    try {
      const { rows: mgmtStaff } = await db.query(
        `SELECT staff_name FROM staff WHERE department = 'MANAGEMENT' AND COALESCE(dont_assign, FALSE) = FALSE LIMIT 1`
      );
      const mgmtName = mgmtStaff.length > 0 ? mgmtStaff[0].staff_name : null;
      if (!mgmtName) return res.status(500).send("No management staff available");
      await db.query(`UPDATE enquiry SET "AssignedTo" = $1 WHERE student_name = $2`, [mgmtName, student_name]);
      const { rows: existingRows } = await db.query(`SELECT id FROM enquiries_status WHERE student_name = $1`, [student_name]);
      if (existingRows.length > 0) {
        await db.query(
          `UPDATE enquiries_status SET ${targetColumn} = $1, ${targetDateColumn} = $2, assigned_to = $3 WHERE student_name = $4`,
          [status, followup_date || new Date().toISOString(), mgmtName, student_name]
        );
      } else {
        await db.query(
          `INSERT INTO enquiries_status (student_name, ${targetColumn}, ${targetDateColumn}, created_at, assigned_to) VALUES ($1, $2, $3, $4, $5)`,
          [student_name, status, followup_date || new Date().toISOString(), followup_date || new Date().toISOString(), mgmtName]
        );
      }
      triggerBackup();
      return res.status(200).send("Shifted to Management");
    } catch (err) {
      console.error(err);
      return res.status(500).send("Database Error during shift to management");
    }
  } else if (status === "Management") {
    try {
      const newAssignedStaff = await autoAssignStaff("MANAGEMENT");
      await db.query(`UPDATE enquiry SET "AssignedTo" = $1 WHERE student_name = $2`, [newAssignedStaff, student_name]);
      const { rows: existingRows } = await db.query(`SELECT id FROM enquiries_status WHERE student_name = $1`, [student_name]);
      if (existingRows.length > 0) {
        await db.query(
          `UPDATE enquiries_status SET ${targetColumn} = $1, ${targetDateColumn} = $2, assigned_to = $3 WHERE student_name = $4`,
          [status, followup_date || new Date().toISOString(), newAssignedStaff, student_name]
        );
      } else {
        await db.query(
          `INSERT INTO enquiries_status (student_name, ${targetColumn}, ${targetDateColumn}, created_at, assigned_to) VALUES ($1, $2, $3, $4, $5)`,
          [student_name, status, followup_date || new Date().toISOString(), followup_date || new Date().toISOString(), newAssignedStaff]
        );
      }
      triggerBackup();
      return res.status(200).send("Assigned to Management Staff");
    } catch (err) {
      console.error(err);
      return res.status(500).send("Database Error during Management re-assignment");
    }
  } else {
    try {
      const { rows: existingRows } = await db.query(`SELECT id FROM enquiries_status WHERE student_name = $1`, [student_name]);
      if (existingRows.length > 0) {
        await db.query(
          `UPDATE enquiries_status SET ${targetColumn} = $1, ${targetDateColumn} = $2, assigned_to = $3 WHERE student_name = $4`,
          [status, followup_date || new Date().toISOString(), AssignedTo || 'null', student_name]
        );
        triggerBackup();
        return res.status(200).send(`Updated ${targetColumn}`);
      } else {
        await db.query(
          `INSERT INTO enquiries_status (student_name, ${targetColumn}, ${targetDateColumn}, created_at, assigned_to) VALUES ($1, $2, $3, $4, $5)`
          [student_name, status, followup_date || new Date().toISOString(), followup_date || new Date().toISOString(), AssignedTo || 'null']
        );
        triggerBackup();
        return res.status(200).send(`Inserted into ${targetColumn}`);
      }
    } catch (err) {
      console.error(err);
      res.status(500).send("Database Error");
    }
  }
}

// Original /save-followup route now delegates to helper using the activePhase
app.post("/save-followup", async (req, res) => {
  await syncActivePhaseFromDb();
  await processSaveFollowup(req, res, activePhase);
});

// New endpoint for explicit phase now delegates to helper
app.post("/save-followup/:phase", async (req, res) => {
  const phase = parseInt(req.params.phase, 10);
  if (isNaN(phase) || phase < 1 || phase > 7) {
    return res.status(400).send("Invalid phase");
  }
  await syncActivePhaseFromDb();
  await processSaveFollowup(req, res, phase);
});

app.get("/", (req, res) => {
  res.redirect("/login.html");
});

app.get("/enquiry", (req, res) => {
  const user = getUser(req);
  if (user) {
    res.sendFile(path.join(process.cwd(), "views", "Enquiry.html"));
  } else {
    res.redirect("/login.html");
  }
});

app.get("/admin", (req, res) => {
  const user = getUser(req);
  if (user && user.role === "admin") {
    res.sendFile(path.join(process.cwd(), "views", "admin.html"));
  } else {
    res.redirect("/login.html");
  }
});

app.get("/principal", (req, res) => {
  const user = getUser(req);
  if (user && user.role === "principal") {
    res.sendFile(path.join(process.cwd(), "views", "principal.html"));
  } else {
    res.redirect("/login.html");
  }
});

app.get("/staff-manage", (req, res) => {
  const user = getUser(req);
  if (user && user.role === "admin") {
    res.sendFile(path.join(process.cwd(), "views", "staff-manage.html"));
  } else {
    res.redirect("/login.html");
  }
});

app.get("/fc", (req, res) => {
  const user = getUser(req);
  if (user && user.role === "fc") {
    res.sendFile(path.join(process.cwd(), "views", "fc.html"));
  } else {
    res.redirect("/login.html");
  }
});

app.get("/newenquiry", (req, res) => {
  const user = getUser(req);
  if (user && user.role === "newenquiry") {
    res.sendFile(path.join(process.cwd(), "views", "newenquiry.html"));
  } else {
    res.redirect("/login.html");
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  // Hardcoded Admin
  if (username === "Admin" && password === "Admin@423") {
    const token = signToken({ name: "Admin", department: "ADMIN", role: "admin" });
    setTokenCookie(res, token);
    return res.json({ success: true, redirect: "/admin" });
  }

  // Hardcoded Principal
  if (username === "Principal" && password === "Principal@423") {
    const token = signToken({ name: "Principal", department: "PRINCIPAL", role: "principal" });
    setTokenCookie(res, token);
    return res.json({ success: true, redirect: "/principal" });
  }

  // Hardcoded FC (Facility Center)
  if (username === "Fc3258" && password === "Fc@3258$") {
    const token = signToken({ name: "FC Counselor", department: "FC", role: "fc" });
    setTokenCookie(res, token);
    return res.json({ success: true, redirect: "/fc" });
  }

  // Hardcoded Newenquiry
  if (username === "Newenquiry" && password === "Enquiry@123") {
    const token = signToken({ name: "Newenquiry", department: "ALL", role: "newenquiry" });
    setTokenCookie(res, token);
    return res.json({ success: true, redirect: "/newenquiry" });
  }

  try {
    const { rows } = await db.query(
      "SELECT staff_name, department, COALESCE(designation, '') AS designation FROM staff WHERE username = $1 AND password = $2",
      [username, password]
    );

    if (rows.length > 0) {
      const isHod = rows[0].designation.trim().toLowerCase() === "hod";
      const token = signToken({
        name: rows[0].staff_name,
        department: rows[0].department,
        role: isHod ? "hod" : "staff"
      });
      setTokenCookie(res, token);
      res.json({ success: true, redirect: isHod ? "/hod" : "/enquiry" });
    } else {
      res.json({ success: false });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/" // Explicitly match the path
  });
  res.json({ success: true });
});

app.get("/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/"
  });
  res.redirect("/login.html");
});

app.get("/profile", (req, res) => {
  const user = getUser(req);
  if (user) {
    res.json({ name: user.name, department: user.department, role: user.role });
  } else {
    res.status(401).json({ error: "Not logged in" });
  }
});

app.get("/assignedEnquiries", async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Session expired. Please login again." });
  try {
    const { rows } = await db.query(`
      SELECT DISTINCT ON (e.student_name)
        e.student_name, e.department, e.phone_number, e.percentage, e."CreatedBy",
        s.followup1, s.followup2, s.followup3, s.followup4, s.followup5, s.followup6, s.followup7
      FROM enquiry e
      LEFT JOIN enquiries_status s ON e.student_name = s.student_name
      WHERE LOWER(e."AssignedTo") = LOWER($1)
      ORDER BY e.student_name ASC, s.created_at DESC NULLS LAST
    `, [user.name]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch enquiries" });
  }
});

app.get("/staff/pending-students", async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Session expired. Please login again." });
  try {
    const targetCol = `followup${activePhase}`;
    const { rows } = await db.query(`
      SELECT DISTINCT ON (e.student_name)
        e.student_name, e.department, e.phone_number, e.percentage, e."CreatedBy",
        s.followup1, s.followup2, s.followup3, s.followup4, s.followup5, s.followup6, s.followup7
      FROM enquiry e
      LEFT JOIN enquiries_status s ON e.student_name = s.student_name
      WHERE LOWER(e."AssignedTo") = LOWER($1)
        AND (s.${targetCol} IS NULL OR TRIM(s.${targetCol}) = '' OR s.${targetCol} = 'null')
      ORDER BY e.student_name ASC, s.created_at DESC NULLS LAST
    `, [user.name]);
    res.json({ phase: activePhase, students: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch pending students" });
  }
});

app.get("/followups", async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Session expired. Please login again." });
  try {
    const { rows } = await db.query(
      "SELECT student_name, phone_number FROM enquiry WHERE LOWER(\"AssignedTo\") = LOWER($1)",
      [user.name]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch follow-ups" });
  }
});

// ─── Auto Assign (least-loaded) ───────────────────────────────────────────────
// Always picks the active staff member in the department with the fewest
// currently assigned students, so load stays balanced as students are added.

async function autoAssignStaff(department, isManagement = false) {
  // All management-quota enquiries always go to Snehalatha
  if (isManagement || department === "MANAGEMENT") {
    const { rows } = await db.query(`SELECT staff_name FROM staff WHERE department = 'MANAGEMENT' AND COALESCE(dont_assign, FALSE) = FALSE LIMIT 1`);
    if (rows.length > 0) return rows[0].staff_name;
  }

  let { rows: staffRows } = await db.query(
    `SELECT staff_name FROM staff
     WHERE department = $1 AND COALESCE(dont_assign, FALSE) = FALSE`,
    [department]
  );

  if (staffRows.length === 0) {
    // Fallback: any available staff across all departments
    const { rows: fallback } = await db.query(
      `SELECT staff_name FROM staff WHERE COALESCE(dont_assign, FALSE) = FALSE`
    );
    if (fallback.length === 0) throw new Error("No available staff found for assignment");
    staffRows = fallback;
  }

  const staffNames = staffRows.map(r => r.staff_name);

  // Count current assignments for each candidate (case-insensitive match)
  const { rows: counts } = await db.query(
    `SELECT "AssignedTo", COUNT(*) AS cnt
     FROM enquiry
     WHERE "AssignedTo" = ANY($1::text[])
     GROUP BY "AssignedTo"`,
    [staffNames]
  );

  const countMap = {};
  staffNames.forEach(n => { countMap[n.toLowerCase()] = { name: n, cnt: 0 }; });
  counts.forEach(r => {
    const key = (r.AssignedTo || '').toLowerCase();
    if (countMap[key]) countMap[key].cnt = parseInt(r.cnt);
  });

  // Pick staff with the minimum current assignment count
  return Object.values(countMap).sort((a, b) => a.cnt - b.cnt)[0].name;
}

// ─── Admin Routes ─────────────────────────────────────────────────────────────

app.get("/admin/full-staff-list", async (req, res) => {
  try {
    const { rows } = await db.query("SELECT id, staff_name, username, password, department, dont_assign, COALESCE(designation,'') AS designation FROM staff ORDER BY department, staff_name");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch full staff list" });
  }
});

app.get("/admin/staff-on-break", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "admin") return res.status(401).json({ error: "Unauthorized" });
  try {
    const { rows } = await db.query(
      `SELECT s.id, s.staff_name, s.department, ur.days, ur.reason, ur.resolved_at
       FROM staff s
       LEFT JOIN unavailability_requests ur
         ON LOWER(ur.staff_name) = LOWER(s.staff_name) AND ur.status = 'approved'
       WHERE s.dont_assign = TRUE
       ORDER BY ur.resolved_at DESC NULLS LAST`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

app.post("/admin/update-staff-assignmode", async (req, res) => {
  const { id, dont_assign } = req.body;
  try {
    await db.query("UPDATE staff SET dont_assign = $1 WHERE id = $2", [dont_assign, id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update staff assignment status" });
  }
});

app.post("/admin/update-staff-department", async (req, res) => {
  const { id, department } = req.body;
  try {
    await db.query("UPDATE staff SET department = $1 WHERE id = $2", [department, id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update staff department" });
  }
});

app.post("/EnquirySubmission", async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Session expired. Please login again." });

  try {
    let { studentName, department, phoneNO, percentage, isManagement, is_direct_second_year, caste, annual_income, board, is_fc } = req.body;

    const mgmt = isManagement === true || isManagement === "true";
    const directSecondYear = is_direct_second_year === true || is_direct_second_year === "true";
    if (mgmt) department = "MANAGEMENT";

    let assignedStaff;
    if (directSecondYear) {
      // Direct 2nd year admission always goes to the HOD — ignore dont_assign for HOD lookups
      const { rows: hodRows } = await db.query(
        `SELECT staff_name FROM staff WHERE department = $1 AND LOWER(designation) = 'hod' LIMIT 1`,
        [department]
      );
      if (hodRows.length === 0) {
        return res.status(400).json({ error: `No HOD found for department ${department}. Cannot submit Direct 2nd Year Admission.` });
      }
      assignedStaff = hodRows[0].staff_name;
    } else {
      assignedStaff = await autoAssignStaff(department, mgmt);
    }

    await db.query(
      `INSERT INTO enquiry (student_name, department, phone_number, percentage, "CreatedBy", "AssignedTo", caste, annual_income, board, is_fc, is_direct_second_year)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [studentName, department, phoneNO, percentage, user.name, assignedStaff, caste || null, annual_income || null, board || null, is_fc === true || is_fc === "true" ? true : false, directSecondYear]
    );

    triggerBackup();
    res.json({ success: true, assignedTo: assignedStaff });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to submit enquiry" });
  }
});

app.get("/get-status-history", async (req, res) => {
  const studentName = req.query.name;
  const query = `
    SELECT followup1, followup2, followup3, followup4, followup5, followup6, followup7, 
           followup1_date, followup2_date, followup3_date, followup4_date, followup5_date, followup6_date, followup7_date,
           created_at 
    FROM enquiries_status 
    WHERE student_name = $1`;
  try {
    const { rows } = await db.query(query, [studentName]);
    const normalizedRows = rows.map((row) => {
      const history = [];
      for (let i = 1; i <= 7; i++) {
        const val = row[`followup${i}`];
        if (val && String(val).trim() !== "" && String(val).trim() !== "null") {
          history.push({ phase: i, value: val, created_at: row[`followup${i}_date`] || row.created_at });
        }
      }
      return { ...row, history };
    });
    res.json(normalizedRows);
  } catch (err) {
    console.error("Database error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

let activePhase = 1;

async function syncActivePhaseFromDb() {
  try {
    const { rows } = await db.query("SELECT current_phase FROM app_settings WHERE id = 1");
    if (rows.length > 0) {
      activePhase = normalizePhase(rows[0].current_phase);
    } else {
      activePhase = 1;
    }
  } catch (err) {
    console.error("Phase sync error:", err.message);
  }
}

async function persistActivePhase(nextPhase = activePhase) {
  try {
    const phase = normalizePhase(nextPhase);
    await db.query("INSERT INTO app_settings (id, current_phase) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET current_phase = EXCLUDED.current_phase", [phase]);
    activePhase = phase;
  } catch (err) {
    console.error("Phase persist error:", err.message);
  }
}

app.get("/admin/get-current-phase", async (req, res) => {
  await syncActivePhaseFromDb();
  res.json({ phase: activePhase });
});

app.get("/admin/switch-phase/:num", async (req, res) => {
  const requestedPhase = normalizePhase(req.params.num);
  activePhase = requestedPhase;
  try {
    await persistActivePhase(activePhase);
    res.status(200).json({ message: `Active phase switched to ${activePhase}` });
    } catch (err) {
      console.error(err);
      res.status(500).send("Database Error");
    }
  }
});

// New endpoint for explicit phase
app.post("/save-followup/:phase", async (req, res) => {
  const phase = parseInt(req.params.phase, 10);
  if (isNaN(phase) || phase < 1 || phase > 7) {
    return res.status(400).send("Invalid phase");
  }
  const {
    student_name,
    status,
    followup_date,
    branchChange,
    branchChangeBool,
    exitFromSystembool,
    AssignedTo
  } = req.body;

  await syncActivePhaseFromDb();
  const targetColumn = `followup${phase}`;
  const targetDateColumn = `followup${phase}_date`;

  if (branchChangeBool === true) {
    try {
      const newAssignedStaff = await autoAssignStaff(branchChange);
      await db.query(
        `UPDATE enquiry SET department = $1, "AssignedTo" = $2 WHERE student_name = $3`,
        [branchChange, newAssignedStaff, student_name]
      );
      const { rows: existingRows } = await db.query(
        `SELECT id FROM enquiries_status WHERE student_name = $1`,
        [student_name]
      );
      if (existingRows.length > 0) {
        await db.query(
          `UPDATE enquiries_status SET ${targetColumn} = $1, ${targetDateColumn} = $2, assigned_to = $3 WHERE student_name = $4`,
          [status, followup_date || new Date().toISOString(), newAssignedStaff, student_name]
        );
      }
      triggerBackup();
      return res.status(200).send("Branch and Assigned Staff Updated Successfully");
    } catch (err) {
      console.error(err);
      return res.status(500).send("Database Error");
    }
  } else if (exitFromSystembool === true) {
    try {
      const { rows: rowsEnquiry } = await db.query(
        `SELECT id FROM enquiry WHERE student_name = $1`,
        [student_name]
      );
      if (rowsEnquiry.length > 0) {
        await db.query(`UPDATE enquiry SET "AssignedTo" = 'null' WHERE id = $1`, [rowsEnquiry[0].id]);
      }
      const { rows: rowsStatus } = await db.query(
        `SELECT id FROM enquiries_status WHERE student_name = $1`,
        [student_name]
      );
      if (rowsStatus.length > 0) {
        await db.query(`DELETE FROM enquiries_status WHERE id = $1`, [rowsStatus[0].id]);
      }
      triggerBackup();
      return res.status(200).send("Student exited from system successfully");
    } catch (err) {
      console.error("Exit system error:", err);
      return res.status(500).send("Database Error during exit");
    }
  } else if (status === "Direct 2nd Year Admission" || status === "Shift to Direct 2nd Year Admission") {
    try {
      const { rows: enqRows } = await db.query(
        `SELECT department FROM enquiry WHERE student_name = $1 LIMIT 1`,
        [student_name]
      );
      const dept = enqRows.length > 0 ? enqRows[0].department : null;
      let hodName = null;
      if (dept) {
        const { rows: hodRows } = await db.query(
          `SELECT staff_name FROM staff WHERE department = $1 AND LOWER(designation) = 'hod' LIMIT 1`,
          [dept]
        );
        hodName = hodRows.length > 0 ? hodRows[0].staff_name : null;
      }
      if (!hodName) return res.status(500).send(`No HOD found for department ${dept}`);
      await db.query(`UPDATE enquiry SET "AssignedTo" = $1 WHERE student_name = $2`, [hodName, student_name]);
      const { rows: existingRows } = await db.query(`SELECT id FROM enquiries_status WHERE student_name = $1`, [student_name]);
      if (existingRows.length > 0) {
        await db.query(
          `UPDATE enquiries_status SET ${targetColumn} = $1, ${targetDateColumn} = $2, assigned_to = $3 WHERE student_name = $4`,
          [status, followup_date || new Date().toISOString(), hodName, student_name]
        );
      } else {
        await db.query(
          `INSERT INTO enquiries_status (student_name, ${targetColumn}, ${targetDateColumn}, created_at, assigned_to) VALUES ($1, $2, $3, $4, $5)`,
          [student_name, status, followup_date || new Date().toISOString(), followup_date || new Date().toISOString(), hodName]
        );
      }
      triggerBackup();
      return res.status(200).send("Assigned to HOD");
    } catch (err) {
      console.error(err);
      return res.status(500).send("Database Error during shift to direct 2nd year admission");
    }
  } else if (status === "Shift to Management") {
    try {
      const { rows: mgmtStaff } = await db.query(
        `SELECT staff_name FROM staff WHERE department = 'MANAGEMENT' AND COALESCE(dont_assign, FALSE) = FALSE LIMIT 1`
      );
      const mgmtName = mgmtStaff.length > 0 ? mgmtStaff[0].staff_name : null;
      if (!mgmtName) return res.status(500).send("No management staff available");
      await db.query(`UPDATE enquiry SET "AssignedTo" = $1 WHERE student_name = $2`, [mgmtName, student_name]);
      const { rows: existingRows } = await db.query(`SELECT id FROM enquiries_status WHERE student_name = $1`, [student_name]);
      if (existingRows.length > 0) {
        await db.query(
          `UPDATE enquiries_status SET ${targetColumn} = $1, ${targetDateColumn} = $2, assigned_to = $3 WHERE student_name = $4`,
          [status, followup_date || new Date().toISOString(), mgmtName, student_name]
        );
      } else {
        await db.query(
          `INSERT INTO enquiries_status (student_name, ${targetColumn}, ${targetDateColumn}, created_at, assigned_to) VALUES ($1, $2, $3, $4, $5)`,
          [student_name, status, followup_date || new Date().toISOString(), followup_date || new Date().toISOString(), mgmtName]
        );
      }
      triggerBackup();
      return res.status(200).send("Shifted to Management");
    } catch (err) {
      console.error(err);
      return res.status(500).send("Database Error during shift to management");
    }
  } else if (status === "Management") {
    try {
      const newAssignedStaff = await autoAssignStaff("MANAGEMENT");
      await db.query(`UPDATE enquiry SET "AssignedTo" = $1 WHERE student_name = $2`, [newAssignedStaff, student_name]);
      const { rows: existingRows } = await db.query(`SELECT id FROM enquiries_status WHERE student_name = $1`, [student_name]);
      if (existingRows.length > 0) {
        await db.query(
          `UPDATE enquiries_status SET ${targetColumn} = $1, ${targetDateColumn} = $2, assigned_to = $3 WHERE student_name = $4`,
          [status, followup_date || new Date().toISOString(), newAssignedStaff, student_name]
        );
      } else {
        await db.query(
          `INSERT INTO enquiries_status (student_name, ${targetColumn}, ${targetDateColumn}, created_at, assigned_to) VALUES ($1, $2, $3, $4, $5)`,
          [student_name, status, followup_date || new Date().toISOString(), followup_date || new Date().toISOString(), newAssignedStaff]
        );
      }
      triggerBackup();
      return res.status(200).send("Assigned to Management Staff");
    } catch (err) {
      console.error(err);
      return res.status(500).send("Database Error during Management re-assignment");
    }
  } else {
    try {
      const { rows: existingRows } = await db.query(`SELECT id FROM enquiries_status WHERE student_name = $1`, [student_name]);
      if (existingRows.length > 0) {
        await db.query(
          `UPDATE enquiries_status SET ${targetColumn} = $1, ${targetDateColumn} = $2, assigned_to = $3 WHERE student_name = $4`,
          [status, followup_date || new Date().toISOString(), AssignedTo, student_name]
        );
        triggerBackup();
        return res.status(200).send(`Updated ${targetColumn}`);
      } else {
        await db.query(
          `INSERT INTO enquiries_status (student_name, ${targetColumn}, ${targetDateColumn}, created_at, assigned_to) VALUES ($1, $2, $3, $4, $5)`,
          [student_name, status, followup_date || new Date().toISOString(), followup_date || new Date().toISOString(), AssignedTo]
        );
        triggerBackup();
        return res.status(200).send(`Inserted into ${targetColumn}`);
      }
    } catch (err) {
      console.error(err);
      res.status(500).send("Database Error");
    }
  }
});

app.get("/view-all-status", async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT ON (e.student_name)
        e.student_name, e.phone_number, e.department, e.board,
        e.caste, e.annual_income, e.percentage,
        e."AssignedTo", e."CreatedBy",
        e.created_at AS enquiry_created_at,
        COALESCE(e.fc_confirmed, FALSE) AS fc_confirmed,
        s.followup1, s.followup2, s.followup3,
        s.followup4, s.followup5, s.followup6, s.followup7,
        COALESCE(GREATEST(s.followup1_date, s.followup2_date, s.followup3_date, s.followup4_date, s.followup5_date, s.followup6_date, s.followup7_date), s.created_at) AS created_at
      FROM enquiry e
      LEFT JOIN enquiries_status s ON e.student_name = s.student_name
      ORDER BY e.student_name ASC, s.created_at DESC NULLS LAST
    `;
    const { rows } = await db.query(query);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch status table" });
  }
});

app.get("/admin/staff-list", async (req, res) => {
  try {
    const department = req.query.department;
    let rows;
    if (department) {
      const result = await db.query("SELECT staff_name FROM staff WHERE department = $1", [department]);
      rows = result.rows;
    } else {
      const result = await db.query("SELECT staff_name FROM staff");
      rows = result.rows;
    }
    res.json(rows.map(r => r.staff_name));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch staff list" });
  }
});

app.post("/admin/update-assigned", async (req, res) => {
  const { student_name, AssignedTo } = req.body;
  if (!student_name) return res.status(400).json({ error: "student_name required" });
  try {
    await db.query(`UPDATE enquiry SET "AssignedTo" = $1 WHERE student_name = $2`, [AssignedTo, student_name]);
    await db.query("UPDATE enquiries_status SET assigned_to = $1 WHERE student_name = $2", [AssignedTo, student_name]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update assignment" });
  }
});

// Students flagged as Invalid Number in any followup
app.get("/admin/invalid-numbers", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "admin") return res.status(401).json({ error: "Unauthorized" });
  try {
    const { rows } = await db.query(`
      SELECT DISTINCT ON (e.student_name)
        e.student_name, e.phone_number, e.department, e."AssignedTo",
        s.followup1, s.followup2, s.followup3, s.followup4, s.followup5, s.followup6, s.followup7
      FROM enquiry e
      LEFT JOIN enquiries_status s ON e.student_name = s.student_name
      WHERE 'Invalid Number' IN (s.followup1, s.followup2, s.followup3, s.followup4, s.followup5, s.followup6, s.followup7)
      ORDER BY e.student_name ASC, s.created_at DESC NULLS LAST
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch invalid numbers" });
  }
});

app.post("/admin/fix-phone", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "admin") return res.status(401).json({ error: "Unauthorized" });
  const { student_name, phone_number } = req.body;
  if (!student_name || !phone_number) return res.status(400).json({ error: "student_name and phone_number required" });
  try {
    await db.query(`UPDATE enquiry SET phone_number = $1 WHERE student_name = $2`, [phone_number, student_name]);
    triggerBackup();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update phone number" });
  }
});

app.post("/admin/update-department", async (req, res) => {
  const { student_name, department } = req.body;
  if (!student_name || !department) return res.status(400).json({ error: "student_name and department required" });
  try {
    const newAssigned = await autoAssignStaff(department);
    await db.query(`UPDATE enquiry SET department = $1, "AssignedTo" = $2 WHERE student_name = $3`, [department, newAssigned, student_name]);
    await db.query("UPDATE enquiries_status SET assigned_to = $1 WHERE student_name = $2", [newAssigned, student_name]);
    res.json({ success: true, AssignedTo: newAssigned });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update department" });
  }
});

app.post("/admin/delete-entry", async (req, res) => {
  const { student_name } = req.body;
  if (!student_name) return res.status(400).json({ error: "student_name required" });
  try {
    await db.query("DELETE FROM enquiries_status WHERE student_name = $1", [student_name]);
    await db.query("DELETE FROM enquiry WHERE student_name = $1", [student_name]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete entry" });
  }
});

app.get("/admin/assigned-values", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "admin") return res.status(401).json({ error: "Unauthorized" });
  try {
    const { rows: assigned } = await db.query(`
      SELECT "AssignedTo", COUNT(*) AS count
      FROM enquiry
      WHERE "AssignedTo" IS NOT NULL AND "AssignedTo" != ''
      GROUP BY "AssignedTo"
      ORDER BY count DESC
    `);
    const { rows: staff } = await db.query(
      "SELECT staff_name FROM staff ORDER BY staff_name"
    );
    res.json({ assigned, staff: staff.map(s => s.staff_name) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch assignment values" });
  }
});

app.post("/admin/remap-assignment", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "admin") return res.status(401).json({ error: "Unauthorized" });
  const { from_name, to_name } = req.body;
  if (!from_name || !to_name) return res.status(400).json({ error: "from_name and to_name required" });
  try {
    const r1 = await db.query(
      `UPDATE enquiry SET "AssignedTo" = $1 WHERE "AssignedTo" = $2`,
      [to_name, from_name]
    );
    const r2 = await db.query(
      `UPDATE enquiries_status SET assigned_to = $1 WHERE assigned_to = $2`,
      [to_name, from_name]
    );
    res.json({ success: true, updated: r1.rowCount + r2.rowCount, enquiry: r1.rowCount, status: r2.rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to remap" });
  }
});

app.post("/admin/sync-status-assignments", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "admin") return res.status(401).json({ error: "Unauthorized" });
  try {
    const result = await db.query(`
      UPDATE enquiries_status es
      SET assigned_to = e."AssignedTo"
      FROM enquiry e
      WHERE es.student_name = e.student_name
        AND e."AssignedTo" IS NOT NULL
        AND e."AssignedTo" != ''
        AND (es.assigned_to IS DISTINCT FROM e."AssignedTo")
    `);
    res.json({ success: true, updated: result.rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to sync status assignments" });
  }
});

app.post("/admin/create-staff", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "admin") return res.status(401).json({ error: "Unauthorized" });
  const { staff_name, username, password, department } = req.body;
  if (!staff_name || !username || !password || !department)
    return res.status(400).json({ error: "All fields required" });
  try {
    const { rows } = await db.query(
      "INSERT INTO staff (staff_name, username, password, department, dont_assign) VALUES ($1, $2, $3, $4, FALSE) RETURNING id",
      [staff_name, username, password, department]
    );
    res.json({ success: true, id: rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create staff" });
  }
});

app.post("/admin/delete-staff", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "admin") return res.status(401).json({ error: "Unauthorized" });
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "id required" });
  try {
    await db.query("DELETE FROM staff WHERE id = $1", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete staff" });
  }
});

app.post("/admin/update-staff", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "admin") return res.status(401).json({ error: "Unauthorized" });
  const { id, staff_name, username, password, department } = req.body;
  if (!id) return res.status(400).json({ error: "id required" });
  try {
    await db.query(
      "UPDATE staff SET staff_name=$1, username=$2, password=$3, department=$4 WHERE id=$5",
      [staff_name, username, password, department, id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update staff" });
  }
});

// ─── FC (Facility Center) Routes ─────────────────────────────────────────

app.get("/fc/all-students", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "fc") return res.status(401).json({ error: "Unauthorized" });
  const search = req.query.search || "";
  try {
    const query = `
      SELECT
        e.student_name, e.department, e.phone_number, e.percentage,
        e."CreatedBy", e."AssignedTo", e.created_at, e.caste, e.annual_income, e.board,
        COALESCE(e.fc_confirmed, FALSE) AS fc_confirmed,
        s.followup1, s.followup2, s.followup3, s.followup4,
        s.followup5, s.followup6, s.followup7
      FROM enquiry e
      LEFT JOIN enquiries_status s ON e.student_name = s.student_name
      WHERE
        e.student_name ILIKE $1 OR
        e.phone_number ILIKE $1 OR
        e.department ILIKE $1 OR
        e."AssignedTo" ILIKE $1
      ORDER BY e.created_at DESC
    `;
    const { rows } = await db.query(query, [`%${search}%`]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch students" });
  }
});

app.post("/fc/confirm-admission", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "fc") return res.status(401).json({ error: "Unauthorized" });
  const { student_name } = req.body;
  if (!student_name) return res.status(400).json({ error: "student_name required" });
  try {
    await db.query(
      `UPDATE enquiry SET fc_confirmed = TRUE WHERE student_name = $1`,
      [student_name]
    );
    triggerBackup();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to confirm admission" });
  }
});

app.put("/fc/update-student", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "fc") return res.status(401).json({ error: "Unauthorized" });
  const {
    original_name, student_name, department, phone_number, percentage, assigned_to,
    caste, annual_income, board, fu_phase, fu_value
  } = req.body;
  if (!original_name) return res.status(400).json({ error: "original_name required" });

  const phase = parseInt(fu_phase);
  const validPhase = phase >= 1 && phase <= 7;
  const col = validPhase ? `followup${phase}` : null;
  const fuVal = fu_value && fu_value.trim() !== "" ? fu_value.trim() : null;

  // Determine effective AssignedTo — shift actions override the typed value
  let effectiveAssignedTo = assigned_to;
  try {
    if (fuVal === "Shift to Management") {
      const { rows } = await db.query(`SELECT staff_name FROM staff WHERE department = 'MANAGEMENT' AND COALESCE(dont_assign, FALSE) = FALSE LIMIT 1`);
      if (rows.length > 0) effectiveAssignedTo = rows[0].staff_name;
    } else if (fuVal === "Shift to Direct 2nd Year Admission" || fuVal === "Direct 2nd Year Admission") {
      const { rows: enqRows } = await db.query(`SELECT department FROM enquiry WHERE student_name = $1 LIMIT 1`, [original_name]);
      const dept = enqRows.length > 0 ? enqRows[0].department : department;
      const { rows: hodRows } = await db.query(
        `SELECT staff_name FROM staff WHERE department = $1 AND LOWER(designation) = 'hod' LIMIT 1`,
        [dept]
      );
      if (hodRows.length > 0) effectiveAssignedTo = hodRows[0].staff_name;
    }
  } catch (lookupErr) {
    console.error("Shift lookup error:", lookupErr.message);
  }

  try {
    await db.query(
      `UPDATE enquiry SET student_name=$1, department=$2, phone_number=$3, percentage=$4, "AssignedTo"=$5, caste=$6, annual_income=$7, board=$8 WHERE student_name=$9`,
      [student_name, department, phone_number, percentage, effectiveAssignedTo, caste || null, annual_income || null, board || null, original_name]
    );

    if (col) {
      const { rows: existing } = await db.query(
        `SELECT student_name FROM enquiries_status WHERE student_name = $1`,
        [original_name]
      );
      if (existing.length > 0) {
        await db.query(
          `UPDATE enquiries_status SET student_name=$1, assigned_to=$2, ${col}=$3 WHERE student_name=$4`,
          [student_name, effectiveAssignedTo, fuVal, original_name]
        );
      } else if (fuVal) {
        await db.query(
          `INSERT INTO enquiries_status (student_name, assigned_to, ${col}) VALUES ($1, $2, $3)`,
          [student_name, effectiveAssignedTo, fuVal]
        );
      }
    } else {
      await db.query(
        `UPDATE enquiries_status SET student_name=$1, assigned_to=$2 WHERE student_name=$3`,
        [student_name, effectiveAssignedTo, original_name]
      );
    }

    triggerBackup();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update student" });
  }
});

// ─── HOD Routes ──────────────────────────────────────────────────────────────

app.get("/hod", (req, res) => {
  const user = getUser(req);
  if (user && user.role === "hod") {
    res.sendFile(path.join(process.cwd(), "views", "hod.html"));
  } else {
    res.redirect("/login.html");
  }
});

app.get("/hod/summary", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "hod") return res.status(401).json({ error: "Unauthorized" });
  try {
    const dept = user.department;
    const { rows: students } = await db.query(
      `SELECT e.student_name, e."AssignedTo", s.followup1, s.followup2, s.followup3, s.followup4, s.followup5, s.followup6, s.followup7
       FROM enquiry e LEFT JOIN enquiries_status s ON e.student_name = s.student_name
       WHERE e.department = $1 ORDER BY e.created_at DESC`,
      [dept]
    );
    const { rows: staff } = await db.query(
      "SELECT id, staff_name, username, password, department, dont_assign FROM staff WHERE department = $1 ORDER BY staff_name",
      [dept]
    );
    res.json({ students, staff, department: dept });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch HOD summary" });
  }
});

app.get("/hod/unavailability-requests", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "hod") return res.status(401).json({ error: "Unauthorized" });
  try {
    const { rows: staffNames } = await db.query(
      "SELECT staff_name FROM staff WHERE department = $1",
      [user.department]
    );
    const names = staffNames.map(s => s.staff_name);
    if (names.length === 0) return res.json([]);
    const { rows } = await db.query(
      `SELECT * FROM unavailability_requests WHERE status = 'pending' AND staff_name = ANY($1) ORDER BY created_at ASC`,
      [names]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch requests" });
  }
});

app.post("/hod/unavailability-approve", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "hod") return res.status(401).json({ error: "Unauthorized" });
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "id required" });
  try {
    const { rows } = await db.query(
      `UPDATE unavailability_requests SET status = 'approved', resolved_at = NOW() WHERE id = $1 RETURNING staff_name, days`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Request not found" });
    const { staff_name, days } = rows[0];
    await db.query(`UPDATE staff SET dont_assign = TRUE WHERE LOWER(staff_name) = LOWER($1)`, [staff_name]);

    const { rows: students } = await db.query(
      `SELECT student_name FROM enquiry WHERE LOWER("AssignedTo") = LOWER($1)`, [staff_name]
    );

    let reassigned = 0;
    const { rows: avail } = await db.query(
      `SELECT staff_name FROM staff WHERE department = $1 AND COALESCE(dont_assign, FALSE) = FALSE AND LOWER(staff_name) != LOWER($2)`,
      [user.department, staff_name]
    );
    if (avail.length > 0 && students.length > 0) {
      for (let i = 0; i < students.length; i++) {
        const newStaff = avail[i % avail.length].staff_name;
        await db.query(`UPDATE enquiry SET "AssignedTo" = $1 WHERE LOWER(student_name) = LOWER($2)`, [newStaff, students[i].student_name]);
        await db.query(`UPDATE enquiries_status SET assigned_to = $1 WHERE LOWER(student_name) = LOWER($2)`, [newStaff, students[i].student_name]);
        reassigned++;
      }
    }
    res.json({ success: true, staff_name, days, reassigned, total: students.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to approve" });
  }
});

app.get("/hod/staff-on-break", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "hod") return res.status(401).json({ error: "Unauthorized" });
  try {
    const { rows } = await db.query(
      `SELECT s.id, s.staff_name, ur.days, ur.reason, ur.resolved_at
       FROM staff s
       LEFT JOIN unavailability_requests ur
         ON LOWER(ur.staff_name) = LOWER(s.staff_name) AND ur.status = 'approved'
       WHERE s.dont_assign = TRUE AND s.department = $1
       ORDER BY ur.resolved_at DESC NULLS LAST`,
      [user.department]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

app.post("/hod/unavailability-reject", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "hod") return res.status(401).json({ error: "Unauthorized" });
  const { id, admin_note } = req.body;
  if (!id) return res.status(400).json({ error: "id required" });
  try {
    await db.query(
      `UPDATE unavailability_requests SET status = 'rejected', admin_note = $1, resolved_at = NOW() WHERE id = $2`,
      [admin_note || "", id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to reject" });
  }
});

app.post("/hod/create-staff", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "hod") return res.status(401).json({ error: "Unauthorized" });
  const { staff_name, username, password } = req.body;
  if (!staff_name || !username || !password) return res.status(400).json({ error: "All fields required" });
  try {
    const { rows } = await db.query(
      "INSERT INTO staff (staff_name, username, password, department, dont_assign) VALUES ($1, $2, $3, $4, FALSE) RETURNING id",
      [staff_name, username, password, user.department]
    );
    res.json({ success: true, id: rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create staff" });
  }
});

app.post("/hod/update-staff", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "hod") return res.status(401).json({ error: "Unauthorized" });
  const { id, staff_name, username, password } = req.body;
  if (!id || !staff_name || !username || !password) return res.status(400).json({ error: "All fields required" });
  try {
    await db.query(
      "UPDATE staff SET staff_name=$1, username=$2, password=$3 WHERE id=$4 AND department=$5",
      [staff_name, username, password, id, user.department]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update staff" });
  }
});

app.post("/hod/delete-staff", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "hod") return res.status(401).json({ error: "Unauthorized" });
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "id required" });
  try {
    await db.query("DELETE FROM staff WHERE id = $1 AND department = $2", [id, user.department]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete staff" });
  }
});

app.post("/hod/update-assigned", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "hod") return res.status(401).json({ error: "Unauthorized" });
  const { student_name, AssignedTo } = req.body;
  if (!student_name) return res.status(400).json({ error: "student_name required" });
  try {
    await db.query(`UPDATE enquiry SET "AssignedTo" = $1 WHERE student_name = $2 AND department = $3`, [AssignedTo, student_name, user.department]);
    await db.query("UPDATE enquiries_status SET assigned_to = $1 WHERE student_name = $2", [AssignedTo, student_name]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update assignment" });
  }
});

app.post("/hod/toggle-assign", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "hod") return res.status(401).json({ error: "Unauthorized" });
  const { id, dont_assign } = req.body;
  try {
    await db.query("UPDATE staff SET dont_assign = $1 WHERE id = $2 AND department = $3", [dont_assign, id, user.department]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update" });
  }
});

// ─── Unavailability Request Routes ───────────────────────────────────────────

app.post("/staff/unavailability-request", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "staff") return res.status(401).json({ error: "Unauthorized" });
  const { days, reason } = req.body;
  if (!days || !reason || isNaN(parseInt(days))) return res.status(400).json({ error: "days and reason required" });
  try {
    await db.query(
      `UPDATE unavailability_requests SET status = 'withdrawn' WHERE staff_name = $1 AND status = 'pending'`,
      [user.name]
    );
    const { rows } = await db.query(
      `INSERT INTO unavailability_requests (staff_name, days, reason) VALUES ($1, $2, $3) RETURNING id`,
      [user.name, parseInt(days), reason.trim()]
    );
    res.json({ success: true, id: rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to submit request" });
  }
});

app.get("/staff/my-unavailability-status", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "staff") return res.status(401).json({ error: "Unauthorized" });
  try {
    const { rows } = await db.query(
      `SELECT * FROM unavailability_requests WHERE staff_name = $1 ORDER BY created_at DESC LIMIT 1`,
      [user.name]
    );
    res.json(rows[0] || null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch status" });
  }
});

app.get("/admin/unavailability-requests", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "admin") return res.status(401).json({ error: "Unauthorized" });
  try {
    const { rows } = await db.query(
      `SELECT * FROM unavailability_requests WHERE status = 'pending' ORDER BY created_at ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch requests" });
  }
});

app.post("/admin/unavailability-approve", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "admin") return res.status(401).json({ error: "Unauthorized" });
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "id required" });
  try {
    const { rows } = await db.query(
      `UPDATE unavailability_requests SET status = 'approved', resolved_at = NOW() WHERE id = $1 RETURNING staff_name, days`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Request not found" });
    const { staff_name, days } = rows[0];
    await db.query(`UPDATE staff SET dont_assign = TRUE WHERE LOWER(staff_name) = LOWER($1)`, [staff_name]);

    // Get department of the staff member
    const { rows: deptRows } = await db.query(
      `SELECT department FROM staff WHERE LOWER(staff_name) = LOWER($1) LIMIT 1`, [staff_name]
    );
    const department = deptRows[0]?.department || null;

    // Get students assigned to this staff
    const { rows: students } = await db.query(
      `SELECT student_name FROM enquiry WHERE LOWER("AssignedTo") = LOWER($1)`, [staff_name]
    );

    let reassigned = 0;
    if (students.length > 0 && department) {
      // Get available staff in same department
      const { rows: avail } = await db.query(
        `SELECT staff_name FROM staff WHERE department = $1 AND COALESCE(dont_assign, FALSE) = FALSE AND LOWER(staff_name) != LOWER($2)`,
        [department, staff_name]
      );
      if (avail.length > 0) {
        for (let i = 0; i < students.length; i++) {
          const newStaff = avail[i % avail.length].staff_name;
          await db.query(`UPDATE enquiry SET "AssignedTo" = $1 WHERE LOWER(student_name) = LOWER($2)`, [newStaff, students[i].student_name]);
          await db.query(`UPDATE enquiries_status SET assigned_to = $1 WHERE LOWER(student_name) = LOWER($2)`, [newStaff, students[i].student_name]);
          reassigned++;
        }
      }
    }
    res.json({ success: true, staff_name, days, reassigned, total: students.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to approve request" });
  }
});

app.post("/admin/unavailability-reject", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "admin") return res.status(401).json({ error: "Unauthorized" });
  const { id, admin_note } = req.body;
  if (!id) return res.status(400).json({ error: "id required" });
  try {
    await db.query(
      `UPDATE unavailability_requests SET status = 'rejected', admin_note = $1, resolved_at = NOW() WHERE id = $2`,
      [admin_note || "", id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to reject request" });
  }
});

// ─── Staff Progress ───────────────────────────────────────────────────────────

app.get("/admin/staff-progress", async (req, res) => {
  const user = getUser(req);
  if (!user || (user.role !== "admin" && user.role !== "principal")) return res.status(401).json({ error: "Unauthorized" });
  try {
    const { rows } = await db.query(`
      SELECT
        s.staff_name,
        s.department,
        COALESCE(s.dont_assign, FALSE) AS dont_assign,
        COUNT(DISTINCT e.id) AS total_assigned,
        COUNT(DISTINCT CASE
          WHEN (es.followup1 IS NOT NULL AND es.followup1 NOT IN ('', 'null'))
            OR (es.followup2 IS NOT NULL AND es.followup2 NOT IN ('', 'null'))
            OR (es.followup3 IS NOT NULL AND es.followup3 NOT IN ('', 'null'))
            OR (es.followup4 IS NOT NULL AND es.followup4 NOT IN ('', 'null'))
            OR (es.followup5 IS NOT NULL AND es.followup5 NOT IN ('', 'null'))
            OR (es.followup6 IS NOT NULL AND es.followup6 NOT IN ('', 'null'))
            OR (es.followup7 IS NOT NULL AND es.followup7 NOT IN ('', 'null'))
          THEN e.id
        END) AS followup_done
      FROM staff s
      LEFT JOIN enquiry e ON LOWER(e."AssignedTo") = LOWER(s.staff_name)
      LEFT JOIN enquiries_status es ON e.student_name = es.student_name
      GROUP BY s.staff_name, s.department, s.dont_assign
      ORDER BY s.department, COUNT(DISTINCT e.id) DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch staff progress" });
  }
});

// ─── Admin: Rebalance Assignments ────────────────────────────────────────────
// Re-distributes all assigned students across active staff per department
// so that every staff member ends up with floor(n/k) or ceil(n/k) students.

app.post("/admin/rebalance-assignments", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "admin") return res.status(401).json({ error: "Unauthorized" });
  try {
    const departments = ["AN", "TE", "CE", "ME", "AE", "MANAGEMENT"];
    let totalUpdated = 0;
    const summary = [];

    for (const dept of departments) {
      // Get all students in this department (those already assigned to a dept staff)
      const { rows: students } = await db.query(
        `SELECT student_name FROM enquiry WHERE department = $1
         ORDER BY student_name ASC`,
        [dept]
      );
      if (students.length === 0) continue;

      const { rows: staffRows } = await db.query(
        `SELECT staff_name FROM staff
         WHERE department = $1 AND COALESCE(dont_assign, FALSE) = FALSE
         ORDER BY staff_name ASC`,
        [dept]
      );
      if (staffRows.length === 0) continue;

      const staffNames = staffRows.map(r => r.staff_name);
      const n = students.length;
      const k = staffNames.length;

      // Distribute evenly: first (n % k) staff get (floor + 1), rest get floor
      const base = Math.floor(n / k);
      const extra = n % k;
      const targets = staffNames.map((name, i) => ({ name, target: base + (i < extra ? 1 : 0) }));

      // Assign students round by target quota
      let studentIdx = 0;
      for (const { name, target } of targets) {
        for (let i = 0; i < target; i++) {
          const sName = students[studentIdx++].student_name;
          await db.query(`UPDATE enquiry SET "AssignedTo" = $1 WHERE student_name = $2`, [name, sName]);
          await db.query(`UPDATE enquiries_status SET assigned_to = $1 WHERE student_name = $2`, [name, sName]);
          totalUpdated++;
        }
      }

      summary.push({ dept, students: n, staff: k, perStaff: `${base}–${base + (extra > 0 ? 1 : 0)}` });
    }

    res.json({ success: true, totalUpdated, summary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to rebalance assignments" });
  }
});

// ─── Newenquiry Routes ────────────────────────────────────────────────────────

app.get("/newenquiry/my-enquiries", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "newenquiry") return res.status(401).json({ error: "Unauthorized" });
  try {
    const { rows } = await db.query(
      `SELECT student_name, phone_number, department, percentage, board, caste, annual_income,
              "AssignedTo", "CreatedBy", created_at,
              COALESCE(is_direct_second_year, FALSE) AS is_direct_second_year
       FROM enquiry
       WHERE LOWER("CreatedBy") = LOWER('Newenquiry')
       ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch enquiries" });
  }
});

app.post("/newenquiry/edit-enquiry", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "newenquiry") return res.status(401).json({ error: "Unauthorized" });
  const { original_name, student_name, phone_number, department, percentage, board, caste, annual_income } = req.body;
  if (!original_name) return res.status(400).json({ error: "original_name required" });
  try {
    const newStaff = await autoAssignStaff(department);
    await db.query(
      `UPDATE enquiry SET student_name=$1, phone_number=$2, department=$3, percentage=$4, board=$5, caste=$6, annual_income=$7, "AssignedTo"=$8
       WHERE student_name=$9 AND LOWER("CreatedBy") = LOWER('Newenquiry')`,
      [student_name, phone_number, department, percentage || null, board || null, caste || null, annual_income || null, newStaff, original_name]
    );
    await db.query(
      `UPDATE enquiries_status SET student_name=$1, assigned_to=$2 WHERE student_name=$3`,
      [student_name, newStaff, original_name]
    );
    res.json({ success: true, assignedTo: newStaff });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to edit enquiry" });
  }
});

// ─── Admin: Assign Unassigned Students ───────────────────────────────────────

app.post("/admin/assign-unassigned", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "admin") return res.status(401).json({ error: "Unauthorized" });
  try {
    const { rows: unassigned } = await db.query(
      `SELECT student_name, department FROM enquiry
       WHERE "AssignedTo" IS NULL OR TRIM("AssignedTo") = '' OR TRIM("AssignedTo") = 'null'`
    );
    if (unassigned.length === 0) {
      return res.json({ success: true, assigned: 0, message: "No unassigned students found" });
    }
    let assignedCount = 0;
    const errors = [];
    for (const student of unassigned) {
      try {
        const staffName = await autoAssignStaff(student.department);
        await db.query(`UPDATE enquiry SET "AssignedTo" = $1 WHERE student_name = $2`, [staffName, student.student_name]);
        await db.query(`UPDATE enquiries_status SET assigned_to = $1 WHERE student_name = $2`, [staffName, student.student_name]);
        assignedCount++;
      } catch (err) {
        errors.push(`${student.student_name}: ${err.message}`);
      }
    }
    res.json({ success: true, assigned: assignedCount, total: unassigned.length, errors });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to assign unassigned students" });
  }
});

// ─── Admin: Edit Student Followups ───────────────────────────────────────────

app.post("/admin/update-followups", async (req, res) => {
  const user = getUser(req);
  if (!user || (user.role !== "admin" && user.role !== "hod")) return res.status(401).json({ error: "Unauthorized" });
  const { student_name, followup1, followup2, followup3, followup4, followup5, followup6, followup7 } = req.body;
  if (!student_name) return res.status(400).json({ error: "student_name required" });
  const vals = [followup1, followup2, followup3, followup4, followup5, followup6, followup7].map(v => v || null);
  try {
    const { rows: existingRows } = await db.query("SELECT * FROM enquiries_status WHERE student_name = $1", [student_name]);
    if (existingRows.length > 0) {
      const existing = existingRows[0];
      const dateVals = [];
      for (let i = 1; i <= 7; i++) {
        const newVal = vals[i - 1];
        const oldVal = existing[`followup${i}`];
        if (newVal !== oldVal) {
          dateVals.push(newVal ? new Date().toISOString() : null);
        } else {
          dateVals.push(existing[`followup${i}_date`]);
        }
      }
      await db.query(
        `UPDATE enquiries_status SET 
           followup1=$1, followup2=$2, followup3=$3, followup4=$4, followup5=$5, followup6=$6, followup7=$7,
           followup1_date=$8, followup2_date=$9, followup3_date=$10, followup4_date=$11, followup5_date=$12, followup6_date=$13, followup7_date=$14
         WHERE student_name=$15`,
        [...vals, ...dateVals, student_name]
      );
    } else {
      const dateVals = vals.map(v => v ? new Date().toISOString() : null);
      await db.query(
        `INSERT INTO enquiries_status (
           student_name, 
           followup1, followup2, followup3, followup4, followup5, followup6, followup7,
           followup1_date, followup2_date, followup3_date, followup4_date, followup5_date, followup6_date, followup7_date
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [student_name, ...vals, ...dateVals]
      );
    }

    // Trigger reassignment if any followup is a shift action (use last set value wins)
    const shiftToMgmt = vals.includes("Shift to Management");
    const shiftTo2nd  = vals.includes("Shift to Direct 2nd Year Admission") || vals.includes("Direct 2nd Year Admission");
    if (shiftToMgmt) {
      const { rows: mgmt } = await db.query(`SELECT staff_name FROM staff WHERE department = 'MANAGEMENT' AND COALESCE(dont_assign, FALSE) = FALSE LIMIT 1`);
      if (mgmt.length > 0) {
        await db.query(`UPDATE enquiry SET "AssignedTo" = $1 WHERE student_name = $2`, [mgmt[0].staff_name, student_name]);
        await db.query(`UPDATE enquiries_status SET assigned_to = $1 WHERE student_name = $2`, [mgmt[0].staff_name, student_name]);
      }
    } else if (shiftTo2nd) {
      const { rows: enqRows } = await db.query(`SELECT department FROM enquiry WHERE student_name = $1 LIMIT 1`, [student_name]);
      if (enqRows.length > 0) {
        const { rows: hodRows } = await db.query(
          `SELECT staff_name FROM staff WHERE department = $1 AND LOWER(designation) = 'hod' LIMIT 1`,
          [enqRows[0].department]
        );
        if (hodRows.length > 0) {
          await db.query(`UPDATE enquiry SET "AssignedTo" = $1 WHERE student_name = $2`, [hodRows[0].staff_name, student_name]);
          await db.query(`UPDATE enquiries_status SET assigned_to = $1 WHERE student_name = $2`, [hodRows[0].staff_name, student_name]);
        }
      }
    }

    triggerBackup();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update followups" });
  }
});

// ─── Staff: Export Data ───────────────────────────────────────────────────────

app.get("/staff/export-data", async (req, res) => {
  const user = getUser(req);
  if (!user || (user.role !== "staff" && user.role !== "hod")) return res.status(401).json({ error: "Unauthorized" });
  try {
    const { rows } = await db.query(`
      SELECT DISTINCT ON (e.student_name)
        e.student_name, e.phone_number, e.department, e.board,
        e.caste, e.annual_income, e.percentage,
        e."AssignedTo", e."CreatedBy",
        e.created_at AS enquiry_created_at,
        s.followup1, s.followup2, s.followup3,
        s.followup4, s.followup5, s.followup6, s.followup7,
        COALESCE(GREATEST(s.followup1_date, s.followup2_date, s.followup3_date, s.followup4_date, s.followup5_date, s.followup6_date, s.followup7_date), s.created_at) AS last_followup_date
      FROM enquiry e
      LEFT JOIN enquiries_status s ON e.student_name = s.student_name
      WHERE LOWER(e."AssignedTo") = LOWER($1)
      ORDER BY e.student_name ASC, s.created_at DESC NULLS LAST
    `, [user.name]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch export data" });
  }
});

// ─── Admin: Download Backup ───────────────────────────────────────────────────

app.get("/admin/download-backup", async (req, res) => {
  const user = getUser(req);
  if (!user || user.role !== "admin") return res.status(401).json({ error: "Unauthorized" });
  try {
    const { rows } = await db.query(
      `SELECT snapshot, created_at FROM data_backups ORDER BY created_at DESC LIMIT 1`
    );
    if (rows.length === 0) return res.status(404).json({ error: "No backup found yet. A backup is created automatically after the first data change." });
    res.json({ data: rows[0].snapshot, backup_time: rows[0].created_at });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch backup" });
  }
});

export default app;