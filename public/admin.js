// ── Tab switching ─────────────────────────────────────────────────────────────

function openAdminTab(name, btn) {
    document.querySelectorAll('.admin-tab').forEach(s => s.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + name).style.display = 'block';
    if (btn) btn.classList.add('active');
    if (name === 'staff') { loadStaffDirectory(); loadStaffProgress(); }
    if (name === 'dashboard') { loadUnavailRequests(); loadInvalidNumbers(); }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDateTime(raw) {
    if (!raw) return "Pending";
    const d = new Date(raw);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yy} ${hh}:${min}`;
}

function showToast(message, success = true) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.style.background = success ? '#27ae60' : '#e74c3c';
    t.textContent = message;
    t.style.display = 'block';
    setTimeout(() => { t.style.display = 'none'; }, 2000);
}

// ── Followup phase manager ────────────────────────────────────────────────────

const followups = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, status: 'pending' }));

async function syncPhaseWithDatabase() {
    try {
        const response = await fetch("/admin/get-current-phase");
        const data = await response.json();
        const currentId = parseInt(data.phase);
        followups.forEach(fu => {
            if (fu.id < currentId) fu.status = 'completed';
            else if (fu.id === currentId) fu.status = 'active';
            else fu.status = 'pending';
        });
        renderFollowups();
    } catch (err) {
        console.error("Sync error:", err);
    }
}

syncPhaseWithDatabase();

function renderFollowups() {
    const container = document.getElementById('followupManager');
    if (!container) return;
    container.innerHTML = followups.map(fu => {
        const prevStatus = fu.id === 1 ? 'completed' : followups[fu.id - 2].status;
        const canStart = fu.status === 'pending' && (fu.id === 1 || prevStatus === 'completed');
        return `
            <div class="followup-card">
                <h3>Followup ${fu.id}</h3>
                <div class="status ${fu.status}">
                    ${fu.status.charAt(0).toUpperCase() + fu.status.slice(1)}
                </div>
                <button class="finalize-btn" onclick="finalizeFollowup(${fu.id})"
                    ${fu.status !== 'active' ? 'disabled' : ''}>
                    Finalize Followup ${fu.id}
                </button>
                <button class="start-btn" onclick="startFollowup(${fu.id})"
                    ${!canStart ? 'disabled' : ''}>
                    Start Followup ${fu.id}
                </button>
            </div>
        `;
    }).join('');
}

async function finalizeFollowup(id) {
    const fu = followups.find(f => f.id === id);
    if (!fu || fu.status !== 'active') return;
    try {
        const response = await fetch('/admin/finalize-followup', { method: 'POST' });
        if (!response.ok) throw new Error('Failed');
        fu.status = 'completed';
        await syncPhaseWithDatabase();
        showToast(`Followup ${id} finalized`);
    } catch (err) {
        console.error(err);
        showToast('Failed to finalize follow-up', false);
    }
}

async function startFollowup(id) {
    const fu = followups.find(f => f.id === id);
    const prevCompleted = id === 1 || followups[id - 2].status === 'completed';
    if (fu && fu.status === 'pending' && prevCompleted) {
        const response = await fetch(`/admin/switch-phase/${id}`);
        if (response.ok) {
            await syncPhaseWithDatabase();
            showToast(`Followup ${id} started`);
        }
        else alert("Failed to switch phase on the server.");
    }
}

// ── Staff fetch cache ─────────────────────────────────────────────────────────

const staffCache = {};

async function getStaffForDepartment(dept) {
    if (!dept) return [];
    if (staffCache[dept]) return staffCache[dept];
    try {
        const res = await fetch(`/admin/staff-list?department=${encodeURIComponent(dept)}`);
        if (!res.ok) throw new Error('Failed to load staff');
        const list = await res.json();
        staffCache[dept] = list;
        return list;
    } catch (err) {
        console.error(err);
        return [];
    }
}

// ── All-students table ────────────────────────────────────────────────────────

let latestData = [];

async function renderFollowupsEditable(data) {
    if (!data) return;
    const container = document.getElementById("student-followup-box");

    container.innerHTML = `
        <table class="followup-table">
            <thead>
                <tr>
                    <th>Student Name</th>
                    <th>Phone</th>
                    <th>Department</th>
                    <th>Board</th>
                    <th>Assigned To</th>
                    <th>Latest Status</th>
                    <th>Date</th>
                </tr>
            </thead>
            <tbody id="allStatusTableBody"></tbody>
        </table>
    `;

    const tableBody = document.getElementById("allStatusTableBody");

    const enriched = data.map(item => {
        let latestStatus = "No follow-up yet";
        for (let i = 7; i >= 1; i--) {
            if (item[`followup${i}`]) { latestStatus = `F${i}: ${item[`followup${i}`]}`; break; }
        }
        return { item, latestStatus };
    });

    enriched.sort((a, b) => {
        const aPending = a.latestStatus === 'No follow-up yet';
        const bPending = b.latestStatus === 'No follow-up yet';
        if (aPending === bPending) return a.item.student_name.localeCompare(b.item.student_name);
        return aPending ? -1 : 1;
    });

    for (const row of enriched) {
        const item = row.item;
        const latestStatus = row.latestStatus;
        const dateStr = fmtDateTime(item.enquiry_created_at || item.created_at);
        const boardVal = item.board || "—";
        const tr = document.createElement("tr");

        const staffList = await getStaffForDepartment(item.department);
        const select = document.createElement('select');
        select.className = 'assigned-select';
        select.dataset.student = item.student_name;

        const emptyOpt = document.createElement('option');
        emptyOpt.value = ''; emptyOpt.textContent = 'Unassigned';
        select.appendChild(emptyOpt);
        staffList.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name; opt.textContent = name;
            select.appendChild(opt);
        });
        select.value = item.AssignedTo || '';

        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = 'Confirm';
        confirmBtn.disabled = true;
        confirmBtn.style.marginLeft = '8px';
        confirmBtn.className = 'start-btn';

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Delete';
        deleteBtn.className = 'delete-btn';
        deleteBtn.style.marginLeft = '6px';

        const fcBadge = item.fc_confirmed
            ? ' <span style="font-size:0.68rem;background:#d97706;color:#fff;border-radius:3px;padding:1px 5px;vertical-align:middle;">FC</span>'
            : '';
        tr.innerHTML = `
            <td>${item.student_name}${fcBadge}</td>
            <td>${item.phone_number}</td>
            <td>${item.department}</td>
            <td>${boardVal}</td>
            <td></td>
            <td><strong>${latestStatus}</strong></td>
            <td>${dateStr}</td>
        `;

        const cell = tr.children[4];
        cell.appendChild(select);
        cell.appendChild(confirmBtn);
        cell.appendChild(deleteBtn);

        if (latestStatus === 'No follow-up yet') tr.classList.add('row-pending');
        else tr.classList.add('row-completed');
        if (item.fc_confirmed) tr.style.background = '#fefce8';

        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => openDetailModal(item));

        tableBody.appendChild(tr);

        select.addEventListener('change', () => { confirmBtn.disabled = false; });

        confirmBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const student = select.dataset.student;
            const newAssigned = select.value || null;
            confirmBtn.disabled = true;
            try {
                const res = await fetch('/admin/update-assigned', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ student_name: student, AssignedTo: newAssigned })
                });
                if (!res.ok) throw new Error('Update failed');
                showToast(`Assigned updated for ${student}`);
                tr.classList.remove('row-pending');
                tr.classList.add('row-completed');
                select.classList.add('saved');
                setTimeout(() => select.classList.remove('saved'), 1200);
            } catch (err) {
                console.error(err);
                showToast('Failed to update assignment', false);
                confirmBtn.disabled = false;
            }
        });

        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm(`Delete ${item.student_name}? This cannot be undone.`)) return;
            try {
                const res = await fetch('/admin/delete-entry', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ student_name: item.student_name })
                });
                if (!res.ok) throw new Error('Delete failed');
                showToast(`Deleted ${item.student_name}`);
                tr.remove();
                latestData = latestData.filter(d => d.student_name !== item.student_name);
            } catch (err) {
                console.error(err);
                showToast('Failed to delete', false);
            }
        });
    }

    buildDepartmentCharts(data);
    populateFilters(data);
}

async function loadAndRender() {
    try {
        const res = await fetch('/view-all-status');
        if (!res.ok) throw new Error('Failed to load data');
        const data = await res.json();
        latestData = data;
        renderFollowupsEditable(latestData);
    } catch (err) {
        console.error(err);
    }
}

function populateFilters(data) {
    const staffSet = new Set();
    data.forEach(d => { if (d.AssignedTo) staffSet.add(d.AssignedTo); });

    const deptSel = document.getElementById('filter-dept');
    const staffSel = document.getElementById('filter-staff');
    const statusSel = document.getElementById('filter-status');
    const fcSel = document.getElementById('filter-fc');
    const searchInput = document.getElementById('filter-search');
    const resetBtn = document.getElementById('filter-reset');

    deptSel.querySelectorAll('option:not([value=""])').forEach(n => n.remove());
    staffSel.querySelectorAll('option:not([value=""])').forEach(n => n.remove());

    ['AN', 'TE', 'ME', 'AE', 'CE'].forEach(d => {
        const opt = document.createElement('option'); opt.value = d; opt.textContent = d; deptSel.appendChild(opt);
    });
    Array.from(staffSet).sort().forEach(s => {
        const opt = document.createElement('option'); opt.value = s; opt.textContent = s; staffSel.appendChild(opt);
    });

    function applyFilters() {
        const dept = deptSel.value;
        const staff = staffSel.value;
        const status = statusSel.value;
        const fc = fcSel ? fcSel.value : '';
        const search = (searchInput.value || '').trim().toLowerCase();
        let filtered = latestData.slice();
        if (dept) filtered = filtered.filter(r => r.department === dept);
        if (staff) filtered = filtered.filter(r => (r.AssignedTo || '') === staff);
        if (status === 'no-followup') filtered = filtered.filter(r => {
            for (let i = 1; i <= 7; i++) if (r[`followup${i}`]) return false; return true;
        });
        else if (status === 'followup') filtered = filtered.filter(r => {
            for (let i = 1; i <= 7; i++) if (r[`followup${i}`]) return true; return false;
        });
        if (fc === 'confirmed') filtered = filtered.filter(r => r.fc_confirmed);
        else if (fc === 'not-confirmed') filtered = filtered.filter(r => !r.fc_confirmed);
        if (search) filtered = filtered.filter(r => (r.student_name || '').toLowerCase().includes(search));
        renderFollowupsEditable(filtered);
    }

    deptSel.onchange = applyFilters;
    staffSel.onchange = applyFilters;
    statusSel.onchange = applyFilters;
    if (fcSel) fcSel.onchange = applyFilters;
    searchInput.oninput = applyFilters;
    resetBtn.onclick = () => {
        deptSel.value = ''; staffSel.value = ''; statusSel.value = '';
        if (fcSel) fcSel.value = '';
        searchInput.value = ''; applyFilters();
    };
}

loadAndRender();

// ── Invalid Number Alerts ─────────────────────────────────────────────────────

async function loadInvalidNumbers() {
    const container = document.getElementById('invalid-numbers-container');
    const badge = document.getElementById('invalid-numbers-badge');
    const card = document.getElementById('invalid-numbers-card');
    if (!container) return;
    try {
        const res = await fetch('/admin/invalid-numbers');
        if (!res.ok) return;
        const rows = await res.json();
        if (badge) badge.textContent = rows.length;
        if (card) card.style.display = rows.length === 0 ? 'none' : 'block';
        if (rows.length === 0) { container.innerHTML = ''; return; }
        container.innerHTML = rows.map(r => `
            <div id="inv-row-${CSS.escape(r.student_name)}" style="display:flex;align-items:flex-start;flex-wrap:wrap;gap:10px;padding:12px 0;border-bottom:1px solid #f3f4f6;">
                <div style="flex:1;min-width:160px;">
                    <strong>${r.student_name}</strong>
                    <span style="font-size:0.8rem;color:#666;margin-left:6px;">${r.department || ''}</span>
                    <div style="font-size:0.85rem;color:#e53e3e;font-weight:600;margin-top:2px;">&#128222; ${r.phone_number || '—'}</div>
                    <div style="font-size:0.78rem;color:#888;">Assigned: ${r.AssignedTo || 'Unassigned'}</div>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;flex:1;min-width:220px;">
                    <input type="tel" id="fix-phone-${CSS.escape(r.student_name)}" placeholder="Correct phone number"
                        style="padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:0.9rem;flex:1;min-width:130px;box-sizing:border-box;">
                    <button onclick="fixPhone('${r.student_name.replace(/'/g, "\\'")}')"
                        style="padding:8px 14px;background:#e53e3e;color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer;font-size:0.85rem;white-space:nowrap;">
                        Fix &amp; Dismiss
                    </button>
                </div>
            </div>`).join('');
    } catch (err) { console.error(err); }
}

async function fixPhone(studentName) {
    const input = document.getElementById(`fix-phone-${CSS.escape(studentName)}`);
    const newPhone = input ? input.value.trim() : '';
    if (!newPhone) { alert('Enter the correct phone number first.'); return; }
    try {
        const res = await fetch('/admin/fix-phone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ student_name: studentName, phone_number: newPhone })
        });
        if (res.ok) {
            showToast('Phone number updated');
            await loadInvalidNumbers();
        } else {
            showToast('Failed to update phone', false);
        }
    } catch { showToast('Network error', false); }
}

// ── Unavailability Requests ───────────────────────────────────────────────────

async function loadUnavailRequests() {
    const container = document.getElementById('unavail-requests-container');
    const badge = document.getElementById('unavail-badge');
    try {
        const res = await fetch('/admin/unavailability-requests');
        if (!res.ok) throw new Error('Failed');
        const requests = await res.json();
        badge.textContent = requests.length;
        badge.style.background = requests.length > 0 ? '#f59e0b' : '#888';

        if (requests.length === 0) {
            container.innerHTML = `<p class="small" style="color:var(--muted);">No pending requests.</p>`;
            return;
        }

        container.innerHTML = '';
        requests.forEach(req => {
            const card = document.createElement('div');
            card.style.cssText = 'border:1px solid rgba(31,41,55,0.12);border-radius:12px;padding:16px;margin-bottom:12px;background:#fafafa;';
            card.innerHTML = `
                <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:10px;">
                    <div>
                        <strong style="font-size:1rem;">${req.staff_name}</strong>
                        <div class="small" style="margin-top:4px;color:var(--muted);">
                            <span>📅 ${req.days} day(s)</span> &nbsp;·&nbsp;
                            <span>🕐 ${fmtDateTime(req.created_at)}</span>
                        </div>
                        <p style="margin:8px 0 0;font-size:0.92rem;">${req.reason}</p>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end;">
                        <button class="start-btn" onclick="approveUnavail(${req.id}, '${req.staff_name.replace(/'/g, "\\'")}')">Approve &amp; Reassign</button>
                        <div style="display:flex;gap:6px;align-items:center;">
                            <input type="text" id="reject-note-${req.id}" placeholder="Rejection reason (optional)" style="padding:7px 10px;border:1px solid #ccc;border-radius:8px;font-size:0.85rem;width:220px;">
                            <button class="delete-btn" onclick="rejectUnavail(${req.id})">Reject</button>
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

async function approveUnavail(id, staffName) {
    if (!confirm(`Approve unavailability for "${staffName}"? Their students will be auto-distributed to other available staff.`)) return;
    try {
        const res = await fetch('/admin/unavailability-approve', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.error || 'Failed', false); return; }
        showToast(`Approved. ${data.reassigned} of ${data.total} student(s) auto-reassigned.`);
        await loadUnavailRequests();
        await loadStaffOnBreak();
    } catch { showToast('Network error', false); }
}

async function rejectUnavail(id) {
    const note = (document.getElementById(`reject-note-${id}`)?.value || '').trim();
    if (!confirm('Reject this unavailability request?')) return;
    try {
        const res = await fetch('/admin/unavailability-reject', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, admin_note: note })
        });
        if (res.ok) { showToast('Request rejected'); await loadUnavailRequests(); }
        else showToast('Failed to reject', false);
    } catch { showToast('Network error', false); }
}

async function loadStaffOnBreak() {
    try {
        const res = await fetch('/admin/staff-on-break');
        const data = await res.json();
        const container = document.getElementById('staff-on-break-container');
        const badge = document.getElementById('break-badge');
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
                    <span style="margin-left:8px;font-size:0.8rem;background:#f3f6f5;border-radius:4px;padding:2px 7px;">${s.department || ''}</span>
                    ${s.days ? `<span class="small" style="margin-left:8px;color:var(--muted);">${s.days} day(s) · ${s.reason || ''}</span>` : ''}
                </div>
                <button class="start-btn" style="font-size:0.8rem;padding:6px 12px;" onclick="returnStaffFromBreak(${s.id}, '${s.staff_name.replace(/'/g, "\\'")}')">Mark Returned</button>
            </div>
        `).join('');
    } catch (err) {
        console.error(err);
    }
}

async function returnStaffFromBreak(id, name) {
    if (!confirm(`Mark ${name} as returned and reactivate their assignment?`)) return;
    try {
        const res = await fetch('/admin/update-staff-assignmode', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, dont_assign: false })
        });
        if (res.ok) { showToast(`${name} is now active again`); await loadStaffOnBreak(); await loadStaffDirectory(); }
        else showToast('Failed', false);
    } catch { showToast('Error', false); }
}

// ── Mobile nav helpers ──────────────────────────────────────────────────────
function setAdminMobActive(btn) {
    document.querySelectorAll('.mob-nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}

loadUnavailRequests();
loadInvalidNumbers();
loadStaffProgress();

// ── Staff Progress ────────────────────────────────────────────────────────────

let staffProgressData = [];

async function loadStaffProgress() {
    const container = document.getElementById('staff-progress-container');
    if (container) container.innerHTML = '<p class="small" style="color:var(--muted);">Loading…</p>';
    try {
        const res = await fetch('/admin/staff-progress');
        if (!res.ok) throw new Error('Failed');
        staffProgressData = await res.json();
        renderStaffProgress();
    } catch (err) {
        console.error(err);
        if (container) container.innerHTML = '<p class="small" style="color:#d64545;">Failed to load staff progress.</p>';
    }
}

function renderStaffProgress() {
    const container = document.getElementById('staff-progress-container');
    if (!container) return;

    const deptFilter = (document.getElementById('sp-filter-dept')?.value || '').trim();
    const sortVal = document.getElementById('sp-sort')?.value || 'assigned-desc';

    let data = staffProgressData.slice();
    if (deptFilter) data = data.filter(s => s.department === deptFilter);

    data.sort((a, b) => {
        const ta = parseInt(a.total_assigned), tb = parseInt(b.total_assigned);
        const fa = parseInt(a.followup_done), fb = parseInt(b.followup_done);
        const pa = ta > 0 ? fa / ta : 0, pb = tb > 0 ? fb / tb : 0;
        if (sortVal === 'assigned-desc') return tb - ta;
        if (sortVal === 'assigned-asc') return ta - tb;
        if (sortVal === 'progress-desc') return pb - pa;
        if (sortVal === 'progress-asc') return pa - pb;
        return a.staff_name.localeCompare(b.staff_name);
    });

    if (data.length === 0) {
        container.innerHTML = '<p class="small" style="color:var(--muted);">No staff found.</p>';
        return;
    }

    // Group by department for display (exclude Unknown)
    const byDept = {};
    data.forEach(s => {
        const d = s.department || 'Unknown';
        if (d === 'Unknown') return;
        if (!byDept[d]) byDept[d] = [];
        byDept[d].push(s);
    });

    let html = `
        <div style="overflow-x:auto;">
        <table class="followup-table" style="min-width:580px;">
            <thead>
                <tr>
                    <th>#</th>
                    <th>Staff Name</th>
                    <th>Dept</th>
                    <th>Status</th>
                    <th style="text-align:center;">Assigned</th>
                    <th style="text-align:center;">Followup Done</th>
                    <th style="text-align:center;">Pending</th>
                    <th style="min-width:140px;">Progress</th>
                </tr>
            </thead>
            <tbody>
    `;

    let idx = 1;
    data.forEach(s => {
        const total = parseInt(s.total_assigned) || 0;
        const done = parseInt(s.followup_done) || 0;
        const pending = total - done;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const barColor = pct >= 75 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444';
        const pausedBadge = s.dont_assign
            ? `<span style="font-size:0.7rem;background:#f59e0b;color:#fff;border-radius:4px;padding:1px 6px;margin-left:6px;">On Break</span>`
            : '';
        html += `
            <tr style="cursor:pointer;" onclick="filterStudentsByStaff('${s.staff_name.replace(/'/g, "\\'")}')">
                <td>${idx++}</td>
                <td><strong>${s.staff_name}</strong>${pausedBadge}</td>
                <td>${s.department || '—'}</td>
                <td>${s.dont_assign ? '<span style="color:#f59e0b;">Paused</span>' : '<span style="color:#22c55e;">Active</span>'}</td>
                <td style="text-align:center;font-weight:700;">${total}</td>
                <td style="text-align:center;color:#22c55e;font-weight:700;">${done}</td>
                <td style="text-align:center;color:#ef4444;font-weight:600;">${pending}</td>
                <td>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <div style="flex:1;background:#e5e7eb;border-radius:99px;height:8px;overflow:hidden;">
                            <div style="width:${pct}%;background:${barColor};height:100%;border-radius:99px;transition:width 0.4s;"></div>
                        </div>
                        <span style="font-size:0.8rem;font-weight:600;min-width:34px;text-align:right;">${pct}%</span>
                    </div>
                </td>
            </tr>
        `;
    });

    html += `</tbody></table></div>`;

    // Dept summary strip
    if (!deptFilter) {
        const depts = Object.keys(byDept);
        html += `<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:16px;">`;
        depts.forEach(dept => {
            const staffList = byDept[dept];
            const dTotal = staffList.reduce((s, x) => s + (parseInt(x.total_assigned) || 0), 0);
            const dDone  = staffList.reduce((s, x) => s + (parseInt(x.followup_done) || 0), 0);
            const dPct   = dTotal > 0 ? Math.round((dDone / dTotal) * 100) : 0;
            const col    = dPct >= 75 ? '#22c55e' : dPct >= 40 ? '#f59e0b' : '#ef4444';
            html += `
                <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:12px 18px;min-width:130px;">
                    <div style="font-weight:700;font-size:1rem;margin-bottom:4px;">${dept}</div>
                    <div style="font-size:0.82rem;color:#6b7280;">${staffList.length} staff · ${dTotal} students</div>
                    <div style="margin-top:8px;background:#e5e7eb;border-radius:99px;height:6px;">
                        <div style="width:${dPct}%;background:${col};height:100%;border-radius:99px;"></div>
                    </div>
                    <div style="font-size:0.78rem;font-weight:600;margin-top:4px;color:${col};">${dPct}% followups done</div>
                </div>
            `;
        });
        html += `</div>`;
    }

    container.innerHTML = html;
}

function toggleStaffProgress() {
    const container = document.getElementById('staff-progress-container');
    const controls = document.getElementById('sp-controls');
    const btn = document.getElementById('sp-toggle-btn');
    const collapsed = container.style.display === 'none';
    container.style.display = collapsed ? '' : 'none';
    controls.style.display = collapsed ? '' : 'none';
    btn.innerHTML = collapsed ? '&#x25B2;' : '&#x25BC;';
    btn.title = collapsed ? 'Collapse' : 'Expand';
}

function filterStudentsByStaff(staffName) {
    const staffSel = document.getElementById('filter-staff');
    if (!staffSel) return;
    staffSel.value = staffName;
    staffSel.dispatchEvent(new Event('change'));
    document.getElementById('student-followup-box')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function rebalanceAssignments() {
    if (!confirm(
        'Rebalance ALL student assignments?\n\n' +
        'This will redistribute every student across active staff in each department ' +
        'so workloads are equal. Current assignments will be replaced.\n\n' +
        'Proceed?'
    )) return;
    try {
        const res = await fetch('/admin/rebalance-assignments', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.error || 'Failed', false); return; }
        const detail = data.summary.map(s => `${s.dept}: ${s.students} students ÷ ${s.staff} staff = ${s.perStaff} each`).join('\n');
        alert(`Rebalance complete — ${data.totalUpdated} assignments updated.\n\n${detail}`);
        showToast(`${data.totalUpdated} assignments rebalanced.`);
        await loadAndRender();
        await loadStaffProgress();
    } catch { showToast('Network error', false); }
}

async function assignUnassigned() {
    if (!confirm('Auto-assign all unassigned students using round-robin? This will distribute them to available staff by department.')) return;
    try {
        const res = await fetch('/admin/assign-unassigned', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.error || 'Failed', false); return; }
        if (data.assigned === 0) {
            showToast('No unassigned students found.');
        } else {
            showToast(`Assigned ${data.assigned} of ${data.total} student(s) successfully.`);
            await loadAndRender();
        }
    } catch { showToast('Network error', false); }
}

// ── Staff Excel export ────────────────────────────────────────────────────────

function exportStaffExcel() {
    if (!allStaffData || allStaffData.length === 0) {
        showToast('No staff data loaded yet. Go to Staff Management first.', false);
        return;
    }
    const rows = allStaffData.map((s, i) => ({
        'Sr No': i + 1,
        'Name': s.staff_name || '',
        'Department': s.department || '',
        'Username': s.username || '',
        'Password': s.password || '',
        'Assignment': s.dont_assign ? 'Paused' : 'Active',
        'Designation': s.designation || ''
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Staff');
    const today = new Date();
    const fname = `staff_${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}.xlsx`;
    XLSX.writeFile(wb, fname);
}

// ── Department charts ─────────────────────────────────────────────────────────

function buildDepartmentCharts(data) {
    const container = document.getElementById('charts');
    if (!container) return;
    container.innerHTML = '';

    const stats = {};
    data.forEach(item => {
        const dept = item.department || 'Unknown';
        if (dept === 'Unknown') return;
        if (!stats[dept]) stats[dept] = { total: 0, followupDone: 0 };
        stats[dept].total += 1;
        let hasFollowup = false;
        for (let i = 1; i <= 7; i++) { if (item[`followup${i}`]) { hasFollowup = true; break; } }
        if (hasFollowup) stats[dept].followupDone += 1;
    });

    const deptNames = Object.keys(stats);
    if (deptNames.length > 0) {
        const totals = deptNames.map(d => stats[d].total);
        const overallCard = document.createElement('div');
        overallCard.style.cssText = 'background:white;padding:12px;border-radius:8px;box-shadow:0 4px 8px rgba(0,0,0,0.08);';
        const title = document.createElement('h3');
        title.textContent = 'Enquiries by Department';
        title.style.margin = '0 0 8px 0';
        overallCard.appendChild(title);
        const canvas = document.createElement('canvas');
        canvas.style.maxWidth = '100%';
        overallCard.appendChild(canvas);
        container.appendChild(overallCard);
        // eslint-disable-next-line no-undef
        new Chart(canvas, {
            type: 'doughnut',
            data: { labels: deptNames, datasets: [{ data: totals, backgroundColor: ['#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f','#edc949','#af7aa1'] }] },
            options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
        });
    }

    Object.keys(stats).forEach(dept => {
        const { total, followupDone } = stats[dept];
        const card = document.createElement('div');
        card.style.cssText = 'background:white;padding:12px;border-radius:8px;box-shadow:0 4px 8px rgba(0,0,0,0.08);';
        const title = document.createElement('h4');
        title.textContent = dept; title.style.margin = '0 0 8px 0';
        card.appendChild(title);
        const canvas = document.createElement('canvas');
        card.appendChild(canvas);
        const pct = total === 0 ? 0 : Math.round((followupDone / total) * 100);
        const analysis = document.createElement('div');
        analysis.style.marginTop = '8px';
        analysis.innerHTML = `<strong>${followupDone}/${total}</strong> followups done (${pct}%).`;
        card.appendChild(analysis);
        container.appendChild(card);
        // eslint-disable-next-line no-undef
        new Chart(canvas, {
            type: 'pie',
            data: { labels: ['Followup Done', 'No Followup'], datasets: [{ data: [followupDone, total - followupDone], backgroundColor: ['#27ae60', '#e74c3c'] }] },
            options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
        });
    });
}

// ── Student detail modal ──────────────────────────────────────────────────────

const ADMIN_FU_OPTIONS = ["Interested in Admission","Not Interested for Admission","Attending Seminar","Not Attending Seminar","Call Not Received","Invalid Number","Fill Admission/Option Form","Registration Done","Option 1/2/3 Filled","Branch Change","Allotted","Not Allotted","Betterment","Direct 2nd Year Admission","Shift to Direct 2nd Year Admission","Shift to Management","Exit from System","Other","Admission Taken","Admission Not Taken","Management"];

function fuSelectHTML(num, current) {
    const opts = ['<option value="">— clear —</option>', ...ADMIN_FU_OPTIONS.map(o => `<option value="${o}" ${current === o ? 'selected' : ''}>${o}</option>`)].join('');
    return `<select id="admin-fu-${num}" style="width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:0.88rem;">${opts}</select>`;
}

function openDetailModal(studentData) {
    const modal = document.getElementById('detailModal');
    const modalBody = document.getElementById('modalBody');

    modalBody.innerHTML = `
        <div class="modal-header">Student Details</div>
        <div class="modal-student-info">
            <div class="info-row"><span class="info-label">Name</span><span class="info-value">${studentData.student_name || 'N/A'}</span></div>
            <div class="info-row"><span class="info-label">Phone</span><span class="info-value">${studentData.phone_number || 'N/A'}</span></div>
            <div class="info-row"><span class="info-label">Department</span><span class="info-value">${studentData.department || 'N/A'}</span></div>
            <div class="info-row"><span class="info-label">Board</span><span class="info-value">${studentData.board || 'N/A'}</span></div>
            <div class="info-row"><span class="info-label">Caste</span><span class="info-value">${studentData.caste || 'N/A'}</span></div>
            <div class="info-row"><span class="info-label">Annual Income</span><span class="info-value">${studentData.annual_income || 'N/A'}</span></div>
            <div class="info-row"><span class="info-label">Percentage</span><span class="info-value">${studentData.percentage !== null && studentData.percentage !== undefined ? studentData.percentage + '%' : 'N/A'}</span></div>
            <div class="info-row"><span class="info-label">Assigned To</span><span class="info-value">${studentData.AssignedTo || 'Unassigned'}</span></div>
            <div class="info-row"><span class="info-label">Created By</span><span class="info-value">${studentData.CreatedBy || 'N/A'}</span></div>
            <div class="info-row"><span class="info-label">Registered On</span><span class="info-value">${fmtDateTime(studentData.enquiry_created_at || studentData.created_at)}</span></div>
        </div>
        <div class="modal-followups">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                <h4 style="margin:0;">Follow-up Status (F1–F7)</h4>
                <button class="start-btn" onclick="saveAdminFollowups('${(studentData.student_name||'').replace(/'/g,"\\'")}')">Save Changes</button>
            </div>
            ${[1,2,3,4,5,6,7].map(i => `
                <div class="followup-item" style="margin-bottom:8px;">
                    <div class="followup-label" style="margin-bottom:4px;font-weight:600;font-size:0.82rem;">Follow-up ${i}</div>
                    ${fuSelectHTML(i, studentData[`followup${i}`] || '')}
                </div>
            `).join('')}
        </div>
    `;
    modal.style.display = 'flex';
}

async function saveAdminFollowups(studentName) {
    const payload = { student_name: studentName };
    for (let i = 1; i <= 7; i++) {
        const sel = document.getElementById(`admin-fu-${i}`);
        payload[`followup${i}`] = sel ? sel.value : '';
    }
    try {
        const res = await fetch('/admin/update-followups', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            showToast('Follow-ups updated');
            closeDetailModal();
            if (typeof loadAllStatus === 'function') loadAllStatus();
        } else showToast('Failed to update', false);
    } catch { showToast('Error', false); }
}

function closeDetailModal() {
    document.getElementById('detailModal').style.display = 'none';
}

document.addEventListener('click', (e) => {
    if (e.target === document.getElementById('detailModal')) closeDetailModal();
    if (e.target === document.getElementById('edit-staff-modal')) closeEditStaffModal();
});

// ── Staff Directory ───────────────────────────────────────────────────────────

let allStaffData = [];

async function loadStaffDirectory() {
    try {
        const res = await fetch("/admin/full-staff-list");
        if (!res.ok) throw new Error("Failed");
        allStaffData = await res.json();
        renderStaffDirectory();
    } catch (err) {
        console.error(err);
        showToast("Failed to load staff", false);
    }
}

function renderStaffDirectory(filter = "") {
    const tbody = document.getElementById("staff-dir-body");
    if (!tbody) return;
    const q = filter.toLowerCase().trim();
    const visible = allStaffData.filter(s =>
        !q ||
        s.staff_name.toLowerCase().includes(q) ||
        (s.username || '').toLowerCase().includes(q) ||
        (s.department || '').toLowerCase().includes(q) ||
        (s.password || '').toLowerCase().includes(q) ||
        (s.designation || '').toLowerCase().includes(q)
    );
    if (visible.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--muted);">No staff found.</td></tr>`;
        return;
    }
    tbody.innerHTML = visible.map((s, i) => `
        <tr>
            <td>${i + 1}</td>
            <td><strong>${s.staff_name}</strong>${s.designation === 'HOD' ? ' <span style="font-size:0.7rem;background:#0b6e6b;color:#fff;border-radius:4px;padding:1px 5px;vertical-align:middle;">HOD</span>' : ''}</td>
            <td>${s.username || '—'}</td>
            <td>${s.password || '—'}</td>
            <td>
                <select class="dept-select" onchange="updateStaffDept(${s.id}, this.value)">
                    ${['AN','TE','CE','ME','AE'].map(d => `<option value="${d}" ${s.department === d ? 'selected' : ''}>${d}</option>`).join('')}
                </select>
            </td>
            <td>
                <label class="toggle-wrap">
                    <input type="checkbox" ${s.dont_assign ? 'checked' : ''} onchange="updateStaffAssign(${s.id}, this.checked)">
                    <span class="status ${s.dont_assign ? 'pending' : 'completed'}">${s.dont_assign ? 'Paused' : 'Active'}</span>
                </label>
            </td>
            <td class="table-actions">
                <button class="start-btn" onclick="openEditStaffModal(${s.id})">Edit</button>
                <button class="delete-btn" onclick="confirmDeleteStaff(${s.id}, '${s.staff_name.replace(/'/g, "\\'")}')">Delete</button>
            </td>
        </tr>
    `).join('');
}

document.getElementById("staff-search-input") && document.getElementById("staff-search-input").addEventListener("input", e => renderStaffDirectory(e.target.value));

async function updateStaffDept(id, dept) {
    try {
        const res = await fetch("/admin/update-staff-department", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, department: dept })
        });
        if (res.ok) { showToast("Department updated"); Object.keys(staffCache).forEach(k => delete staffCache[k]); }
        else showToast("Update failed", false);
    } catch { showToast("Error", false); }
}

async function updateStaffAssign(id, checked) {
    try {
        const res = await fetch("/admin/update-staff-assignmode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, dont_assign: checked })
        });
        if (res.ok) { showToast("Assignment mode updated"); await loadStaffDirectory(); }
        else showToast("Update failed", false);
    } catch { showToast("Error", false); }
}


async function confirmDeleteStaff(id, name) {
    if (!confirm(`Delete staff "${name}"? This cannot be undone.`)) return;
    try {
        const res = await fetch("/admin/delete-staff", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id })
        });
        if (res.ok) { showToast(`${name} deleted`); await loadStaffDirectory(); Object.keys(staffCache).forEach(k => delete staffCache[k]); }
        else showToast("Delete failed", false);
    } catch { showToast("Error", false); }
}

// Create staff
document.getElementById("create-staff-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const staff_name = document.getElementById("new-staff-name").value.trim();
    const username   = document.getElementById("new-staff-username").value.trim();
    const password   = document.getElementById("new-staff-password").value.trim();
    const department = document.getElementById("new-staff-dept").value;
    if (!staff_name || !username || !password || !department) { alert("All fields required"); return; }

    const btn = document.getElementById("create-staff-btn");
    btn.disabled = true; btn.textContent = "Adding…";
    try {
        const res = await fetch("/admin/create-staff", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ staff_name, username, password, department })
        });
        if (res.ok) {
            showToast(`${staff_name} added`);
            document.getElementById("create-staff-form").reset();
            await loadStaffDirectory();
            Object.keys(staffCache).forEach(k => delete staffCache[k]);
        } else {
            const err = await res.json();
            showToast(err.error || "Failed", false);
        }
    } catch { showToast("Network error", false); }
    finally { btn.disabled = false; btn.textContent = "Add Staff"; }
});

// Edit staff modal
function openEditStaffModal(id) {
    const s = allStaffData.find(x => x.id === id);
    if (!s) return;
    document.getElementById("edit-staff-id").value       = s.id;
    document.getElementById("edit-staff-name").value     = s.staff_name;
    document.getElementById("edit-staff-username").value = s.username || "";
    document.getElementById("edit-staff-pw").value       = s.password || "";
    document.getElementById("edit-staff-dept").value     = s.department;
    document.getElementById("edit-staff-modal").style.display = "flex";
}

function closeEditStaffModal() {
    document.getElementById("edit-staff-modal").style.display = "none";
}

async function saveEditStaff() {
    const id         = document.getElementById("edit-staff-id").value;
    const staff_name = document.getElementById("edit-staff-name").value.trim();
    const username   = document.getElementById("edit-staff-username").value.trim();
    const password   = document.getElementById("edit-staff-pw").value.trim();
    const department = document.getElementById("edit-staff-dept").value;
    if (!staff_name || !username || !password) { alert("All fields required"); return; }
    try {
        const res = await fetch("/admin/update-staff", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, staff_name, username, password, department })
        });
        if (res.ok) {
            showToast("Staff updated");
            closeEditStaffModal();
            await loadStaffDirectory();
            Object.keys(staffCache).forEach(k => delete staffCache[k]);
        } else showToast("Update failed", false);
    } catch { showToast("Error", false); }
}



// ── Download Full Backup as Excel ─────────────────────────────────────────────
async function downloadBackup() {
    try {
        const res = await fetch("/admin/download-backup");
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || "No backup available yet.");
            return;
        }
        const { data, backup_time } = await res.json();
        if (!data || data.length === 0) { alert("Backup is empty."); return; }

        const sheetData = data.map((r, i) => ({
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
            "FC Confirmed": r.fc_confirmed ? "Yes" : "No",
            "Enquiry Date": r.enquiry_created_at ? new Date(r.enquiry_created_at).toLocaleDateString("en-IN") : "",
            "Follow-up 1": r.followup1 || "",
            "Follow-up 2": r.followup2 || "",
            "Follow-up 3": r.followup3 || "",
            "Follow-up 4": r.followup4 || "",
            "Follow-up 5": r.followup5 || "",
            "Follow-up 6": r.followup6 || "",
            "Follow-up 7": r.followup7 || "",
            "Last Follow-up Date": r.last_followup_date ? new Date(r.last_followup_date).toLocaleDateString("en-IN") : ""
        }));

        const ws = XLSX.utils.json_to_sheet(sheetData);
        ws["!cols"] = [
            {wch:4},{wch:28},{wch:14},{wch:10},{wch:10},{wch:10},{wch:12},{wch:14},
            {wch:18},{wch:22},{wch:8},{wch:14},{wch:20},{wch:20},{wch:20},{wch:20},{wch:20},{wch:20},{wch:20},{wch:14}
        ];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "All Students");
        const ts = backup_time ? new Date(backup_time).toISOString().slice(0,10) : new Date().toISOString().slice(0,10);
        XLSX.writeFile(wb, `AgneI_Backup_${ts}.xlsx`);
    } catch (err) {
        alert("Backup download failed: " + err.message);
    }
}
