// Principal dashboard script
const principalState = { data: [], activeFilter: null };

function showToast(msg, ok = true) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.style.background = ok ? '#27ae60' : '#e74c3c';
    t.textContent = msg;
    t.style.display = 'block';
    setTimeout(() => t.style.display = 'none', 2200);
}

async function fetchAllData() {
    const res = await fetch('/view-all-status');
    if (!res.ok) throw new Error('Failed to load');
    principalState.data = await res.json();
}

function computeLatestStatus(item) {
    for (let i = 7; i >= 1; i--) if (item[`followup${i}`]) return `F${i}: ${item[`followup${i}`]}`;
    return 'No follow-up yet';
}

function renderSummary() {
    const container = document.getElementById('summary-cards');
    container.innerHTML = '';
    const total = principalState.data.length;
    let assigned = 0;
    let followupDone = 0;
    principalState.data.forEach(d => {
        if (d.AssignedTo && d.AssignedTo.trim() !== '' && d.AssignedTo.trim().toLowerCase() !== 'null') assigned++;
        if (computeLatestStatus(d) !== 'No follow-up yet') followupDone++;
    });
    const unassigned = total - assigned;

    const cards = [
        { title: 'Total Enquiries', value: total, filter: 'total' },
        { title: 'Assigned', value: assigned, filter: 'assigned' },
        { title: 'Unassigned', value: unassigned, filter: 'unassigned' },
        { title: 'Followups Done', value: followupDone, filter: 'followupDone' }
    ];
    cards.forEach(c => {
        const el = document.createElement('div');
        el.className = 'summary-card';
        el.style.cursor = 'pointer';
        el.style.transition = 'box-shadow 0.15s, transform 0.15s';
        el.innerHTML = `<div class="small">${c.title}</div><div style="font-size:1.4em;font-weight:700">${c.value}</div>`;
        el.addEventListener('mouseenter', () => { el.style.boxShadow = '0 4px 14px rgba(0,0,0,0.14)'; el.style.transform = 'translateY(-2px)'; });
        el.addEventListener('mouseleave', () => { el.style.boxShadow = ''; el.style.transform = ''; });
        el.addEventListener('click', () => {
            if (principalState.activeFilter === c.filter) {
                principalState.activeFilter = null;
                container.querySelectorAll('.summary-card').forEach(s => s.style.outline = '');
            } else {
                principalState.activeFilter = c.filter;
                container.querySelectorAll('.summary-card').forEach(s => s.style.outline = '');
                el.style.outline = '2px solid #1ca37e';
            }
            renderTable();
        });
        container.appendChild(el);
    });
}

function renderCharts() {
    const container = document.getElementById('principal-charts');
    container.innerHTML = '';

    const deptStats = {};
    principalState.data.forEach(d => {
        const dep = d.department || 'Unknown';
        if (dep === 'Unknown') return;
        if (!deptStats[dep]) deptStats[dep] = { total: 0, done: 0 };
        deptStats[dep].total++;
        if (computeLatestStatus(d) !== 'No follow-up yet') deptStats[dep].done++;
    });
    const depts = Object.keys(deptStats);
    const totals = depts.map(d => deptStats[d].total);
    const dones = depts.map(d => deptStats[d].done);

    const overallCard = document.createElement('div');
    overallCard.style.width = '420px'; overallCard.style.background = 'white'; overallCard.style.padding = '12px';
    overallCard.style.borderRadius = '8px'; overallCard.style.boxShadow = '0 4px 8px rgba(0,0,0,0.06)';
    const canvas1 = document.createElement('canvas'); canvas1.width = 380; canvas1.height = 240;
    overallCard.appendChild(canvas1); container.appendChild(overallCard);
    new Chart(canvas1.getContext('2d'), {
        type: 'doughnut',
        data: { labels: depts, datasets: [{ data: totals, backgroundColor: depts.map((_, i) => ['#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f','#edc949','#af7aa1'][i % 7]) }] },
        options: { responsive: false, plugins: { legend: { position: 'bottom' } } }
    });

    const barCard = document.createElement('div');
    barCard.style.width = '520px'; barCard.style.background = 'white'; barCard.style.padding = '12px';
    barCard.style.borderRadius = '8px'; barCard.style.boxShadow = '0 4px 8px rgba(0,0,0,0.06)';
    const canvas2 = document.createElement('canvas'); canvas2.width = 480; canvas2.height = 240;
    barCard.appendChild(canvas2); container.appendChild(barCard);
    new Chart(canvas2.getContext('2d'), {
        type: 'bar',
        data: { labels: depts, datasets: [{ label: 'Followups Done', data: dones, backgroundColor: '#27ae60' }, { label: 'No Followup', data: depts.map((d, i) => totals[i] - dones[i]), backgroundColor: '#e74c3c' }] },
        options: { responsive: false, scales: { y: { beginAtZero: true } } }
    });
}

function getFilteredData() {
    const filterDept    = document.getElementById('principal-filter-dept').value;
    const filterStaff   = document.getElementById('principal-filter-staff').value;
    const filterFollowup = document.getElementById('principal-filter-followup').value;
    const filterType    = document.getElementById('principal-filter-type').value;
    const searchQ       = (document.getElementById('principal-search').value || '').toLowerCase();

    return principalState.data.filter(item => {
        // Summary card filter
        if (principalState.activeFilter === 'assigned') {
            const isAssigned = item.AssignedTo && item.AssignedTo.trim() !== '' && item.AssignedTo.trim().toLowerCase() !== 'null';
            if (!isAssigned) return false;
        } else if (principalState.activeFilter === 'unassigned') {
            const isAssigned = item.AssignedTo && item.AssignedTo.trim() !== '' && item.AssignedTo.trim().toLowerCase() !== 'null';
            if (isAssigned) return false;
        } else if (principalState.activeFilter === 'followupDone') {
            if (computeLatestStatus(item) === 'No follow-up yet') return false;
        }

        if (filterDept && item.department !== filterDept) return false;
        if (filterStaff && item.AssignedTo !== filterStaff) return false;
        const latestStatus = computeLatestStatus(item);
        const hasFollowup = latestStatus !== 'No follow-up yet';
        if (filterFollowup === 'has-followup' && !hasFollowup) return false;
        if (filterFollowup === 'no-followup' && hasFollowup) return false;
        if (filterType) {
            let rawLatest = '';
            for (let i = 7; i >= 1; i--) { if (item[`followup${i}`]) { rawLatest = item[`followup${i}`]; break; } }
            if (!rawLatest.toLowerCase().includes(filterType.toLowerCase())) return false;
        }
        const filterFc = document.getElementById('principal-filter-fc')?.value || '';
        if (filterFc === 'confirmed' && !item.fc_confirmed) return false;
        if (filterFc === 'not-confirmed' && item.fc_confirmed) return false;
        if (searchQ && !(item.student_name || '').toLowerCase().includes(searchQ)) return false;
        return true;
    });
}

function renderTable() {
    const filtered = getFilteredData();
    const tbody = document.getElementById('principal-table-body');
    tbody.innerHTML = '';

    filtered.forEach(item => {
        const tr = document.createElement('tr');
        const latest = computeLatestStatus(item);
        const dateStr = (() => {
            const raw = item.enquiry_created_at || item.created_at;
            if (!raw) return 'Pending';
            const d = new Date(raw);
            return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        })();

        const assignedTo = (item.AssignedTo && item.AssignedTo.trim() !== '' && item.AssignedTo.trim().toLowerCase() !== 'null')
            ? item.AssignedTo : '—';
        const fcBadge = item.fc_confirmed
            ? ' <span style="font-size:0.68rem;background:#d97706;color:#fff;border-radius:3px;padding:1px 5px;vertical-align:middle;">FC</span>'
            : '';
        if (item.fc_confirmed) tr.style.background = '#fefce8';

        tr.innerHTML = `
            <td>${item.student_name || '—'}${fcBadge}</td>
            <td>${item.phone_number || '—'}</td>
            <td>${item.department || '—'}</td>
            <td>${item.board || '—'}</td>
            <td>${assignedTo}</td>
            <td><strong>${latest}</strong></td>
            <td>${dateStr}</td>
        `;

        if (latest === 'No follow-up yet') tr.classList.add('row-pending');
        else tr.classList.add('row-completed');

        tbody.appendChild(tr);
    });
}

async function loadAndRenderPrincipal() {
    try {
        await fetchAllData();
        renderSummary();
        renderCharts();

        const deptSel = document.getElementById('principal-filter-dept');
        deptSel.innerHTML = '<option value="">All</option>';
        ['AN', 'TE', 'ME', 'AE', 'CE'].forEach(d => {
            const o = document.createElement('option'); o.value = d; o.textContent = d; deptSel.appendChild(o);
        });

        const staffSel = document.getElementById('principal-filter-staff');
        staffSel.innerHTML = '<option value="">All</option>';
        const staffNames = [...new Set(principalState.data.map(d => d.AssignedTo).filter(Boolean))].sort();
        staffNames.forEach(s => {
            const o = document.createElement('option'); o.value = s; o.textContent = s; staffSel.appendChild(o);
        });

        renderTable();
        setupStickyScroll();
        loadStaffProgress();
    } catch (err) {
        console.error(err);
        showToast('Load failed', false);
    }
}

// ── Sticky horizontal scrollbar ───────────────────────────────────────────────

function setupStickyScroll() {
    const tableCard = document.querySelector('.table-card');
    if (!tableCard) return;

    // Remove any existing ghost
    const old = document.getElementById('sticky-scroll-ghost');
    if (old) old.remove();

    const ghost = document.createElement('div');
    ghost.id = 'sticky-scroll-ghost';
    ghost.style.cssText = `
        position: sticky;
        bottom: 0;
        overflow-x: auto;
        overflow-y: hidden;
        height: 14px;
        z-index: 10;
        background: rgba(255,255,255,0.85);
        border-top: 1px solid rgba(0,0,0,0.07);
    `;
    const inner = document.createElement('div');
    inner.id = 'sticky-scroll-inner';
    ghost.appendChild(inner);
    tableCard.appendChild(ghost);

    const table = document.getElementById('principal-table');
    if (!table) return;

    // Sync inner width to table width
    function syncWidth() {
        inner.style.width = table.scrollWidth + 'px';
        inner.style.height = '1px';
    }
    syncWidth();

    // Sync scroll positions
    ghost.addEventListener('scroll', () => { tableCard.scrollLeft = ghost.scrollLeft; });
    tableCard.addEventListener('scroll', () => { ghost.scrollLeft = tableCard.scrollLeft; });

    // Re-sync on resize
    const ro = new ResizeObserver(syncWidth);
    ro.observe(table);
}

document.getElementById('refresh-btn').addEventListener('click', loadAndRenderPrincipal);

['principal-filter-dept', 'principal-filter-staff', 'principal-filter-followup', 'principal-filter-type', 'principal-filter-fc'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => renderTable());
});
document.getElementById('principal-search').addEventListener('input', () => renderTable());
document.getElementById('principal-filter-reset').addEventListener('click', () => {
    ['principal-filter-dept', 'principal-filter-staff', 'principal-filter-followup', 'principal-filter-type', 'principal-filter-fc'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('principal-search').value = '';
    principalState.activeFilter = null;
    document.querySelectorAll('.summary-card').forEach(s => s.style.outline = '');
    renderTable();
});

loadAndRenderPrincipal();

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
            <tr style="cursor:pointer;" onclick="filterPrincipalByStaff('${s.staff_name.replace(/'/g, "\\'")}')">
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

function filterPrincipalByStaff(staffName) {
    const staffSel = document.getElementById('principal-filter-staff');
    if (!staffSel) return;
    staffSel.value = staffName;
    renderTable();
    document.querySelector('.table-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function exportToExcel() {
    if (!principalState.data || principalState.data.length === 0) {
        alert("No data to export.");
        return;
    }
    const rows = principalState.data.map((item, i) => {
        const dateStr = (() => {
            const raw = item.enquiry_created_at || item.created_at;
            if (!raw) return '';
            const d = new Date(raw);
            return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        })();
        const latest = computeLatestStatus(item);
        return {
            'Sr No': i + 1,
            'Student Name': item.student_name || '',
            'Phone': item.phone_number || '',
            'Department': item.department || '',
            'Board': item.board || '',
            'Caste': item.caste || '',
            'Annual Income': item.annual_income || '',
            'Percentage': item.percentage !== null && item.percentage !== undefined ? item.percentage : '',
            'Assigned To': item.AssignedTo || '',
            'Created By': item.CreatedBy || '',
            'Registered On': dateStr,
            'Followup 1': item.followup1 || '',
            'Followup 2': item.followup2 || '',
            'Followup 3': item.followup3 || '',
            'Followup 4': item.followup4 || '',
            'Followup 5': item.followup5 || '',
            'Followup 6': item.followup6 || '',
            'Followup 7': item.followup7 || '',
            'Latest Status': latest
        };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Students");
    const today = new Date();
    const fname = `students_${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}.xlsx`;
    XLSX.writeFile(wb, fname);
}
