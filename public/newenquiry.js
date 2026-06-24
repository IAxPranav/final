document.addEventListener("DOMContentLoaded", () => {
    loadMyEnquiries();
});

// ── Enquiry Form ──────────────────────────────────────────────────────────────

document.getElementById("enquiryForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("submitBtn");
    const successMsg = document.getElementById("formSuccess");
    btn.disabled = true;
    btn.textContent = "Submitting…";

    const isManagement = document.getElementById("isManagement").checked;
    const is_direct_second_year = document.getElementById("isDirectSecondYear").checked;
    const data = {
        studentName: document.getElementById("studentName").value.trim(),
        phoneNO: document.getElementById("phoneNO").value.trim(),
        department: document.getElementById("department").value,
        percentage: document.getElementById("percentage").value || null,
        board: document.getElementById("board").value.trim() || null,
        caste: document.getElementById("caste").value.trim() || null,
        annual_income: document.getElementById("annual_income").value || null,
        isManagement,
        is_direct_second_year,
        is_fc: false
    };

    if (!data.studentName || !data.phoneNO || !data.department) {
        alert("Name, phone and department are required.");
        btn.disabled = false;
        btn.textContent = "Submit Enquiry";
        return;
    }

    try {
        const res = await fetch("/EnquirySubmission", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });
        const json = await res.json();
        if (res.ok && json.success) {
            successMsg.classList.add("show");
            setTimeout(() => successMsg.classList.remove("show"), 2000);
            document.getElementById("enquiryForm").reset();
            await loadMyEnquiries();
        } else {
            alert(json.error || "Failed to submit enquiry.");
        }
    } catch (err) {
        console.error(err);
        alert("Network error. Please try again.");
    } finally {
        btn.disabled = false;
        btn.textContent = "Submit Enquiry";
    }
});

// ── Load My Enquiries ─────────────────────────────────────────────────────────

async function loadMyEnquiries() {
    const container = document.getElementById("my-enquiries-container");
    container.innerHTML = '<p class="neq-empty">Loading…</p>';
    try {
        const res = await fetch("/newenquiry/my-enquiries");
        if (!res.ok) {
            container.innerHTML = '<p class="neq-empty" style="color:#d64545;">Failed to load enquiries.</p>';
            return;
        }
        const enquiries = await res.json();
        if (enquiries.length === 0) {
            container.innerHTML = '<p class="neq-empty">No enquiries submitted yet.</p>';
            return;
        }
        container.innerHTML = '<div class="neq-cards-grid" id="neq-grid"></div>';
        const grid = document.getElementById("neq-grid");
        enquiries.forEach(eq => {
            const card = document.createElement("div");
            card.className = "neq-card";
            const dateStr = eq.created_at
                ? new Date(eq.created_at).toLocaleDateString("en-GB")
                : "N/A";
            card.innerHTML = `
                <div class="neq-card-header">
                    <div class="neq-card-name">${eq.student_name}</div>
                    <div class="neq-card-dept">${eq.department || "—"}</div>
                </div>
                <div class="neq-card-row">Phone: <span>${eq.phone_number || "—"}</span></div>
                <div class="neq-card-row">Board: <span>${eq.board || "—"}</span></div>
                <div class="neq-card-row">Percentage: <span>${eq.percentage !== null && eq.percentage !== undefined ? eq.percentage + "%" : "—"}</span></div>
                <div class="neq-card-row">Caste: <span>${eq.caste || "—"}</span></div>
                <div class="neq-card-row">Added on: <span>${dateStr}</span></div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
                    <span class="neq-assigned-badge">Assigned to: ${eq.AssignedTo || "Unassigned"}</span>
                    ${eq.is_direct_second_year ? '<span style="font-size:0.78rem;background:#6366f1;color:#fff;border-radius:6px;padding:3px 8px;">Direct 2nd Year</span>' : ''}
                    ${eq.department === 'MANAGEMENT' ? '<span style="font-size:0.78rem;background:#f59e0b;color:#fff;border-radius:6px;padding:3px 8px;">Management</span>' : ''}
                </div>
                <button class="neq-edit-btn" onclick="openEditModal(${JSON.stringify(eq).replace(/"/g, '&quot;')})">Edit</button>
            `;
            grid.appendChild(card);
        });
    } catch (err) {
        console.error(err);
        container.innerHTML = '<p class="neq-empty" style="color:#d64545;">Error loading enquiries.</p>';
    }
}

// ── Edit Modal ────────────────────────────────────────────────────────────────

function openEditModal(eq) {
    document.getElementById("edit-original-name").value = eq.student_name;
    document.getElementById("edit-student-name").value = eq.student_name;
    document.getElementById("edit-phone").value = eq.phone_number || "";
    document.getElementById("edit-department").value = eq.department || "AN";
    document.getElementById("edit-percentage").value = eq.percentage !== null && eq.percentage !== undefined ? eq.percentage : "";
    document.getElementById("edit-board").value = eq.board || "";
    document.getElementById("edit-caste").value = eq.caste || "";
    document.getElementById("edit-income").value = eq.annual_income || "";
    document.getElementById("editModal").classList.add("open");
}

function closeEditModal(e) {
    if (!e || e.target === document.getElementById("editModal")) {
        document.getElementById("editModal").classList.remove("open");
    }
}

async function saveEdit() {
    const original_name = document.getElementById("edit-original-name").value;
    const data = {
        original_name,
        student_name: document.getElementById("edit-student-name").value.trim(),
        phone_number: document.getElementById("edit-phone").value.trim(),
        department: document.getElementById("edit-department").value,
        percentage: document.getElementById("edit-percentage").value || null,
        board: document.getElementById("edit-board").value.trim() || null,
        caste: document.getElementById("edit-caste").value.trim() || null,
        annual_income: document.getElementById("edit-income").value || null
    };
    if (!data.student_name || !data.phone_number || !data.department) {
        alert("Name, phone and department are required.");
        return;
    }
    try {
        const res = await fetch("/newenquiry/edit-enquiry", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });
        const json = await res.json();
        if (res.ok && json.success) {
            document.getElementById("editModal").classList.remove("open");
            await loadMyEnquiries();
        } else {
            alert(json.error || "Failed to save changes.");
        }
    } catch (err) {
        console.error(err);
        alert("Network error. Please try again.");
    }
}
