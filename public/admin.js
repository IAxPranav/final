// 1. Keep the base array
const followups = Array.from({ length: 7 }, (_, i) => ({
    id: i + 1,
    status: 'pending'
}));

// 2. NEW: Function to sync the UI with the Database
async function syncPhaseWithDatabase() {
    try {
        const response = await fetch("/admin/get-current-phase");
        const data = await response.json();
        const currentId = parseInt(data.phase);

        // Update the array statuses based on the database
        followups.forEach(fu => {
            if (fu.id < currentId) {
                fu.status = 'completed';
            } else if (fu.id === currentId) {
                fu.status = 'active';
            } else {
                fu.status = 'pending';
            }
        });

        renderFollowups(); // Redraw the UI with correct buttons
    } catch (err) {
        console.error("Sync error:", err);
    }
}

// 3. Call this on page load instead of just renderFollowups()
syncPhaseWithDatabase();

function renderFollowups() {
    const container = document.getElementById('followupManager');
    container.innerHTML = followups.map(fu => {
        // previous followup status (for id=1 treat as no previous)
        const prevStatus = fu.id === 1 ? 'completed' : followups[fu.id - 2].status;
        // allow starting only if this is pending and previous is completed (or it's the first)
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
                        <button class="start-btn" id="start-btn-${fu.id}" onclick="startFollowup(${fu.id})" 
                            ${!canStart ? 'disabled' : ''}>
                            Start Followup ${fu.id}
                        </button>
                    </div>
                `;
    }).join('');
}

function finalizeFollowup(id) {
    const fu = followups.find(f => f.id === id);
    if (fu && fu.status === 'active') {
        fu.status = 'completed';
        console.log(`Followup ${id} has finalized`);
        // Do not auto-activate the next followup; allow user to start it after previous is completed
        renderFollowups();
    }
}

async function startFollowup(id) {
    const fu = followups.find(f => f.id === id);
    const prevCompleted = id === 1 || followups[id - 2].status === 'completed';

    if (fu && fu.status === 'pending' && prevCompleted) {
        // Change the URL here to match your server.js route
        const response = await fetch(`/admin/switch-phase/${id}`);

        if (response.ok) {
            fu.status = 'active';
            console.log(`System successfully switched to Followup ${id}`);
            renderFollowups();
        } else {
            alert("Failed to switch phase on the server.");
        }
    }
}

renderFollowups();

async function fetchFollowups() {
    try {
        const response = await fetch("/view-all-status");
        if (!response.ok) throw new Error("Network response was not ok");

        let data = await response.json();
        const container = document.getElementById("student-followup-box");

        // ... Keep your sorting logic here ...

        container.innerHTML = `
            <table class="followup-table">
                <thead>
                    <tr>
                        <th>Student Name</th>
                        <th>Phone</th>
                        <th>Department</th>
                        <th>Assigned To</th> <th>Latest Status</th>
                        <th>Date</th>
                    </tr>
                </thead>
                <tbody id="allStatusTableBody"></tbody>
            </table>
        `;

        const tableBody = document.getElementById("allStatusTableBody");

        data.forEach(item => {
            const dateStr = item.created_at ? new Date(item.created_at).toLocaleDateString('en-GB') : "Pending";

            let latestStatus = "No follow-up yet";
            for (let i = 7; i >= 1; i--) {
                if (item[`followup${i}`]) {
                    latestStatus = `F${i}: ${item[`followup${i}`]}`;
                    break;
                }
            }

            const rowClass = (latestStatus === "No follow-up yet") ? "row-pending" : "row-completed";
            const tr = document.createElement("tr");
            tr.className = rowClass;

            tr.innerHTML = `
                <td>${item.student_name}</td>
                <td>${item.phone_number}</td>
                <td>${item.department}</td>
                <td><span class="staff-tag">${item.AssignedTo || 'Unassigned'}</span></td> <td><strong>${latestStatus}</strong></td>
                <td>${dateStr}</td>
            `;
            tableBody.appendChild(tr);
        });
    } catch (err) {
        console.error("Fetch error:", err);
    }
}
fetchFollowups();

// --- New: make AssignedTo editable for admins ---
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

let latestData = [];

// Re-render followups table to include editable select for AssignedTo
async function renderFollowupsEditable(data) {
    try {
        // `data` is passed in by caller (already fetched)
        if (!data) return;
        const container = document.getElementById("student-followup-box");

        container.innerHTML = `
            <table class="followup-table">
                <thead>
                    <tr>
                        <th>Student Name</th>
                        <th>Phone</th>
                        <th>Department</th>
                        <th>Assigned To</th>
                        <th>Latest Status</th>
                        <th>Date</th>
                    </tr>
                </thead>
                <tbody id="allStatusTableBody"></tbody>
            </table>
        `;

        const tableBody = document.getElementById("allStatusTableBody");

        // compute latest status and sort: No follow-up yet first
        const enriched = data.map(item => {
            let latestStatus = "No follow-up yet";
            for (let i = 7; i >= 1; i--) {
                if (item[`followup${i}`]) {
                    latestStatus = `F${i}: ${item[`followup${i}`]}`;
                    break;
                }
            }
            return { item, latestStatus };
        });

        enriched.sort((a, b) => {
            const aPending = a.latestStatus === 'No follow-up yet';
            const bPending = b.latestStatus === 'No follow-up yet';
            if (aPending === bPending) return a.item.student_name.localeCompare(b.item.student_name);
            return aPending ? -1 : 1; // pending first
        });

        for (const row of enriched) {
            const item = row.item;
            const latestStatus = row.latestStatus;
            const dateStr = item.created_at ? new Date(item.created_at).toLocaleDateString('en-GB') : "Pending";
            const tr = document.createElement("tr");

            // build select for assigned staff + confirm button
            const staffList = await getStaffForDepartment(item.department);
            const select = document.createElement('select');
            select.className = 'assigned-select';
            select.dataset.student = item.student_name;

            const emptyOpt = document.createElement('option');
            emptyOpt.value = '';
            emptyOpt.textContent = 'Unassigned';
            select.appendChild(emptyOpt);
            staffList.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                select.appendChild(opt);
            });
            select.value = item.AssignedTo || '';

            const confirmBtn = document.createElement('button');
            confirmBtn.textContent = 'Confirm';
            confirmBtn.disabled = true;
            confirmBtn.style.marginLeft = '8px';
            confirmBtn.className = 'start-btn';

            tr.innerHTML = `
                <td>${item.student_name}</td>
                <td>${item.phone_number}</td>
                <td>${item.department}</td>
                <td></td>
                <td><strong>${latestStatus}</strong></td>
                <td>${dateStr}</td>
            `;

            const cell = tr.children[3];
            cell.appendChild(select);
            cell.appendChild(confirmBtn);

            // set row color class based on latestStatus
            if (latestStatus === 'No follow-up yet') tr.classList.add('row-pending');
            else tr.classList.add('row-completed');

            tableBody.appendChild(tr);

            // interactions
            select.addEventListener('change', () => {
                confirmBtn.disabled = false;
            });

            confirmBtn.addEventListener('click', async () => {
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
                    // success UI
                    showToast(`Assigned updated for ${student}`);
                    // mark row as completed (green)
                    tr.classList.remove('row-pending');
                    tr.classList.add('row-completed');
                    // small saved flash
                    select.classList.add('saved');
                    setTimeout(() => select.classList.remove('saved'), 1200);
                } catch (err) {
                    console.error(err);
                    showToast('Failed to update assignment', false);
                    confirmBtn.disabled = false;
                }
            });
        }


        // Build department-wise statistics charts
        buildDepartmentCharts(data);

        // Populate filter controls (departments & staff)
        populateFilters(data);

    } catch (err) {
        console.error('Fetch error:', err);
    }
}

// fetch latest data and render
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
    const deptSet = new Set();
    const staffSet = new Set();
    data.forEach(d => {
        if (d.department) deptSet.add(d.department);
        if (d.AssignedTo) staffSet.add(d.AssignedTo);
    });

    const deptSel = document.getElementById('filter-dept');
    const staffSel = document.getElementById('filter-staff');
    const statusSel = document.getElementById('filter-status');
    const searchInput = document.getElementById('filter-search');
    const resetBtn = document.getElementById('filter-reset');

    // clear existing options (keep the first 'All')
    deptSel.querySelectorAll('option:not([value=""])').forEach(n=>n.remove());
    staffSel.querySelectorAll('option:not([value=""])').forEach(n=>n.remove());

    Array.from(deptSet).sort().forEach(d => {
        const opt = document.createElement('option'); opt.value = d; opt.textContent = d; deptSel.appendChild(opt);
    });
    Array.from(staffSet).sort().forEach(s => {
        const opt = document.createElement('option'); opt.value = s; opt.textContent = s; staffSel.appendChild(opt);
    });

    function applyFilters() {
        const dept = deptSel.value;
        const staff = staffSel.value;
        const status = statusSel.value;
        const search = (searchInput.value || '').trim().toLowerCase();

        let filtered = latestData.slice();
        if (dept) filtered = filtered.filter(r => r.department === dept);
        if (staff) filtered = filtered.filter(r => (r.AssignedTo || '') === staff);
        if (status) {
            if (status === 'no-followup') filtered = filtered.filter(r => {
                let has = false; for (let i=1;i<=7;i++) if (r[`followup${i}`]) { has = true; break; } return !has;
            });
            else if (status === 'followup') filtered = filtered.filter(r => {
                let has = false; for (let i=1;i<=7;i++) if (r[`followup${i}`]) { has = true; break; } return has;
            });
        }
        if (search) filtered = filtered.filter(r => (r.student_name || '').toLowerCase().includes(search));

        renderFollowupsEditable(filtered);
    }

    deptSel.onchange = applyFilters;
    staffSel.onchange = applyFilters;
    statusSel.onchange = applyFilters;
    searchInput.oninput = applyFilters;
    resetBtn.onclick = () => { deptSel.value=''; staffSel.value=''; statusSel.value=''; searchInput.value=''; applyFilters(); };
}

// initial load
loadAndRender();

function showToast(message, success = true) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.style.background = success ? '#27ae60' : '#e74c3c';
    t.textContent = message;
    t.style.display = 'block';
    setTimeout(() => { t.style.display = 'none'; }, 2000);
}

function buildDepartmentCharts(data) {
    const container = document.getElementById('charts');
    if (!container) return;
    container.innerHTML = '';

    const stats = {};
    data.forEach(item => {
        const dept = item.department || 'Unknown';
        if (!stats[dept]) stats[dept] = { total: 0, followupDone: 0 };
        stats[dept].total += 1;
        let hasFollowup = false;
        for (let i = 1; i <= 7; i++) {
            if (item[`followup${i}`]) { hasFollowup = true; break; }
        }
        if (hasFollowup) stats[dept].followupDone += 1;
    });

    // --- Overall department breakdown chart ---
    const deptNames = Object.keys(stats);
    if (deptNames.length > 0) {
        const totals = deptNames.map(d => stats[d].total);

        const overallCard = document.createElement('div');
        overallCard.style.width = '480px';
        overallCard.style.background = 'white';
        overallCard.style.padding = '12px';
        overallCard.style.borderRadius = '8px';
        overallCard.style.boxShadow = '0 4px 8px rgba(0,0,0,0.08)';
        overallCard.style.flex = '1 1 480px';

        const title = document.createElement('h3');
        title.textContent = 'Enquiries by Department (Total)';
        title.style.margin = '0 0 8px 0';
        overallCard.appendChild(title);

        const canvas = document.createElement('canvas');
        canvas.width = 420;
        canvas.height = 260;
        overallCard.appendChild(canvas);

        const list = document.createElement('div');
        list.style.marginTop = '8px';
        // build textual percentage breakdown
        const grandTotal = totals.reduce((a, b) => a + b, 0) || 1;
        const parts = deptNames.map((d, i) => {
            const pct = Math.round((totals[i] / grandTotal) * 100);
            return `<div style="font-size:0.95em;margin-bottom:4px;"><strong>${d}:</strong> ${totals[i]} enquiries (${pct}%)</div>`;
        });
        list.innerHTML = parts.join('');
        overallCard.appendChild(list);

        container.appendChild(overallCard);

        // draw overall doughnut
        const ctx = canvas.getContext('2d');
        // eslint-disable-next-line no-undef
        new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: deptNames,
                datasets: [{ data: totals, backgroundColor: deptNames.map((_,i)=>['#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f','#edc949','#af7aa1'][i%7]) }]
            },
            options: { responsive: false, plugins: { legend: { position: 'bottom' } } }
        });
    }

    Object.keys(stats).forEach(dept => {
        const { total, followupDone } = stats[dept];
        const noFollow = total - followupDone;

        const card = document.createElement('div');
        card.style.width = '280px';
        card.style.background = 'white';
        card.style.padding = '12px';
        card.style.borderRadius = '8px';
        card.style.boxShadow = '0 4px 8px rgba(0,0,0,0.08)';

        const title = document.createElement('h4');
        title.textContent = dept;
        title.style.margin = '0 0 8px 0';
        card.appendChild(title);

        const canvas = document.createElement('canvas');
        canvas.width = 260;
        canvas.height = 160;
        card.appendChild(canvas);

        const analysis = document.createElement('div');
        analysis.style.marginTop = '8px';
        const percentDone = total === 0 ? 0 : Math.round((followupDone / total) * 100);
        analysis.innerHTML = `<strong>${followupDone}/${total}</strong> followups done (${percentDone}%).`;
        card.appendChild(analysis);

        container.appendChild(card);

        // draw chart
        const ctx = canvas.getContext('2d');
        // eslint-disable-next-line no-undef
        new Chart(ctx, {
            type: 'pie',
            data: {
                labels: ['Followup Done', 'No Followup'],
                datasets: [{
                    data: [followupDone, noFollow],
                    backgroundColor: ['#27ae60', '#e74c3c']
                }]
            },
            options: {
                responsive: false,
                plugins: {
                    legend: { position: 'bottom' }
                }
            }
        });
    });
}
// --- Staff Management Logic ---

async function fetchAndRenderStaff() {
    try {
        const res = await fetch("/admin/full-staff-list");
        if (!res.ok) throw new Error("Failed to load staff list");
        const staffList = await res.json();
        
        const tbody = document.getElementById("staff-table-body");
        if (!tbody) return;
        
        tbody.innerHTML = staffList.map(staff => `
            <tr>
                <td>${staff.staff_name}</td>
                <td>${staff.department}</td>
                <td>
                    <span class="status ${staff.dont_assign ? 'pending' : 'completed'}">
                        ${staff.dont_assign ? 'Don\'t Assign' : 'Active'}
                    </span>
                </td>
                <td>
                    <button class="start-btn" onclick="toggleStaffAssignment(${staff.id}, ${staff.dont_assign})">
                        ${staff.dont_assign ? 'Enable Assignment' : 'Disable Assignment'}
                    </button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error(err);
    }
}

async function toggleStaffAssignment(id, currentStatus) {
    try {
        const res = await fetch("/admin/update-staff-assignmode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, dont_assign: !currentStatus })
        });
        
        if (res.ok) {
            showToast("Staff assignment status updated");
            fetchAndRenderStaff();
        } else {
            showToast("Failed to update status", false);
        }
    } catch (err) {
        console.error(err);
        showToast("Error updating status", false);
    }
}

// Initial load for staff management
fetchAndRenderStaff();
