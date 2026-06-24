/* FC Portal — Facility Center dashboard */

let searchTimeout = null;
let allStudentsCache = [];

const FOLLOWUP_OPTIONS = [
    "Interested in Admission",
    "Not Interested for Admission",
    "Attending Seminar",
    "Not Attending Seminar",
    "Call Not Received",
    "Invalid Number",
    "Fill Admission/Option Form",
    "Registration Done",
    "Option 1/2/3 Filled",
    "Branch Change",
    "Allotted",
    "Not Allotted",
    "Betterment",
    "Direct 2nd Year Admission",
    "Shift to Direct 2nd Year Admission",
    "Shift to Management",
    "Exit from System",
    "Other",
    "Admission Taken",
    "Admission Not Taken",
    "Management"
];

// ── Populate the single latest-followup select once on load ──────────────────

function buildFollowupSelects() {
    const sel = document.getElementById("edit-fu-latest");
    if (!sel) return;
    FOLLOWUP_OPTIONS.forEach(opt => {
        const el = document.createElement("option");
        el.value = opt;
        el.textContent = opt;
        sel.appendChild(el);
    });
}

// ── Profile ──────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
    buildFollowupSelects();
    try {
        const res = await fetch("/profile");
        if (res.ok) {
            const data = await res.json();
            const initials = data.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
            document.getElementById("ProfileName").innerText = data.name;
            document.getElementById("Department").innerText = data.department;
            document.getElementById("profile-icon").innerText = initials;
            // Sync mobile profile sheet
            const mobAvatar = document.getElementById("mob-fc-avatar");
            const mobIcon   = document.getElementById("mob-fc-profile-icon");
            const mobName   = document.getElementById("mob-fc-name");
            if (mobAvatar) mobAvatar.innerText = initials;
            if (mobIcon)   mobIcon.innerText   = initials;
            if (mobName)   mobName.innerText   = data.name;
        } else {
            window.location.href = "/login.html";
        }
    } catch {
        window.location.href = "/login.html";
    }
});

// ── Tab switching ─────────────────────────────────────────────────────────────

function showTab(tabName) {
    document.querySelectorAll(".tab-content").forEach(el => (el.style.display = "none"));
    document.getElementById(tabName).style.display = "block";
    // Sync desktop tab buttons
    document.querySelectorAll(".tabs .tab-btn").forEach(el => el.classList.remove("active"));
    const deskBtn = document.getElementById(tabName === "add-enquiry" ? "fc-desk-add-btn" : "allStudentsTab");
    if (deskBtn) deskBtn.classList.add("active");
    // Sync mobile nav buttons
    document.querySelectorAll(".mob-nav-btn").forEach(el => el.classList.remove("active"));
    const mobBtn = document.getElementById(tabName === "add-enquiry" ? "mob-fc-btn-add" : "mob-fc-btn-students");
    if (mobBtn) mobBtn.classList.add("active");
    // Load data when switching to All Students
    if (tabName === "all-students") loadAllStudents();
}

// Backward-compat wrapper kept for any inline callers
function openTab(evt, tabName) {
    showTab(tabName);
}

// ── Mobile profile sheet ──────────────────────────────────────────────────────

function toggleMobFcProfile() {
    document.getElementById("mob-fc-profile-sheet").classList.toggle("open");
}

function closeMobFcProfile(e) {
    if (e.target === document.getElementById("mob-fc-profile-sheet")) {
        document.getElementById("mob-fc-profile-sheet").classList.remove("open");
    }
}

// ── Profile dropdown ──────────────────────────────────────────────────────────

function toggleProfileDropdown() {
    document.getElementById("profileDropdown").classList.toggle("show");
}

window.addEventListener("click", e => {
    if (!e.target.closest(".profile-container")) {
        document.querySelectorAll(".profile-dropdown.show").forEach(d => d.classList.remove("show"));
    }
});

const logoutLink = document.querySelector(".logout-link");
if (logoutLink) {
    logoutLink.addEventListener("click", e => {
        e.preventDefault();
        window.location.href = "/logout";
    });
}

// ── Add Enquiry ───────────────────────────────────────────────────────────────

document.getElementById("fc-enquiry-form").addEventListener("submit", async e => {
    e.preventDefault();

    const firstName   = document.getElementById("fc-firstName").value.trim();
    const fatherName  = document.getElementById("fc-fatherName").value.trim();
    const surname     = document.getElementById("fc-surname").value.trim();
    const studentName = `${firstName} ${fatherName} ${surname}`;
    const phoneNO      = document.getElementById("fc-phoneNO").value.trim();
    const branch       = document.getElementById("fc-branch").value;
    const percentage   = document.getElementById("fc-percentage").value;
    const isManagement = document.getElementById("fc-isManagement").checked;
    const is_fc        = document.getElementById("fc-is_fc").checked;
    const caste        = document.getElementById("fc-caste").value;
    const annual_income = document.getElementById("fc-annual-income").value;
    const board        = document.getElementById("fc-board").value;

    if (!/^\d{10}$/.test(phoneNO)) {
        alert("Please enter a valid 10-digit phone number.");
        return;
    }
    if (percentage !== "" && (isNaN(percentage) || percentage < 0 || percentage > 100)) {
        alert("Please enter a valid percentage between 0 and 100.");
        return;
    }
    if (!branch) {
        alert("Please select a branch.");
        return;
    }

    const btn = document.getElementById("fc-submitEnquiry");
    btn.disabled = true;
    btn.textContent = "Submitting…";

    try {
        const res = await fetch("/EnquirySubmission", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                studentName,
                department: branch,
                phoneNO,
                percentage,
                isManagement,
                is_fc,
                caste,
                annual_income,
                board,
                CreatedBy: document.getElementById("ProfileName").innerText
            })
        });

        if (res.ok) {
            const data = await res.json();
            alert(`Enquiry submitted! Assigned to: ${data.assignedTo}`);
            document.getElementById("fc-enquiry-form").reset();
        } else {
            const err = await res.json();
            alert("Error: " + (err.error || "Failed to submit enquiry."));
        }
    } catch {
        alert("Network error. Please try again.");
    } finally {
        btn.disabled = false;
        btn.textContent = "Submit Enquiry";
    }
});

// ── All Students ──────────────────────────────────────────────────────────────

async function loadAllStudents(search = "") {
    const tbody = document.getElementById("fc-students-body");
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:28px;">Loading…</td></tr>`;

    try {
        const res = await fetch(`/fc/all-students?search=${encodeURIComponent(search)}`);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || "Server error");
        }
        const students = await res.json();
        allStudentsCache = students;
        renderStudentsTable(students);
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#d64545;padding:28px;">Failed to load students: ${escHtml(err.message)}</td></tr>`;
    }
}

function getLatestFollowup(s) {
    for (let i = 7; i >= 1; i--) {
        const val = s[`followup${i}`];
        if (val && val.trim() !== "" && val !== "null") {
            return `F${i}: ${val}`;
        }
    }
    return null;
}

function fmtDateTime(raw) {
    if (!raw) return "—";
    const d = new Date(raw);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yy} ${hh}:${min}`;
}

function renderStudentsTable(students) {
    const tbody = document.getElementById("fc-students-body");
    if (students.length === 0) {
        tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;color:var(--muted);padding:28px;">No students found.</td></tr>`;
        return;
    }

    tbody.innerHTML = students.map((s, i) => {
        const latest     = getLatestFollowup(s);
        const assignedTo = s.AssignedTo || s.assignedto || "—";
        const createdBy  = s.CreatedBy  || s.createdby  || "—";
        const boardVal   = s.board || "—";
        const dateStr    = fmtDateTime(s.created_at);
        const confirmed  = s.fc_confirmed === true || s.fc_confirmed === "true";
        const rowStyle   = confirmed ? 'background:#fefce8;' : '';
        const badge      = confirmed ? ' <span style="font-size:0.7rem;background:#d97706;color:#fff;border-radius:4px;padding:1px 6px;">FC Confirmed</span>' : '';

        return `<tr class="fc-student-row" style="${rowStyle}" onclick="openEditModal(${i})" title="Click to edit">
            <td data-label="Sr">${i + 1}</td>
            <td data-label="Student Name"><strong>${escHtml(s.student_name)}</strong>${badge}</td>
            <td data-label="Branch">${escHtml(s.department)}</td>
            <td data-label="Phone">${escHtml(s.phone_number)}</td>
            <td data-label="%">${s.percentage !== null && s.percentage !== undefined ? s.percentage : "—"}</td>
            <td data-label="Board">${escHtml(boardVal)}</td>
            <td data-label="Assigned To">${escHtml(assignedTo)}</td>
            <td data-label="Created By">${escHtml(createdBy)}</td>
            <td data-label="Created">${dateStr}</td>
            <td data-label="Latest Status" class="fc-fu-cell ${latest ? "filled" : ""}">${latest ? escHtml(latest) : "—"}</td>
            <td data-label="Action">
                <button class="fc-edit-btn" onclick="event.stopPropagation(); openEditModal(${i})">Edit</button>
            </td>
        </tr>`;
    }).join("");
}

function escHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function handleSearch(value) {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => loadAllStudents(value.trim()), 350);
}

// ── Edit Modal ────────────────────────────────────────────────────────────────

function openEditModal(index) {
    const s = allStudentsCache[index];
    if (!s) return;

    document.getElementById("edit-original-name").value  = s.student_name || "";
    document.getElementById("edit-name").value            = s.student_name || "";
    document.getElementById("edit-department").value      = s.department || "AN";
    document.getElementById("edit-phone").value           = s.phone_number || "";
    document.getElementById("edit-percentage").value      = s.percentage !== null && s.percentage !== undefined ? s.percentage : "";
    document.getElementById("edit-assigned").value        = s.AssignedTo || s.assignedto || "";
    document.getElementById("edit-caste").value           = s.caste || "";
    document.getElementById("edit-annual-income").value   = s.annual_income || "";
    document.getElementById("edit-board").value           = s.board || "";

    // Find the latest non-empty followup phase
    let latestPhase = 0;
    let latestValue = "";
    for (let i = 7; i >= 1; i--) {
        const val = s[`followup${i}`];
        if (val && val.trim() !== "" && val !== "null") {
            latestPhase = i;
            latestValue = val;
            break;
        }
    }

    document.getElementById("edit-fu-phase").value = latestPhase;

    // Always show the dropdown — default to phase 1 if no followup exists yet
    const displayPhase = latestPhase > 0 ? latestPhase : 1;
    document.getElementById("edit-fu-phase").value = displayPhase;
    document.getElementById("fc-latest-fu-label").textContent =
        latestPhase > 0 ? `Follow-up ${latestPhase} (Latest)` : "Follow-up 1 (New)";
    document.getElementById("edit-fu-latest").value = latestValue;
    document.getElementById("fc-latest-fu-wrap").style.display = "block";
    document.getElementById("fc-no-fu-msg").style.display = "none";

    // Show confirmed state on button
    const confirmBtn = document.getElementById("fc-confirm-btn");
    if (s.fc_confirmed === true || s.fc_confirmed === "true") {
        confirmBtn.textContent = "✓ Admission Confirmed";
        confirmBtn.disabled = true;
        confirmBtn.style.background = "#6b7280";
        confirmBtn.style.borderColor = "#6b7280";
    } else {
        confirmBtn.innerHTML = "&#x2713; Confirm Admission";
        confirmBtn.disabled = false;
        confirmBtn.style.background = "#d97706";
        confirmBtn.style.borderColor = "#d97706";
    }

    document.getElementById("fc-edit-modal").style.display = "flex";
}

async function confirmAdmission() {
    const studentName = document.getElementById("edit-original-name").value;
    if (!studentName) return;
    if (!confirm(`Mark "${studentName}" as FC Confirmed? This cannot be undone.`)) return;
    try {
        const res = await fetch("/fc/confirm-admission", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ student_name: studentName })
        });
        if (res.ok) {
            const btn = document.getElementById("fc-confirm-btn");
            btn.textContent = "✓ Admission Confirmed";
            btn.disabled = true;
            btn.style.background = "#6b7280";
            btn.style.borderColor = "#6b7280";
            // Update cache
            const idx = allStudentsCache.findIndex(s => s.student_name === studentName);
            if (idx !== -1) allStudentsCache[idx].fc_confirmed = true;
            renderStudentsTable(allStudentsCache);
        } else {
            alert("Failed to confirm admission.");
        }
    } catch {
        alert("Network error.");
    }
}

function closeEditModal() {
    document.getElementById("fc-edit-modal").style.display = "none";
}

document.getElementById("fc-edit-modal").addEventListener("click", e => {
    if (e.target === document.getElementById("fc-edit-modal")) closeEditModal();
});

async function saveStudent() {
    const original_name  = document.getElementById("edit-original-name").value;
    const student_name   = document.getElementById("edit-name").value.trim();
    const department     = document.getElementById("edit-department").value;
    const phone_number   = document.getElementById("edit-phone").value.trim();
    const percentage     = document.getElementById("edit-percentage").value;
    const assigned_to    = document.getElementById("edit-assigned").value.trim();
    const caste          = document.getElementById("edit-caste").value;
    const annual_income  = document.getElementById("edit-annual-income").value;
    const board          = document.getElementById("edit-board").value;

    if (!student_name) { alert("Student name is required."); return; }
    if (!/^\d{10}$/.test(phone_number)) { alert("Please enter a valid 10-digit phone number."); return; }
    if (percentage !== "" && (isNaN(percentage) || percentage < 0 || percentage > 100)) {
        alert("Please enter a valid percentage between 0 and 100.");
        return;
    }

    const fu_phase = parseInt(document.getElementById("edit-fu-phase").value) || 0;
    const fu_value = fu_phase > 0 ? document.getElementById("edit-fu-latest").value : "";

    if (fu_value === "Shift to Management") {
        if (!confirm(`Shift ${student_name} to Management (Snehalatha)? Assignment will be updated automatically.`)) return;
    } else if (fu_value === "Shift to Direct 2nd Year Admission" || fu_value === "Direct 2nd Year Admission") {
        if (!confirm(`Shift ${student_name} to Direct 2nd Year Admission? They will be reassigned to the HOD of their department.`)) return;
    }

    const btn = document.getElementById("fc-save-btn");
    btn.disabled = true;
    btn.textContent = "Saving…";

    try {
        const res = await fetch("/fc/update-student", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                original_name, student_name, department,
                phone_number, percentage, assigned_to,
                caste, annual_income, board,
                fu_phase, fu_value
            })
        });

        if (res.ok) {
            closeEditModal();
            const search = document.getElementById("fc-search").value.trim();
            await loadAllStudents(search);
            alert("Student data updated successfully!");
        } else {
            const err = await res.json();
            alert("Error: " + (err.error || "Failed to update student."));
        }
    } catch {
        alert("Network error. Please try again.");
    } finally {
        btn.disabled = false;
        btn.textContent = "Save Changes";
    }
}
