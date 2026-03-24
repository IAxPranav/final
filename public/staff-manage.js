let allStaff = [];

function showToast(msg, ok = true) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.style.background = ok ? '#27ae60' : '#e74c3c';
    t.textContent = msg;
    t.style.display = 'block';
    setTimeout(() => t.style.display = 'none', 2200);
}

async function fetchStaff() {
    try {
        const res = await fetch("/admin/full-staff-list");
        allStaff = await res.json();
        renderStaff();
    } catch (err) {
        console.error(err);
        showToast("Error loading staff", false);
    }
}

function renderStaff(filter = "") {
    const container = document.getElementById("staff-container");
    container.innerHTML = "";
    
    const departments = ["AN", "TE", "CE", "ME", "AE", "MANAGEMENT"];
    
    allStaff.filter(s => s.staff_name.toLowerCase().includes(filter.toLowerCase())).forEach(staff => {
        const card = document.createElement("div");
        card.className = "staff-card";
        
        card.innerHTML = `
            <h3>${staff.staff_name}</h3>
            <p class="small">Username: <strong>${staff.username || 'N/A'}</strong></p>
            <label>Department:</label>
            <select class="dept-select" onchange="updateDept(${staff.id}, this.value)">
                ${departments.map(d => `<option value="${d}" ${staff.department === d ? 'selected' : ''}>${d}</option>`).join('')}
            </select>
            <div class="status-toggle">
                <input type="checkbox" ${staff.dont_assign ? 'checked' : ''} onchange="updateAssign(${staff.id}, this.checked)">
                <label>Do Not Assign</label>
            </div>
        `;
        container.appendChild(card);
    });
}

async function updateDept(id, dept) {
    try {
        const res = await fetch("/admin/update-staff-department", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, department: dept })
        });
        if (res.ok) showToast("Department updated");
        else showToast("Update failed", false);
    } catch (err) {
        console.error(err);
        showToast("Error updating department", false);
    }
}

async function updateAssign(id, value) {
    try {
        const res = await fetch("/admin/update-staff-assignmode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, dont_assign: value })
        });
        if (res.ok) showToast("Assignment mode updated");
        else showToast("Update failed", false);
    } catch (err) {
        console.error(err);
        showToast("Error updating status", false);
    }
}

document.getElementById("staff-search").addEventListener("input", (e) => renderStaff(e.target.value));

fetchStaff();
