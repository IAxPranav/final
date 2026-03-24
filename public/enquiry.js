document.addEventListener("DOMContentLoaded", async () => {
    const response = await fetch("/profile");
    if (response.ok) {
        const data = await response.json();
        console.log("Profile Data:", data);

        document.getElementById("ProfileName").innerText = data.name;
        document.getElementById("Department").innerText = data.department;
        document.getElementById("profile-icon").innerText = data.name.split(" ").map(n => n[0]).join("");
    } else {
        console.error("Failed to fetch profile data");
    }

});

async function fetchAssignedEnquiries() {
    const response = await fetch("/assignedEnquiries", {
        method: "GET",
    });

    if (response.ok) {
        const enquiries = await response.json();
        const tableBody = document.getElementById("enquiryTableBody");

        // 1. Clear the table first to prevent duplicate rows
        tableBody.innerHTML = "";

        enquiries.forEach((enquiry, index) => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${index + 1}</td>
                <td>${enquiry.student_name}</td>
                <td>${enquiry.department}</td>
                <td>${enquiry.phone_number}</td>
                <td>${enquiry.percentage}</td>
            `;
            tableBody.appendChild(row);
        });
    } else {
        console.error("Failed to fetch assigned enquiries");
    }
}
async function fetchFollowups() {
    const response = await fetch("/followups", {
        method: "GET",
    });
    if (response.ok) {
        const enquiries = await response.json();
        const followupContainer = document.getElementById("student-followup-box");
        followupContainer.innerHTML = "";
        enquiries.forEach((enquiry, index) => {
            const followupBox = document.createElement("div");
            followupBox.classList.add("student-followup-box");
            let html = `
            <div class="student-followup-box">
    <div class="student-info">
    <div><strong>${enquiry.student_name}</strong> | <span>${enquiry.phone_number}</span></div>
    <button class="action-btn" onclick="toggleFollowup('followup-area-${index}')">Take Follow-up</button>
    </div>
    
                <div id="followup-area-${index}" class="followup-area" style="display: none;">
        
        <div class="add-remark-container">
            <label class="input-label">Select Student Status</label>
            <select id="followupRemark-${index}" class="remark-select">
                <option value="Interested">Interested</option>
                <option value="Not Interested">Not Interested</option>
                <option value="Fill Admission/Option Form">Fill Admission/Option Form</option>
                <option value="Registration Done">Registration Done</option>
                <option value="Option 1/2/3 Filled">Option 1/2/3 Filled</option>
                <option value="Branch Change">Branch Change</option>
                <option value="Allotted">Allotted</option>
                <option value="Not Allotted">Not Allotted</option>
                <option value="Betterment">Betterment</option>
                <option value="Exit from System">Exit from System</option>
                <option value="Other">Other</option>
                <option value="Admission Taken">Admission Taken</option>
                <option value="Admission Not Taken">Admission Not Taken</option>
                <option value="Management">Management</option>
            </select>
            <input type="text" id="otherRemark-${index}" class="remark-select" placeholder="Enter remark for 'Other' status" style="display:none;">
            <select id="BranchChange-${index}" class="other-remark-input" style="display:none;">
                <option value="" disabled selected>Select new branch</option>
                <option value="AN">AN</option>
                <option value="TE">TE</option>
                <option value="ME">ME</option>
                <option value="AE">AE</option>
                <option value="CE">CE</option>
            </select>

            <div class="button-wrapper">
                <button class="primary-btn" onclick="addFollowup('followupRemark-${index}', 'followupTableBody-${index}', this, '${enquiry.student_name.replace(/'/g, "\\'")}', 'displayTableRows()')">Add Follow-up</button>
            </div>
        </div>

        <table class="followup-table">
            <thead>
                <tr>
                    <th style="width: 50px;">No.</th>
                    <th>Date</th>
                    <th>Remark / Status</th>
                </tr>
            </thead>
                        <tbody id="followupTableBody-${index}">
                            <!-- Follow-up entries will be added here -->
                        </tbody>
        </table>
    </div>
</div>
            `;
            followupBox.innerHTML = html;
            followupContainer.appendChild(followupBox);
            document.getElementById(`followupRemark-${index}`).addEventListener("change", function() {
                if (this.value === "Other") {
                    document.getElementById(`otherRemark-${index}`).style.display = "block";
                }else if (this.value === "Branch Change"){
                    document.getElementById(`BranchChange-${index}`).style.display = "block";
                }
                 else {
                    document.getElementById(`otherRemark-${index}`).style.display = "none";
                }
            });
            setTimeout(() => {
                loadTableData(enquiry.student_name, `followupTableBody-${index}`);
            }, 0);
        });
    }
}
function openTab(evt, tabName) {
    let i, tabcontent, tablinks;
    tabcontent = document.getElementsByClassName("tab-content");
    for (i = 0; i < tabcontent.length; i++) tabcontent[i].style.display = "none";
    tablinks = document.getElementsByClassName("tab-btn");
    for (i = 0; i < tablinks.length; i++) tablinks[i].className = tablinks[i].className.replace(" active", "");
    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.className += " active";
}
document.getElementById("followupsTab").addEventListener("click", async (e) => {
    openTab(event, 'followups')
    fetchFollowups();
});
document.getElementById("assignedTab").addEventListener("click", async (e) => {
    openTab(e, 'assigned')
    fetchAssignedEnquiries();
});

async function loadTableData(studentName, tableBodyId) {
    const tableBody = document.getElementById(tableBodyId);
    if (!tableBody) return;

    try {
        const response = await fetch(`/get-status-history?name=${encodeURIComponent(studentName)}`);
        const data = await response.json(); 

        // Clear the table so we don't duplicate rows
        tableBody.innerHTML = ""; 

        if (data.length > 0) {
            const row = data[0]; 
            const dateStr = row.created_at ? new Date(row.created_at).toLocaleDateString('en-GB') : 'N/A';
            
            let rowCounter = 1;

            // Loop through all 7 possible follow-up columns
            for (let i = 1; i <= 7; i++) {
                const columnValue = row[`followup${i}`];
                
                // Only add a row if there is data in that specific followup column
                if (columnValue && columnValue.trim() !== "" && columnValue !== "null") {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${rowCounter}</td>
                        <td>${dateStr}</td>
                        <td><strong>[F${i}]</strong> ${columnValue}</td>
                    `;
                    tableBody.appendChild(tr);
                    rowCounter++;
                }
            }
        }
    } catch (err) {
        console.error("Error updating table UI:", err);
    }
}
async function addFollowup(selectId, tableBodyId, btnElement, studentName) {
    const selectElement = document.getElementById(selectId);
    let selectedRemark = selectElement.value;
    let branchChangeBool = false;
    let exitFromSystembool = false;
    let branchChange = "";
    if (selectedRemark === "Other") {
        let otherInput = document.getElementById(`otherRemark-${selectId.split('-')[1]}`);
        otherInput.style.display = "block";
        if (otherInput) {
            const otherRemark = otherInput.value.trim();
            if (otherRemark === "") {
                alert("Please enter a remark for 'Other' status.");
                return;
            }
            selectedRemark = otherRemark; // Override with custom remark
        }
    }else if (selectedRemark === "Branch Change"){
        let branchSelect = document.getElementById(`BranchChange-${selectId.split('-')[1]}`);
        branchSelect.style.display = "block";
        if (branchSelect) {
            const branchRemark = branchSelect.value;
            if (branchRemark === "") {
                alert("Please select a new branch for 'Branch Change' status.");
                return;
            }
            selectedRemark = `Branch Change to ${branchRemark}`;
            branchChangeBool = true;
            branchChange = branchRemark;
        }
    }else if(selectedRemark === "Exit from System") {
        exitFromSystembool = true;
        // selectedRemark
    }
    const dataToSave = {
        student_name: studentName,
        status: selectedRemark,
        branchChangeBool: branchChangeBool,
        exitFromSystembool: exitFromSystembool,
        branchChange: branchChange,
        AssignedTo: document.getElementById("ProfileName").innerText,
        followup_date: new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    };
    console.log("Data to save:", dataToSave);
    try {
        const response = await fetch("/save-followup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(dataToSave)
        });

        if (response.ok) {
            // REFRESH the table by fetching the latest data from DB
            await loadTableData(studentName, tableBodyId);

            // Visual feedback
            const msg = btnElement.parentElement.querySelector('.success-msg');
            if (msg) {
                msg.classList.add('show');
                setTimeout(() => msg.classList.remove('show'), 1500);
            }
        } else {
            alert("Failed to save follow-up.");
        }
    } catch (error) {
        console.error("Save Error:", error);
    }
}

function toggleFollowup(id) {
    const el = document.getElementById(id);
    if (el.style.display === "block") {
        el.style.display = "none";
    } else {
        el.style.display = "block";
    }
}

function toggleProfileDropdown() {
    document.getElementById("profileDropdown").classList.toggle("show");
}
document.getElementById("submitEnquiry").addEventListener("click", async (e) => {
    e.preventDefault();
        const firstName = document.getElementById("firstName").value.trim();
    const fatherName = document.getElementById("fatherName").value.trim();
    const surname = document.getElementById("surname").value.trim();

    // 🔥 Combine into one string
    const username = `${firstName} ${fatherName} ${surname}`;
    const phoneno = document.getElementById("phoneNO").value;
    const branch = document.getElementById("branch").value;
    const percentage = document.getElementById("percentage").value;
    const isManagement = document.getElementById("isManagement").checked;

    if (phoneno.length !== 10 || isNaN(phoneno) || phoneno.length > 10) {
        alert("Please enter a valid 10-digit phone number.");
        return;
    } else if (isNaN(percentage) || percentage < 0 || percentage > 100) {
        alert("Please enter a valid percentage between 0 and 100.");
        return;
    } else {
        const response = await fetch("/EnquirySubmission", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ studentName: username, department: branch, phoneNO: phoneno, percentage, isManagement, CreatedBy: document.getElementById("ProfileName").innerText })
        });
        document.getElementById("enquiry-form").reset();
        alert("Enquiry submitted successfully!");
    }
});
window.onclick = function (event) {
    if (!event.target.closest('.profile-container')) {
        var dropdowns = document.getElementsByClassName("profile-dropdown");
        for (var i = 0; i < dropdowns.length; i++) {
            var openDropdown = dropdowns[i];
            if (openDropdown.classList.contains('show')) {
                openDropdown.classList.remove('show');
            }
        }
    }
}