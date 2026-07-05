// HOD Panel script

const hodState = { students: [], staff: [], department: '' };
let hodStaffData = [];
let hodProfileName = '';

const HOD_FOLLOWUP_OPTIONS_HTML = `
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
    <option value="Provisional merit list checked all ok">Provisional merit list checked all ok</option>
<option value="Problem in Provisional merit list">Problem in Provisional merit list</option>
<option value="Other">Other</option>
    <option value="Admission Taken">Admission Taken</option>
    <option value="Admission Not Taken">Admission Not Taken</option>
    <option value="Management">Management</option>
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function showToast(msg, ok = true) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.style.background = ok ? '#27ae60' : '#e74c3c';
    t.textContent = msg;
    t.style.display = 'block';
    setTimeout(() => t.style.display = 'none', 2200);
}

function fmtDateTime(raw) {
    if (!raw) return '—';
    const d = new Date(raw);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function getLatestStatus(item) {
    for (let i = 7; i >= 1; i--) if (item[`followup${i}`]) return `F${i}: ${item[`followup${i}`]}`;
    return 'No follow-up yet';
}

function getRawLatest(item) {
    for (let i = 7; i >= 1; i--) if (item[`followup${i}`]) return item[`followup${i}`];
    return '';
}

// ── Tab switching ─────────────────────────────────────────────────────────────

function openHodTab(name, btn) {
    document.querySelectorAll('.admin-tab').forEach(s => s.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('hod-tab-' + name).style.display = 'block';
    if (btn) btn.classList.add('active');
    if (name === 'staff') renderHodStaff();
    if (name === 'requests') loadHodRequests();
    if (name === 'assigned') fetchHodAssignedEnquiries();
}

// ── Load data ─────────────────────────────────────────────────────────────────

async function loadHodData() {
    try {
        const profileRes = await fetch('/profile');
        if (profileRes.ok) {
            const profile = await profileRes.json();
            hodProfileName = profile.name || '';
        }

        const res = await fetch('/hod/summary');
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        hodState.students = data.students;
        hodState.staff = data.staff;
        hodState.department = data.department;
        hodStaffData = data.staff;

        document.getElementById('hod-dept-label').textContent = data.department;

        renderSummaryCards();
        populateStaffFilter();
        renderStudentsTable();
        loadHodRequests();
        fetchHodAssignedEnquiries();
    } catch (err) {
        console.error(err);
        showToast('Failed to load data', false);
    }
}

function renderSummaryCards() {
    const container = document.getElementById('hod-summary-cards');
    const total = hodState.students.length;
    let assigned = 0, followupDone = 0;
    hodState.students.forEach(s => {
        if (s.AssignedTo) assigned++;
        if (getRawLatest(s)) followupDone++;
    });
    container.innerHTML = [
        { title: 'Total Students', value: total },
        { title: 'Assigned', value: assigned },
        { title: 'Unassigned', value: total - assigned },
        { title: 'Follow-ups Done', value: followupDone }
    ].map(c => `
        <div class="summary-card">
            <div class="small">${c.title}</div>
            <div style="font-size:1.4em;font-weight:700">${c.value}</div>
        </div>
    `).join('');
}

function populateStaffFilter() {
    const sel = document.getElementById('hod-filter-staff');
    sel.innerHTML = '<option value="">All</option>';
    hodState.staff.forEach(s => {
        const o = document.createElement('option');
        o.value = s.staff_name; o.textContent = s.staff_name;
        sel.appendChild(o);
    });
}

// ── Students table ────────────────────────────────────────────────────────────

function getFilteredStudents() {
    const search = (document.getElementById('hod-search').value || '').toLowerCase();
    const filterFollowup = document.getElementById('hod-filter-followup').value;
    const filterStaff = document.getElementById('hod-filter-staff').value;
    const filterType = document.getElementById('hod-filter-type').value;

    return hodState.students.filter(item => {
        if (search && !(item.student_name || '').toLowerCase().includes(search)) return false;
        const hasFollowup = !!getRawLatest(item);
        if (filterFollowup === 'has-followup' && !hasFollowup) return false;
        if (filterFollowup === 'no-followup' && hasFollowup) return false;
        if (filterStaff && item.AssignedTo !== filterStaff) return false;
        if (filterType) {
            const raw = getRawLatest(item).toLowerCase();
            if (!raw.includes(filterType.toLowerCase())) return false;
        }
        return true;
    });
}

function renderStudentsTable() {
    const tbody = document.getElementById('hod-students-body');
    const filtered = getFilteredStudents();
    const staffOptions = hodState.staff.map(s => `<option value="${s.staff_name}">${s.staff_name}</option>`).join('');

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--muted);">No students found.</td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    filtered.forEach(item => {
        const latest = getLatestStatus(item);
        const hasFu = latest !== 'No follow-up yet';
        const tr = document.createElement('tr');
        tr.className = hasFu ? 'row-completed' : 'row-pending';
        tr.innerHTML = `
            <td><strong>${item.student_name}</strong></td>
            <td>${item.phone_number || '—'}</td>
            <td>${item.board || '—'}</td>
            <td>${item.AssignedTo || '<span style="color:var(--muted)">Unassigned</span>'}</td>
            <td><strong>${latest}</strong></td>
            <td></td>
        `;
        // Reassign select + button
        const cell = tr.children[5];
        const sel = document.createElement('select');
        sel.className = 'assigned-select';
        sel.innerHTML = `<option value="">— select —</option>${staffOptions}`;
        sel.value = item.AssignedTo || '';
        const btn = document.createElement('button');
        btn.className = 'start-btn';
        btn.textContent = 'Save';
        btn.style.marginLeft = '6px';
        btn.disabled = true;
        sel.addEventListener('change', () => btn.disabled = false);
        btn.addEventListener('click', async () => {
            const newStaff = sel.value || null;
            btn.disabled = true; btn.textContent = 'Saving…';
            try {
                const res = await fetch('/hod/update-assigned', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ student_name: item.student_name, AssignedTo: newStaff })
                });
                if (res.ok) { item.AssignedTo = newStaff; showToast('Saved'); btn.textContent = 'Saved'; }
                else { btn.disabled = false; btn.textContent = 'Save'; showToast('Failed', false); }
            } catch { btn.disabled = false; btn.textContent = 'Save'; showToast('Error', false); }
        });
        cell.appendChild(sel);
        cell.appendChild(btn);
        tbody.appendChild(tr);
    });
}

// ── Assigned students follow-up ─────────────────────────────────────────────

function hasHodFollowup(enquiry) {
    for (let i = 1; i <= 7; i++) {
        const v = enquiry[`followup${i}`];
        if (v && v.trim() !== '' && v !== 'null') return true;
    }
    return false;
}

function buildHodCard(enquiry, idxKey) {
    const safeName = enquiry.student_name.replace(/'/g, "\\'");
    const done = hasHodFollowup(enquiry);
    const cardStyle = done ? 'border-left: 4px solid #1ca37e; background: #f0faf6;' : '';
    return `
        <div class="student-followup-box" style="${cardStyle}">
            <div class="student-info">
                <div>
                    <strong>${enquiry.student_name}</strong> | <span>${enquiry.phone_number}</span>
                    | <span style="color:var(--muted);font-size:0.85em;">${enquiry.department || ''}</span>
                    ${done ? '<span style="margin-left:8px;font-size:0.78rem;background:#1ca37e;color:#fff;border-radius:4px;padding:1px 7px;">Follow-up Done</span>' : ''}
                </div>
                <button class="action-btn" onclick="toggleHodFollowup('followup-area-${idxKey}')">Take Follow-up</button>
            </div>
            <div id="followup-area-${idxKey}" class="followup-area" style="display:none;">
                <div class="add-remark-container">
                    <label class="input-label">Select Student Status</label>
                    <select id="followupRemark-${idxKey}" class="remark-select">${HOD_FOLLOWUP_OPTIONS_HTML}</select>
                    <input type="text" id="otherRemark-${idxKey}" class="remark-select" placeholder="Enter remark for 'Other' status" style="display:none;">
                    <select id="BranchChange-${idxKey}" class="other-remark-input" style="display:none;">
                        <option value="" disabled selected>Select new branch</option>
                        <option value="AN">AN</option><option value="TE">TE</option>
                        <option value="ME">ME</option><option value="AE">AE</option><option value="CE">CE</option>
                    </select>
                    <div class="button-wrapper">
                        <button class="primary-btn" onclick="addHodFollowup('followupRemark-${idxKey}','followupTableBody-${idxKey}',this,'${safeName}')">Add Follow-up</button>
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

function wireHodCardEvents(idxKey) {
    const sel = document.getElementById(`followupRemark-${idxKey}`);
    if (!sel) return;
    sel.addEventListener('change', function () {
        document.getElementById(`otherRemark-${idxKey}`).style.display = this.value === 'Other' ? 'block' : 'none';
        document.getElementById(`BranchChange-${idxKey}`).style.display = this.value === 'Branch Change' ? 'block' : 'none';
    });
}

async function fetchHodAssignedEnquiries() {
    const container = document.getElementById('assigned-followup-box');
    if (!container) return;
    container.innerHTML = '<p style="color:var(--muted);padding:8px 0;">Loading…</p>';
    try {
        const res = await fetch('/assignedEnquiries');
        if (res.status === 401) {
            container.innerHTML = '<p style="color:#d64545;">Session expired. Please <a href="/login.html">log in again</a>.</p>';
            return;
        }
        if (!res.ok) {
            container.innerHTML = '<p style="color:#d64545;">Failed to load students. Please refresh.</p>';
            return;
        }
        const enquiries = await res.json();
        container.innerHTML = '';
        if (enquiries.length === 0) {
            container.innerHTML = '<p style="color:var(--muted);padding:8px 0;">No students assigned to you yet.</p>';
            return;
        }
        enquiries.forEach((enquiry, index) => {
            const key = 40000 + index;
            container.insertAdjacentHTML('beforeend', buildHodCard(enquiry, key));
            wireHodCardEvents(key);
            setTimeout(() => loadHodTableData(enquiry.student_name, `followupTableBody-${key}`), 0);
        });
    } catch (err) {
        console.error(err);
        container.innerHTML = '<p style="color:#d64545;">Failed to load students.</p>';
    }
}

async function loadHodTableData(studentName, tableBodyId) {
    const tableBody = document.getElementById(tableBodyId);
    if (!tableBody) return;
    try {
        const response = await fetch(`/get-status-history?name=${encodeURIComponent(studentName)}`);
        const data = await response.json();
        tableBody.innerHTML = '';
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
    } catch (err) {
        console.error(err);
    }
}

async function addHodFollowup(selectId, tableBodyId, btnElement, studentName) {
    const select = document.getElementById(selectId);
    let selectedRemark = select.value;
    let branchChangeBool = false;
    let exitFromSystembool = false;
    let branchChange = '';
    const idx = selectId.split('-')[1];
    if (selectedRemark === 'Other') {
        const otherInput = document.getElementById(`otherRemark-${idx}`);
        otherInput.style.display = 'block';
        const otherRemark = otherInput.value.trim();
        if (!otherRemark) { alert("Please enter a remark for 'Other' status."); return; }
        selectedRemark = otherRemark;
    } else if (selectedRemark === 'Direct 2nd Year Admission' || selectedRemark === 'Shift to Direct 2nd Year Admission') {
        if (!confirm(`Shift ${studentName} to Direct 2nd Year Admission? They will be reassigned to the HOD of their department.`)) return;
    } else if (selectedRemark === 'Shift to Management') {
        if (!confirm(`Shift ${studentName} to Management (Snehalatha)?`)) return;
    } else if (selectedRemark === 'Branch Change') {
        const branchSelect = document.getElementById(`BranchChange-${idx}`);
        branchSelect.style.display = 'block';
        if (!branchSelect.value) { alert('Please select a new branch.'); return; }
        selectedRemark = `Branch Change to ${branchSelect.value}`;
        branchChangeBool = true;
        branchChange = branchSelect.value;
    } else if (selectedRemark === 'Exit from System') {
        exitFromSystembool = true;
    }

    const dataToSave = {
        student_name: studentName,
        status: selectedRemark,
        branchChangeBool,
        exitFromSystembool,
        branchChange,
        AssignedTo: hodProfileName,
        followup_date: new Date().toISOString().slice(0, 10)
    };

    try {
        const response = await fetch('/save-followup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dataToSave)
        });
        if (response.ok) {
            await loadHodTableData(studentName, tableBodyId);
            const msg = btnElement.parentElement.querySelector('.success-msg');
            if (msg) { msg.classList.add('show'); setTimeout(() => msg.classList.remove('show'), 1500); }
        } else {
            alert('Failed to save follow-up.');
        }
    } catch (err) {
        console.error(err);
    }
}

function toggleHodFollowup(id) {
    const el = document.getElementById(id);
    el.style.display = el.style.display === 'block' ? 'none' : 'block';
}

// ── Staff management ──────────────────────────────────────────────────────────

function renderHodStaff(filter = '') {
    const tbody = document.getElementById('hod-staff-body');
    const q = filter.toLowerCase();
    const visible = hodStaffData.filter(s =>
        s.staff_name.toLowerCase().includes(q) || (s.username || '').toLowerCase().includes(q)
    );
    if (visible.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--muted);">No staff found.</td></tr>`;
        return;
    }
    tbody.innerHTML = visible.map((s, i) => `
        <tr>
            <td>${i + 1}</td>
            <td><strong>${s.staff_name}</strong></td>
            <td>${s.username || '—'}</td>
            <td>${s.password || '—'}</td>
            <td>
                <label class="toggle-wrap">
                    <input type="checkbox" ${s.dont_assign ? 'checked' : ''} onchange="hodToggleAssign(${s.id}, this.checked)">
                    <span class="status ${s.dont_assign ? 'pending' : 'completed'}">${s.dont_assign ? 'Paused' : 'Active'}</span>
                </label>
            </td>
            <td class="table-actions">
                <button class="start-btn" onclick="openHodEditModal(${s.id})">Edit</button>
                <button class="delete-btn" onclick="hodDeleteStaff(${s.id}, '${s.staff_name.replace(/'/g, "\\'")}')">Delete</button>
            </td>
        </tr>
    `).join('');
}

document.getElementById('hod-staff-search').addEventListener('input', e => renderHodStaff(e.target.value));

document.getElementById('hod-create-staff-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const staff_name = document.getElementById('hod-new-name').value.trim();
    const username   = document.getElementById('hod-new-username').value.trim();
    const password   = document.getElementById('hod-new-password').value.trim();
    if (!staff_name || !username || !password) { alert('All fields required'); return; }
    const btn = document.getElementById('hod-create-btn');
    btn.disabled = true; btn.textContent = 'Adding…';
    try {
        const res = await fetch('/hod/create-staff', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ staff_name, username, password })
        });
        if (res.ok) {
            showToast(`${staff_name} added`);
            document.getElementById('hod-create-staff-form').reset();
            await loadHodData();
            renderHodStaff();
        } else {
            const err = await res.json();
            showToast(err.error || 'Failed', false);
        }
    } catch { showToast('Network error', false); }
    finally { btn.disabled = false; btn.textContent = 'Add Staff'; }
});

function openHodEditModal(id) {
    const s = hodStaffData.find(x => x.id === id);
    if (!s) return;
    document.getElementById('hod-edit-id').value = s.id;
    document.getElementById('hod-edit-name').value = s.staff_name;
    document.getElementById('hod-edit-username').value = s.username || '';
    document.getElementById('hod-edit-pw').value = s.password || '';
    document.getElementById('hod-edit-modal').style.display = 'flex';
}

function closeHodEditModal() {
    document.getElementById('hod-edit-modal').style.display = 'none';
}

async function saveHodEditStaff() {
    const id = document.getElementById('hod-edit-id').value;
    const staff_name = document.getElementById('hod-edit-name').value.trim();
    const username   = document.getElementById('hod-edit-username').value.trim();
    const password   = document.getElementById('hod-edit-pw').value.trim();
    if (!staff_name || !username || !password) { alert('All fields required'); return; }
    try {
        const res = await fetch('/hod/update-staff', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, staff_name, username, password })
        });
        if (res.ok) {
            showToast('Staff updated');
            closeHodEditModal();
            await loadHodData();
            renderHodStaff();
        } else showToast('Update failed', false);
    } catch { showToast('Error', false); }
}

async function hodDeleteStaff(id, name) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
        const res = await fetch('/hod/delete-staff', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        if (res.ok) {
            showToast(`${name} deleted`);
            await loadHodData();
            renderHodStaff();
        } else showToast('Delete failed', false);
    } catch { showToast('Error', false); }
}

async function hodToggleAssign(id, checked) {
    try {
        await fetch('/hod/toggle-assign', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, dont_assign: checked })
        });
        showToast('Updated');
        await loadHodData();
        renderHodStaff();
    } catch { showToast('Error', false); }
}

// ── Unavailability requests ───────────────────────────────────────────────────

async function loadHodRequests() {
    const container = document.getElementById('hod-requests-container');
    const badge = document.getElementById('hod-badge');
    try {
        const res = await fetch('/hod/unavailability-requests');
        if (!res.ok) throw new Error('Failed');
        const requests = await res.json();
        badge.textContent = requests.length || '';

        if (requests.length === 0) {
            container.innerHTML = `<p class="small" style="color:var(--muted);">No pending requests in your department.</p>`;
            return;
        }

        container.innerHTML = '';
        requests.forEach(req => {
            const card = document.createElement('div');
            card.style.cssText = 'border:1px solid rgba(31,41,55,0.12);border-radius:12px;padding:16px;margin-bottom:12px;background:#fafafa;';
            card.innerHTML = `
                <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:10px;">
                    <div>
                        <strong>${req.staff_name}</strong>
                        <div class="small" style="color:var(--muted);margin-top:4px;">📅 ${req.days} day(s) &nbsp;·&nbsp; 🕐 ${fmtDateTime(req.created_at)}</div>
                        <p style="margin:8px 0 0;font-size:0.92rem;">${req.reason}</p>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end;">
                        <button class="start-btn" onclick="hodApproveRequest(${req.id}, '${req.staff_name.replace(/'/g, "\\'")}')">Approve &amp; Reassign</button>
                        <div style="display:flex;gap:6px;align-items:center;">
                            <input type="text" id="hod-reject-note-${req.id}" placeholder="Rejection reason (optional)" style="padding:7px 10px;border:1px solid #ccc;border-radius:8px;font-size:0.85rem;width:200px;">
                            <button class="delete-btn" onclick="hodRejectRequest(${req.id})">Reject</button>
                        </div>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
    } catch (err) {
        console.error(err);
        container.innerHTML = `<p class="small" style="color:#d64545;">Failed to load requests.</p>`;
    }
}

async function hodApproveRequest(id, staffName) {
    if (!confirm(`Approve unavailability for "${staffName}"? Their students will be auto-distributed to other available staff.`)) return;
    try {
        const res = await fetch('/hod/unavailability-approve', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.error || 'Failed', false); return; }
        showToast(`Approved. ${data.reassigned} of ${data.total} student(s) auto-reassigned.`);
        await loadHodRequests();
        await loadHodStaffOnBreak();
    } catch { showToast('Error', false); }
}

async function hodRejectRequest(id) {
    const note = (document.getElementById(`hod-reject-note-${id}`)?.value || '').trim();
    if (!confirm('Reject this request?')) return;
    try {
        const res = await fetch('/hod/unavailability-reject', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, admin_note: note })
        });
        if (res.ok) { showToast('Rejected'); await loadHodRequests(); }
        else showToast('Failed', false);
    } catch { showToast('Error', false); }
}

function showHodReassignPanel(staffName, days, students) {
    const panel = document.getElementById('hod-reassign-panel');
    const title = document.getElementById('hod-reassign-title');
    const container = document.getElementById('hod-reassign-container');
    title.textContent = `Reassign students from ${staffName} (${days}-day leave)`;
    panel.style.display = 'block';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    if (students.length === 0) {
        container.innerHTML = `<p class="small" style="color:var(--muted);">No assigned students to reassign.</p>`;
        return;
    }

    const staffOpts = hodState.staff
        .filter(s => s.staff_name.toLowerCase() !== staffName.toLowerCase() && !s.dont_assign)
        .map(s => `<option value="${s.staff_name}">${s.staff_name}</option>`)
        .join('');

    container.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
            <label style="font-weight:600;">Assign all to:</label>
            <select id="hod-bulk-sel" style="padding:8px 12px;border:1px solid #ccc;border-radius:8px;min-width:200px;">
                <option value="">— pick staff —</option>${staffOpts}
            </select>
            <button class="start-btn" onclick="hodBulkReassign('${staffName.replace(/'/g, "\\'")}')">Reassign All</button>
        </div>
        <div class="table-wrap">
            <table class="followup-table">
                <thead><tr><th>Student</th><th>Phone</th><th>Assign To</th><th></th></tr></thead>
                <tbody id="hod-reassign-tbody"></tbody>
            </table>
        </div>
    `;

    const tbody = document.getElementById('hod-reassign-tbody');
    students.forEach(s => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${s.student_name}</td>
            <td>${s.phone_number}</td>
            <td><select class="assigned-select hod-rsub-sel" style="min-width:160px;">
                <option value="">— select —</option>${staffOpts}
            </select></td>
            <td><button class="start-btn" onclick="hodReassignOne('${s.student_name.replace(/'/g, "\\'")}', this)">Reassign</button></td>
        `;
        tbody.appendChild(tr);
    });
}

async function hodReassignOne(studentName, btn) {
    const sel = btn.closest('tr').querySelector('.hod-rsub-sel');
    const newStaff = sel.value;
    if (!newStaff) { alert('Pick a staff member first.'); return; }
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        const res = await fetch('/hod/update-assigned', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ student_name: studentName, AssignedTo: newStaff })
        });
        if (res.ok) { btn.closest('tr').style.opacity = '0.4'; btn.textContent = 'Done'; showToast('Reassigned'); }
        else { btn.disabled = false; btn.textContent = 'Reassign'; showToast('Failed', false); }
    } catch { btn.disabled = false; btn.textContent = 'Reassign'; showToast('Error', false); }
}

async function hodBulkReassign(fromStaff) {
    const newStaff = document.getElementById('hod-bulk-sel').value;
    if (!newStaff) { alert('Pick a staff member first.'); return; }
    const rows = document.querySelectorAll('#hod-reassign-tbody tr');
    if (!confirm(`Reassign all ${rows.length} student(s) from "${fromStaff}" to "${newStaff}"?`)) return;
    let ok = 0;
    for (const tr of rows) {
        try {
            const res = await fetch('/hod/update-assigned', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ student_name: tr.children[0].textContent, AssignedTo: newStaff })
            });
            if (res.ok) { ok++; tr.style.opacity = '0.4'; }
        } catch { /* skip */ }
    }
    showToast(`${ok}/${rows.length} reassigned`);
    if (ok === rows.length) setTimeout(() => { document.getElementById('hod-reassign-panel').style.display = 'none'; }, 1500);
}

// ── Excel export ──────────────────────────────────────────────────────────────

function exportHodExcel() {
    if (!hodState.students.length) { alert('No data to export.'); return; }
    const rows = hodState.students.map((item, i) => ({
        'Sr No': i + 1,
        'Student Name': item.student_name || '',
        'Phone': item.phone_number || '',
        'Department': item.department || hodState.department,
        'Board': item.board || '',
        'Assigned To': item.AssignedTo || '',
        'Followup 1': item.followup1 || '',
        'Followup 2': item.followup2 || '',
        'Followup 3': item.followup3 || '',
        'Followup 4': item.followup4 || '',
        'Followup 5': item.followup5 || '',
        'Followup 6': item.followup6 || '',
        'Followup 7': item.followup7 || '',
        'Latest Status': getLatestStatus(item)
    }));
    // eslint-disable-next-line no-undef
    const ws = XLSX.utils.json_to_sheet(rows);
    // eslint-disable-next-line no-undef
    const wb = XLSX.utils.book_new();
    // eslint-disable-next-line no-undef
    XLSX.utils.book_append_sheet(wb, ws, hodState.department);
    const today = new Date();
    const fname = `${hodState.department}_students_${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}.xlsx`;
    // eslint-disable-next-line no-undef
    XLSX.writeFile(wb, fname);
}

// ── Filter wiring ─────────────────────────────────────────────────────────────

['hod-search', 'hod-filter-followup', 'hod-filter-staff', 'hod-filter-type'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', renderStudentsTable);
});

document.getElementById('hod-reset-btn').addEventListener('click', () => {
    document.getElementById('hod-search').value = '';
    document.getElementById('hod-filter-followup').value = '';
    document.getElementById('hod-filter-staff').value = '';
    document.getElementById('hod-filter-type').value = '';
    renderStudentsTable();
});

document.addEventListener('click', e => {
    if (e.target === document.getElementById('hod-edit-modal')) closeHodEditModal();
});

// ── Staff on break ────────────────────────────────────────────────────────────

async function loadHodStaffOnBreak() {
    try {
        const res = await fetch('/hod/staff-on-break');
        const data = await res.json();
        const container = document.getElementById('hod-on-break-container');
        const badge = document.getElementById('hod-break-badge');
        if (badge) badge.textContent = data.length;
        if (!container) return;
        if (data.length === 0) {
            container.innerHTML = `<p class="small" style="color:var(--muted);">No staff currently on break.</p>`;
            return;
        }
        container.innerHTML = data.map(s => `
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:10px 0;border-bottom:1px solid rgba(31,41,55,0.08);">
                <div>
                    <strong>${s.staff_name}</strong>
                    ${s.days ? `<span class="small" style="margin-left:8px;color:var(--muted);">${s.days} day(s) · ${s.reason || ''}</span>` : ''}
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error(err);
    }
}

// ── Mobile nav helpers ────────────────────────────────────────────────────────

function setHodMobActive(btn) {
    document.querySelectorAll('.mob-nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadHodData();
loadHodStaffOnBreak();
