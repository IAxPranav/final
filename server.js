import express from "express";
import pg from "pg";
import session from "express-session";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(session({
  secret: "secret-key",
  resave: false,
  saveUninitialized: false
}));

app.use(express.static("public"));
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

app.get("/", (req, res) => {
  res.redirect("/login.html");
});

app.get("/enquiry", (req, res) => {
  if (req.session.user) {
    res.sendFile(path.resolve("views/Enquiry.html"));
  } else {
    res.redirect("/login.html");
  }
});

app.get("/admin", (req, res) => {
  if (req.session.user && req.session.user.role === "admin") {
    res.sendFile(path.resolve("views/admin.html"));
  } else {
    res.redirect("/login.html");
  }
});

app.get("/principal", (req, res) => {
  if (req.session.user && req.session.user.role === "principal") {
    res.sendFile(path.resolve("views/principal.html"));
  } else {
    res.redirect("/login.html");
  }
});

app.get("/staff-manage", (req, res) => {
  if (req.session.user && req.session.user.role === "admin") {
    res.sendFile(path.resolve("views/staff-manage.html"));
  } else {
    res.redirect("/login.html");
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  // Hardcoded Admin
  if (username === "pranavkumarajaybhadane" && password === "pranavkumarajaybhadane@089") {
    req.session.user = {
      name: "Admin",
      department: "ADMIN",
      role: "admin"
    };
    return res.json({ success: true, redirect: "/admin" });
  }

  // Hardcoded Principal
  if (username === "salyantony" && password === "salyantony@089") {
    req.session.user = {
      name: "Principal",
      department: "PRINCIPAL",
      role: "principal"
    };
    return res.json({ success: true, redirect: "/principal" });
  }

  try {
    const { rows } = await db.query(
      "SELECT staff_name, department FROM staff WHERE username = $1 AND password = $2",
      [username, password]
    );

    if (rows.length > 0) {
      req.session.user = {
        name: rows[0].staff_name,
        department: rows[0].department,
        role: "staff"
      };
      res.json({ success: true, redirect: "/enquiry" });
    } else {
      res.json({ success: false });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/profile", (req, res) => {
  if (req.session.user) {
    res.json(req.session.user);
  } else {
    res.status(401).json({ error: "Not logged in" });
  }
});

app.get("/assignedEnquiries", async (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: "Session expired. Please login again." });
  }
  try {
    const { rows } = await db.query(
      "SELECT student_name, department, phone_number, percentage, \"CreatedBy\" FROM enquiry WHERE \"AssignedTo\" = $1",
      [req.session.user.name]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch enquiries" });
  }
});

app.get("/followups", async (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: "Session expired. Please login again." });
  }
  try {
    const { rows } = await db.query(
      "SELECT student_name, phone_number FROM enquiry WHERE \"AssignedTo\" = $1",
      [req.session.user.name]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch follow-ups" });
  }
});

async function autoAssignStaff(department) {
  const { rows: enquiryRows } = await db.query(
    "SELECT COUNT(*) as total FROM enquiry WHERE department = $1",
    [department]
  );

  const totalEnquiries = parseInt(enquiryRows[0].total);

  // Only select staff where dont_assign is false
  const { rows: staffRows } = await db.query(
    "SELECT staff_name FROM staff WHERE department = $1 AND dont_assign = FALSE",
    [department]
  );

  if (staffRows.length === 0) {
    // Fallback: If no staff available in that department, find ANY staff who can take enquiries
    const { rows: fallbackStaff } = await db.query(
      "SELECT staff_name FROM staff WHERE dont_assign = FALSE"
    );
    if (fallbackStaff.length === 0) {
      throw new Error("No available staff found for assignment");
    }
    const index = totalEnquiries % fallbackStaff.length;
    return fallbackStaff[index].staff_name;
  }

  const staffList = staffRows.map(row => row.staff_name);
  const index = totalEnquiries % staffList.length;

  return staffList[index];
}

// Get all staff for management
app.get("/admin/full-staff-list", async (req, res) => {
  try {
    const { rows } = await db.query("SELECT id, staff_name, department, dont_assign FROM staff ORDER BY department, staff_name");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch full staff list" });
  }
});

// Update staff assignment mode
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

// Update staff department
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
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: "Session expired. Please login again." });
  }

  try {
    let { studentName, department, phoneNO, percentage, isManagement } = req.body;

    // Force department to MANAGEMENT if flag is set
    if (isManagement) {
      department = "MANAGEMENT";
    }

    const assignedStaff = await autoAssignStaff(department);

    await db.query(
      "INSERT INTO enquiry (student_name, department, phone_number, percentage, \"CreatedBy\", \"AssignedTo\") VALUES ($1, $2, $3, $4, $5, $6)",
      [studentName, department, phoneNO, percentage, req.session.user.name, assignedStaff]
    );

    res.json({ success: true, assignedTo: assignedStaff });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to submit enquiry" });
  }
});

app.get("/get-status-history", async (req, res) => {
  const studentName = req.query.name;
  const query = `
        SELECT followup1, followup2, followup3, followup4, followup5, followup6, followup7, created_at 
        FROM enquiries_status 
        WHERE student_name = $1`;

  try {
    const { rows } = await db.query(query, [studentName]);
    res.json(rows);
  } catch (err) {
    console.error("Database error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

app.get("/admin/get-current-phase", async (req, res) => {
  try {
    const { rows } = await db.query("SELECT current_phase FROM app_settings WHERE id = 1");
    if (rows.length > 0) {
      activePhase = rows[0].current_phase;
      res.json({ phase: activePhase });
    } else {
      res.json({ phase: 1 });
    }
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch phase" });
  }
});

app.get("/admin/switch-phase/:num", async (req, res) => {
  activePhase = parseInt(req.params.num);
  try {
    await db.query("UPDATE app_settings SET current_phase = $1 WHERE id = 1", [activePhase]);
    res.send(`System is now writing to followup${activePhase}`);
  } catch (err) {
    res.status(500).send("Database error");
  }
});

let activePhase = 1;

app.post("/save-followup", async (req, res) => {
  const { student_name, status, followup_date, branchChange, branchChangeBool, exitFromSystembool } = req.body;
  const targetColumn = `followup${activePhase}`;

  if (branchChangeBool === true) {
    try {
      const newAssignedStaff = await autoAssignStaff(branchChange);

      await db.query(
        `UPDATE enquiry SET department = $1, "AssignedTo" = $2 WHERE student_name = $3`,
        [branchChange, newAssignedStaff, student_name]
      );

      const { rows: existingRows } = await db.query(
        "SELECT id FROM enquiries_status WHERE student_name = $1",
        [student_name]
      );

      if (existingRows.length > 0) {
        await db.query(
          `UPDATE enquiries_status SET ${targetColumn} = $1, created_at = $2, assigned_to = $3 WHERE student_name = $4`,
          [status, followup_date, newAssignedStaff, student_name]
        );
      }

      return res.status(200).send("Branch and Assigned Staff Updated Successfully");
    } catch (err) {
      console.error(err);
      return res.status(500).send("Database Error");
    }
  }
  else if (exitFromSystembool === true) {
    try {
      const { rows: rowsEnquiry } = await db.query(
        `SELECT id FROM enquiry WHERE student_name = $1`,
        [student_name]
      );

      if (rowsEnquiry.length > 0) {
        let studentIdEnquiry = rowsEnquiry[0].id;
        await db.query(
          `UPDATE enquiry SET "AssignedTo" = 'null' WHERE id = $1`,
          [studentIdEnquiry]
        );
      }

      const { rows: rowsStatus } = await db.query(
        `SELECT id FROM enquiries_status WHERE student_name = $1`,
        [student_name]
      );

      if (rowsStatus.length > 0) {
        let studentIdStatus = rowsStatus[0].id;
        await db.query(
          `DELETE FROM enquiries_status WHERE id = $1`,
          [studentIdStatus]
        );
      }

      return res.status(200).send("Student exited from system successfully");
    } catch (err) {
      console.error("Exit system error:", err);
      return res.status(500).send("Database Error during exit");
    }
  }
  else if (status === "Management") {
    try {
      const newAssignedStaff = await autoAssignStaff("MANAGEMENT");

      await db.query(
        `UPDATE enquiry SET "AssignedTo" = $1 WHERE student_name = $2`,
        [newAssignedStaff, student_name]
      );

      const { rows: existingRows } = await db.query(
        "SELECT id FROM enquiries_status WHERE student_name = $1",
        [student_name]
      );

      if (existingRows.length > 0) {
        await db.query(
          `UPDATE enquiries_status SET ${targetColumn} = $1, created_at = $2, assigned_to = $3 WHERE student_name = $4`,
          [status, followup_date, newAssignedStaff, student_name]
        );
      } else {
        await db.query(
          `INSERT INTO enquiries_status (student_name, ${targetColumn}, created_at, assigned_to) VALUES ($1, $2, $3, $4)`,
          [student_name, status, followup_date, newAssignedStaff]
        );
      }

      return res.status(200).send("Assigned to Management Staff");
    } catch (err) {
      console.error(err);
      return res.status(500).send("Database Error during Management re-assignment");
    }
  }
  else {
    try {
      const { rows: existingRows } = await db.query(
        "SELECT id FROM enquiries_status WHERE student_name = $1",
        [student_name]
      );

      if (existingRows.length > 0) {
        await db.query(
          `UPDATE enquiries_status SET ${targetColumn} = $1, created_at = $2, assigned_to = $3 WHERE student_name = $4`,
          [status, followup_date, req.body.AssignedTo, student_name]
        );
        return res.status(200).send(`Updated ${targetColumn}`);
      } else {
        await db.query(
          `INSERT INTO enquiries_status (student_name, ${targetColumn}, created_at, assigned_to) VALUES ($1, $2, $3, $4)`,
          [student_name, status, followup_date, req.body.AssignedTo]
        );
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
            SELECT 
                e.student_name, 
                e.phone_number, 
                e.department, 
                e."AssignedTo",
                s.followup1, s.followup2, s.followup3, 
                s.followup4, s.followup5, s.followup6, s.followup7,
                s.created_at 
            FROM enquiry e
            LEFT JOIN enquiries_status s ON e.student_name = s.student_name
            ORDER BY e.student_name ASC
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
    const staffNames = rows.map(r => r.staff_name);
    res.json(staffNames);
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

app.post('/admin/update-department', async (req, res) => {
  const { student_name, department } = req.body;
  if (!student_name || !department) return res.status(400).json({ error: 'student_name and department required' });
  try {
    const newAssigned = await autoAssignStaff(department);
    await db.query(`UPDATE enquiry SET department = $1, "AssignedTo" = $2 WHERE student_name = $3`, [department, newAssigned, student_name]);
    await db.query('UPDATE enquiries_status SET assigned_to = $1 WHERE student_name = $2', [newAssigned, student_name]);
    res.json({ success: true, AssignedTo: newAssigned });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update department' });
  }
});

app.post('/admin/delete-entry', async (req, res) => {
  const { student_name } = req.body;
  if (!student_name) return res.status(400).json({ error: 'student_name required' });
  try {
    await db.query('DELETE FROM enquiries_status WHERE student_name = $1', [student_name]);
    await db.query('DELETE FROM enquiry WHERE student_name = $1', [student_name]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete entry' });
  }
});

app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
