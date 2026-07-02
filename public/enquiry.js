document.addEventListener("DOMContentLoaded", async () => {
    const response = await fetch("/profile");
    if (response.ok) {
        const data = await response.json();
        const initials = data.name.split(" ").map(n => n[0]).join("");
        document.getElementById("ProfileName").innerText = data.name;
        document.getElementById("Department").innerText = data.department;
        document.getElementById("profile-icon").innerText = initials;
        const mobIcon = document.getElementById("mob-profile-icon");
        if (mobIcon) mobIcon.innerText = initials;
        const mobAvatar = document.getElementById("mob-avatar-initials");
        if (mobAvatar) mobAvatar.innerText = initials;
        const mobName = document.getElementById("mob-profile-name");
        if (mobName) mobName.innerText = data.name;
        const mobDept = document.getElementById("mob-profile-dept");
        if (mobDept) mobDept.innerText = data.department;
    }
    fetchAssignedEnquiries();
});

// ── Mobile nav ──────────────────────────────────────────────────────────────
function setMobActive(btn) {
    document.querySelectorAll('.mob-nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}
function toggleMobProfile() {
    document.getElementById('mobProfileSheet').classList.toggle('open');
}
function closeMobProfile(e) {
    if (e.target === document.getElementById('mobProfileSheet')) {
        document.getElementById('mobProfileSheet').classList.remove('open');
    }
}

// ── Tab switching ────────────────────────────────────────────────────────────
function openTab(evt, tabName) {
    document.querySelectorAll('.tab-content').forEach(s => s.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(tabName).style.display = 'block';
    if (evt && evt.currentTarget) evt.currentTarget.classList.add('active');
}

document.getElementById("followupsTab").addEventListener("click", (e) => {
    openTab(e, 'followups');
    fetchFollowups();
});
document.getElementById("assignedTab").addEventListener("click", (e) => {
    openTab(e, 'assigned');
    fetchAssignedEnquiries();
});
document.getElementById("pendingTab") && document.getElementById("pendingTab").addEventListener("click", (e) => {
    openTab(e, 'pending');
    fetchPendingStudents();
});

// ── Shared followup options HTML ─────────────────────────────────────────────
const FOLLOWUP_OPTIONS_HTML = `
    <option value="Interested in Admission">Interested in Admission</option>
    <option value="Not Interested for Admission">Not Interested for Admission</option>
    <option value="Attending Seminar">Attending Seminar</option>
    <option value="Not Attending Seminar">Not Attending Seminar</option>
    <option value="Call Not Received">Call Not Received</option>
    <option value="Invalid Number">Invalid Number</option>
    <option value="Fill Admission/Option Form">Fill Admission/Option Form</option>
    <option value="Registration Done">Registration Done</option>
    <option value="Option 1/2/3 Filled">Option 1/2/3 Filled</option>
    <option value="Branch Change">Branch Change</option>
    <option value="Allotted">Allotted</option>
    <option value="Not Allotted">Not Allotted</option>
    <option value="Betterment">Betterment</option>
    <option value="Direct 2nd Year Admission">Direct 2nd Year Admission</option>
    <option value="Shift to Direct 2nd Year Admission">Shift to Direct 2nd Year Admission</option>
    <option value="Shift to Management">Shift to Management</option>
    <option value="Exit from System">Exit from System</option>
    <option value="Other">Other</option>
    <option value="Admission Taken">Admission Taken</option>
    <option value="Admission Not Taken">Admission Not Taken</option>
    <option value="Management">Management</option>
`;

function hasFollowup(enquiry) {
    for (let i = 1; i <= 7; i++) {
        const v = enquiry[`followup${i}`];
        if (v && v.trim() !== '' && v !== 'null') return true;
    }
    return false;
}

function buildStudentCard(enquiry, idxKey) {
    const safeName = enquiry.student_name.replace(/'/g, "\\'");
    const done = hasFollowup(enquiry);
    const cardStyle = done ? 'border-left: 4px solid #1ca37e; background: #f0faf6;' : '';
    return `
        <div class="student-followup-box" style="${cardStyle}">
            <div class="student-info">
                <div>
                    <strong>${enquiry.student_name}</strong> | <span>${enquiry.phone_number}</span>
                    | <span style="color:var(--muted);font-size:0.85em;">${enquiry.department || ''}</span>
                    ${done ? '<span style="margin-left:8px;font-size:0.78rem;background:#1ca37e;color:#fff;border-radius:4px;padding:1px 7px;">Follow-up Done</span>' : ''}
                </div>
                <button class="action-btn" onclick="toggleFollowup('followup-area-${idxKey}')">Take Follow-up</button>
            </div>
            <div id="followup-area-${idxKey}" class="followup-area" style="display:none;">
                <div class="add-remark-container">
                    <label class="input-label">Select Student Status</label>
                    <select id="followupRemark-${idxKey}" class="remark-select">${FOLLOWUP_OPTIONS_HTML}</select>
                    <input type="text" id="otherRemark-${idxKey}" class="remark-select" placeholder="Enter remark for 'Other' status" style="display:none;">
                    <select id="BranchChange-${idxKey}" class="other-remark-input" style="display:none;">
                        <option value="" disabled selected>Select new branch</option>
                        <option value="AN">AN</option><option value="TE">TE</option>
                        <option value="ME">ME</option><option value="AE">AE</option><option value="CE">CE</option>
                    </select>
                    <div class="button-wrapper">
                        <button class="primary-btn" onclick="addFollowup('followupRemark-${idxKey}','followupTableBody-${idxKey}',this,'${safeName}')">Add Follow-up</button>
                        <span class="success-msg">Saved!</span>
                    </div>
                </div>
                <table class="followup-table">
                    <thead><tr><th style="width:50px;">No.</th><th>Date</th><th>Remark / Status</th></tr></thead>
                    <tbody id="followupTableBody-${idxKey}"></tbody>
                </table>
            </div>
        </div>`;
}

function wireCardEvents(idxKey) {
    const sel = document.getElementById(`followupRemark-${idxKey}`);
    if (!sel) return;
    sel.addEventListener("change", function () {
        document.getElementById(`otherRemark-${idxKey}`).style.display = this.value === "Other" ? "block" : "none";
        document.getElementById(`BranchChange-${idxKey}`).style.display = this.value === "Branch Change" ? "block" : "none";
    });
}

// ── Assigned Students ────────────────────────────────────────────────────────
async function fetchAssignedEnquiries() {
    const container = document.getElementById("assigned-followup-box");
    container.innerHTML = '<p style="color:var(--muted);padding:8px 0;">Loading…</p>';
    const response = await fetch("/assignedEnquiries");
    if (response.status === 401) {
        container.innerHTML = '<p style="color:#d64545;">Session expired. Please <a href="/login.html">log in again</a>.</p>';
        return;
    }
    if (!response.ok) {
        container.innerHTML = '<p style="color:#d64545;">Failed to load students. Please refresh.</p>';
        return;
    }
    const enquiries = await response.json();
    container.innerHTML = "";
    if (enquiries.length === 0) {
        container.innerHTML = '<p style="color:var(--muted);padding:8px 0;">No students assigned to you yet.</p>';
        return;
    }
    enquiries.forEach((enquiry, index) => {
        const key = 10000 + index;
        container.insertAdjacentHTML('beforeend', buildStudentCard(enquiry, key));
        wireCardEvents(key);
        setTimeout(() => loadTableData(enquiry.student_name, `followupTableBody-${key}`), 0);
    });
}

// ── Follow-ups tab ───────────────────────────────────────────────────────────
async function fetchFollowups() {
    const res = await fetch("/followups");
    if (!res.ok) return;
    const enquiries = await res.json();
    const container = document.getElementById("student-followup-box");
    container.innerHTML = "";
    if (enquiries.length === 0) {
        container.innerHTML = '<p style="color:var(--muted);padding:8px 0;">No students found.</p>';
        return;
    }
    enquiries.forEach((enquiry, index) => {
        const key = 20000 + index;
        container.insertAdjacentHTML('beforeend', buildStudentCard(enquiry, key));
        wireCardEvents(key);
        setTimeout(() => loadTableData(enquiry.student_name, `followupTableBody-${key}`), 0);
    });
}

// ── Pending tab ──────────────────────────────────────────────────────────────
async function fetchPendingStudents() {
    const container = document.getElementById("pending-followup-box");
    if (!container) return;
    container.innerHTML = '<p style="color:var(--muted);padding:8px 0;">Loading…</p>';
    try {
        const res = await fetch("/staff/pending-students");
        if (res.status === 401) { container.innerHTML = '<p style="color:#d64545;">Session expired.</p>'; return; }
        const { phase, students } = await res.json();
        container.innerHTML = "";
        if (students.length === 0) {
            container.innerHTML = `<p style="color:#1ca37e;padding:8px 0;font-weight:600;">All follow-ups done for Phase ${phase}!</p>`;
            return;
        }
        container.insertAdjacentHTML('beforeend', `<p style="color:var(--muted);font-size:0.88rem;margin-bottom:10px;">
            ${students.length} student(s) pending follow-up <strong>F${phase}</strong></p>`);
        students.forEach((enquiry, index) => {
            const key = 30000 + index;
            container.insertAdjacentHTML('beforeend', buildStudentCard(enquiry, key));
            wireCardEvents(key);
            setTimeout(() => loadTableData(enquiry.student_name, `followupTableBody-${key}`), 0);
        });
    } catch (err) {
        container.innerHTML = '<p style="color:#d64545;">Failed to load pending students.</p>';
    }
}

async function loadTableData(studentName, tableBodyId) {
    const tableBody = document.getElementById(tableBodyId);
    if (!tableBody) return;
    try {
        const response = await fetch(`/get-status-history?name=${encodeURIComponent(studentName)}`);
        const data = await response.json();
        tableBody.innerHTML = "";
        if (data.length > 0) {
            const row = data[0];
            const history = row.history || [];
            history.forEach((entry, index) => {
                const dateStr = entry.created_at ? new Date(entry.created_at).toLocaleDateString('en-GB') : 'N/A';
                const tr = document.createElement('tr');
                tr.innerHTML = `<td>${index + 1}</td><td>${dateStr}</td><td><strong>[F${entry.phase}]</strong> ${entry.value}</td>`;
                tableBody.appendChild(tr);
            });
        }
    } catch (err) { console.error(err); }
}

async function addFollowup(selectId, tableBodyId, btnElement, studentName) {
    const select = document.getElementById(selectId);
    let selectedRemark = select.value;
    let branchChangeBool = false;
    let exitFromSystembool = false;
    let branchChange = "";
    const idx = selectId.split('-')[1];
    if (selectedRemark === "Other") {
        const otherInput = document.getElementById(`otherRemark-${idx}`);
        otherInput.style.display = "block";
        const otherRemark = otherInput.value.trim();
        if (!otherRemark) { alert("Please enter a remark for 'Other' status."); return; }
        selectedRemark = otherRemark;
    } else if (selectedRemark === "Direct 2nd Year Admission" || selectedRemark === "Shift to Direct 2nd Year Admission") {
        if (!confirm(`Shift ${studentName} to Direct 2nd Year Admission? They will be reassigned to the HOD of their department.`)) return;
    } else if (selectedRemark === "Shift to Management") {
        if (!confirm(`Shift ${studentName} to Management (Snehalatha)?`)) return;
    } else if (selectedRemark === "Branch Change") {
        const branchSelect = document.getElementById(`BranchChange-${idx}`);
        branchSelect.style.display = "block";
        if (!branchSelect.value) { alert("Please select a new branch."); return; }
        selectedRemark = `Branch Change to ${branchSelect.value}`;
        branchChangeBool = true;
        branchChange = branchSelect.value;
    } else if (selectedRemark === "Exit from System") {
        exitFromSystembool = true;
    }
    const dataToSave = {
        student_name: studentName, status: selectedRemark,
        branchChangeBool, exitFromSystembool, branchChange,
        AssignedTo: document.getElementById("ProfileName").innerText,
        followup_date: new Date().toISOString().slice(0, 10)
    };
    try {
        const response = await fetch("/save-followup", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(dataToSave)
        });
        if (response.ok) {
            await loadTableData(studentName, tableBodyId);
            const msg = btnElement.parentElement.querySelector('.success-msg');
            if (msg) { msg.classList.add('show'); setTimeout(() => msg.classList.remove('show'), 1500); }
        } else { alert("Failed to save follow-up."); }
    } catch (err) { console.error(err); }
}

function toggleFollowup(id) {
    const el = document.getElementById(id);
    el.style.display = el.style.display === "block" ? "none" : "block";
}

function toggleProfileDropdown() {
    document.getElementById("profileDropdown").classList.toggle("show");
}

document.addEventListener('click', e => {
    const dropdown = document.getElementById('profileDropdown');
    if (dropdown && dropdown.classList.contains('show') && !e.target.closest('.profile-container')) {
        dropdown.classList.remove('show');
    }
});

// ── Export to Excel ──────────────────────────────────────────────────────────
async function exportStaffExcel() {
    try {
        const res = await fetch("/staff/export-data");
        if (!res.ok) { alert("Failed to fetch data for export."); return; }
        const rows = await res.json();
        if (rows.length === 0) { alert("No students assigned to you yet."); return; }

        const sheetData = rows.map((r, i) => ({
            "Sr": i + 1,
            "Student Name": r.student_name || "",
            "Phone": r.phone_number || "",
            "Department": r.department || "",
            "Percentage": r.percentage !== null && r.percentage !== undefined ? r.percentage : "",
            "Board": r.board || "",
            "Caste": r.caste || "",
            "Annual Income": r.annual_income || "",
            "Created By": r.createdby || r.CreatedBy || "",
            "Assigned To": r.assignedto || r.AssignedTo || "",
            "Enquiry Date": r.enquiry_created_at ? new Date(r.enquiry_created_at).toLocaleDateString("en-IN") : "",
            "Follow-up 1": r.followup1 || "",
            "Follow-up 2": r.followup2 || "",
            "Follow-up 3": r.followup3 || "",
            "Follow-up 4": r.followup4 || "",
            "Follow-up 5": r.followup5 || "",
            "Follow-up 6": r.followup6 || "",
            "Follow-up 7": r.followup7 || "",
            "Last Updated": r.last_followup_date ? new Date(r.last_followup_date).toLocaleDateString("en-IN") : ""
        }));

        const ws = XLSX.utils.json_to_sheet(sheetData);
        ws["!cols"] = [
            {wch:4},{wch:28},{wch:14},{wch:10},{wch:10},{wch:10},{wch:12},{wch:14},
            {wch:18},{wch:22},{wch:14},{wch:20},{wch:20},{wch:20},{wch:20},{wch:20},{wch:20},{wch:20},{wch:14}
        ];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "My Students");
        const staffName = (document.getElementById("ProfileName")?.innerText || "Staff").replace(/\s+/g, "_");
        const date = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, `${staffName}_Students_${date}.xlsx`);
    } catch (err) {
        alert("Export failed: " + err.message);
    }
}
