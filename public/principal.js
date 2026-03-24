// Principal dashboard script
const principalState = { data: [] };

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
    const deptCounts = {};
    principalState.data.forEach(d => {
        if (d.AssignedTo) assigned++;
        if (computeLatestStatus(d) !== 'No follow-up yet') followupDone++;
        const dep = d.department || 'Unknown'; deptCounts[dep] = (deptCounts[dep]||0)+1;
    });
    const unassigned = total - assigned;

    const cards = [
        {title:'Total Enquiries', value: total},
        {title:'Assigned', value: assigned},
        {title:'Unassigned', value: unassigned},
        {title:'Followups Done', value: followupDone}
    ];
    cards.forEach(c => {
        const el = document.createElement('div'); el.className='summary-card';
        el.innerHTML = `<div class="small">${c.title}</div><div style="font-size:1.4em;font-weight:700">${c.value}</div>`;
        container.appendChild(el);
    });
}

function renderCharts() {
    const container = document.getElementById('principal-charts');
    container.innerHTML = '';

    // Department breakdown
    const deptStats = {};
    principalState.data.forEach(d => { const dep = d.department||'Unknown'; if (!deptStats[dep]) deptStats[dep]={total:0,done:0}; deptStats[dep].total++; if (computeLatestStatus(d)!=='No follow-up yet') deptStats[dep].done++; });
    const depts = Object.keys(deptStats);
    const totals = depts.map(d=>deptStats[d].total);
    const dones = depts.map(d=>deptStats[d].done);

    // overall doughnut
    const overallCard = document.createElement('div'); overallCard.style.width='420px'; overallCard.style.background='white'; overallCard.style.padding='12px'; overallCard.style.borderRadius='8px'; overallCard.style.boxShadow='0 4px 8px rgba(0,0,0,0.06)';
    const canvas1 = document.createElement('canvas'); canvas1.width=380; canvas1.height=240; overallCard.appendChild(canvas1);
    container.appendChild(overallCard);
    new Chart(canvas1.getContext('2d'), { type:'doughnut', data:{ labels:depts, datasets:[{ data:totals, backgroundColor:depts.map((_,i)=>['#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f','#edc949','#af7aa1'][i%7]) }] }, options:{responsive:false, plugins:{legend:{position:'bottom'}}} });

    // bar chart followups done vs pending per dept
    const barCard = document.createElement('div'); barCard.style.width='520px'; barCard.style.background='white'; barCard.style.padding='12px'; barCard.style.borderRadius='8px'; barCard.style.boxShadow='0 4px 8px rgba(0,0,0,0.06)';
    const canvas2 = document.createElement('canvas'); canvas2.width=480; canvas2.height=240; barCard.appendChild(canvas2); container.appendChild(barCard);
    new Chart(canvas2.getContext('2d'), { type:'bar', data:{ labels:depts, datasets:[{ label:'Followups Done', data:dones, backgroundColor:'#27ae60' }, { label:'No Followup', data:depts.map((d,i)=>totals[i]-dones[i]), backgroundColor:'#e74c3c' }] }, options:{responsive:false, scales:{y:{beginAtZero:true}}} });
}

async function renderTable(filterDept='') {
    const tbody = document.getElementById('principal-table-body'); tbody.innerHTML = '';
    const staffCache = {};
    for (const item of principalState.data) {
        if (filterDept && item.department!==filterDept) continue;
        const tr = document.createElement('tr');
        const latest = computeLatestStatus(item);
        tr.innerHTML = `<td>${item.student_name}</td><td>${item.phone_number}</td><td></td><td></td><td><strong>${latest}</strong></td><td>${item.created_at?new Date(item.created_at).toLocaleDateString('en-GB'):'Pending'}</td><td class="table-actions"></td>`;
        // department select
        const deptSel = document.createElement('select'); deptSel.innerHTML = `<option value="">${item.department||'Unknown'}</option>`; // simple default
        deptSel.value = item.department || '';
        // assigned select - will populate from staff-list
        const assignedSel = document.createElement('select'); assignedSel.innerHTML = `<option value="">${item.AssignedTo||'Unassigned'}</option>`;

        // fetch staff list for department
        try {
            const staffList = await fetch(`/admin/staff-list?department=${encodeURIComponent(item.department||'')}`).then(r=>r.ok?r.json():[]);
            staffList.forEach(s => { const o=document.createElement('option'); o.value=s; o.textContent=s; if(s===item.AssignedTo) o.selected=true; assignedSel.appendChild(o); });
        } catch(e){}

        tr.children[2].appendChild(deptSel);
        tr.children[3].appendChild(assignedSel);

        const actions = tr.querySelector('.table-actions');
        const updateBtn = document.createElement('button'); updateBtn.className='update-btn'; updateBtn.textContent='Save';
        const deleteBtn = document.createElement('button'); deleteBtn.className='delete-btn'; deleteBtn.textContent='Delete';
        actions.appendChild(updateBtn); actions.appendChild(deleteBtn);

        updateBtn.addEventListener('click', async () => {
            const newAssigned = assignedSel.value || null;
            const newDept = deptSel.value || item.department;
            try {
                // if department changed, call update-department to auto-assign
                if (newDept !== item.department) {
                    const r = await fetch('/admin/update-department',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({student_name:item.student_name,department:newDept})});
                    if (!r.ok) throw new Error('dept update failed');
                    const json = await r.json();
                    assignedSel.value = json.AssignedTo || '';
                    item.department = newDept;
                }
                // update assigned if changed
                const r2 = await fetch('/admin/update-assigned',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({student_name:item.student_name,AssignedTo:newAssigned})});
                if (!r2.ok) throw new Error('assign failed');
                showToast('Saved');
            } catch (err) { console.error(err); showToast('Save failed', false); }
        });

        deleteBtn.addEventListener('click', async () => {
            if (!confirm(`Delete ${item.student_name}? This cannot be undone.`)) return;
            try {
                const r = await fetch('/admin/delete-entry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({student_name:item.student_name})});
                if (!r.ok) throw new Error('delete failed');
                showToast('Deleted');
                await loadAndRenderPrincipal();
            } catch (err) { console.error(err); showToast('Delete failed', false); }
        });

        tbody.appendChild(tr);
    }
}

async function loadAndRenderPrincipal() {
    try {
        await fetchAllData();
        renderSummary();
        renderCharts();
        // populate dept filter
        const deptSel = document.getElementById('principal-filter-dept'); deptSel.innerHTML = '<option value="">All</option>';
        const depts = Array.from(new Set(principalState.data.map(d=>d.department||'Unknown'))).sort(); depts.forEach(d=>{ const o=document.createElement('option'); o.value=d; o.textContent=d; deptSel.appendChild(o); });
        await renderTable();
    } catch (err) { console.error(err); showToast('Load failed', false); }
}

document.getElementById('refresh-btn').addEventListener('click', loadAndRenderPrincipal);
document.getElementById('principal-filter-dept').addEventListener('change', (e)=>renderTable(e.target.value));
document.getElementById('principal-search').addEventListener('input', async (e)=>{ const q=e.target.value.trim().toLowerCase(); if(!q) return renderTable(); const filtered = principalState.data.filter(d=> (d.student_name||'').toLowerCase().includes(q)); principalState.data = principalState.data; // keep state; render filtered directly
    // render filtered temporarily
    const prev = principalState.data;
    principalState.data = filtered;
    await renderTable();
    principalState.data = prev;
});

// initial
loadAndRenderPrincipal();
