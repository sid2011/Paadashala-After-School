// Paadashala Admin Application Scripts

// -------------------------------------------------------------
// 1. AJAX Page Navigation
// -------------------------------------------------------------
document.addEventListener("click", async function (e) {
    const link = e.target.closest(".admin-page-link");
    if (!link) return;

    const url = link.getAttribute("href");
    if (!url || url.startsWith("#") || url.startsWith("javascript:")) return;

    e.preventDefault();

    // Update active state on sidebar
    document.querySelectorAll(".side-nav .nav-link").forEach(nav => nav.classList.remove("active"));
    const sidebarLink = document.querySelector(`.side-nav a[href="${url}"]`);
    if (sidebarLink) sidebarLink.classList.add("active");

    try {
        const response = await fetch(url + (url.includes('?') ? '&ajax=1' : '?ajax=1'), {
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });

        if (response.status === 401) {
            window.location.href = "/admin/login";
            return;
        }

        if (!response.ok) {
            throw new Error(`Failed to load page: ${response.status}`);
        }

        const html = await response.text();
        const contentArea = document.querySelector("#admin-content");
        if (contentArea) {
            contentArea.innerHTML = html;
            window.history.pushState(null, "", url);
            // Re-initialize page specific hooks
            initAttendancePage();
            initTeacherOpinionPage();
        }
    } catch (error) {
        console.error("Navigation error:", error);
        const contentArea = document.querySelector("#admin-content");
        if (contentArea) {
            contentArea.innerHTML = `
                <div class="p-4 text-center">
                    <div class="alert alert-danger d-inline-block">
                        <h5>Something went wrong loading this section</h5>
                        <p class="m-0">${error.message}</p>
                    </div>
                </div>
            `;
        }
    }
});

// Handle browser Back / Forward navigation
window.addEventListener("popstate", function () {
    window.location.reload();
});

// -------------------------------------------------------------
// 2. Sidebar Mobile & Responsive Toggle
// -------------------------------------------------------------
document.addEventListener("click", function (e) {
    const toggleBtn = e.target.closest("[data-sidebar-toggle]");
    if (toggleBtn) {
        document.body.classList.toggle("sidebar-open");
        const sidebar = document.querySelector(".sidebar");
        if (sidebar) sidebar.classList.toggle("open");
    }

    const overlay = e.target.closest("[data-sidebar-close], .sidebar-overlay");
    if (overlay) {
        document.body.classList.remove("sidebar-open");
        const sidebar = document.querySelector(".sidebar");
        if (sidebar) sidebar.classList.remove("open");
    }

    // Also close offcanvas sidebar when any navigation link is clicked
    const navLink = e.target.closest(".admin-page-link");
    if (navLink) {
        document.body.classList.remove("sidebar-open");
        const sidebar = document.querySelector(".sidebar");
        if (sidebar) sidebar.classList.remove("open");
    }
});

// -------------------------------------------------------------
// 3. Attendance Page Handlers
// -------------------------------------------------------------
function initAttendancePage() {
    const dateInput = document.querySelector("#attendanceDate");
    if (dateInput && !dateInput.value) {
        const today = new Date().toISOString().split('T')[0];
        dateInput.value = today;
    }
    updateAttendanceCounters();
}

function updateAttendanceCounters() {
    const rows = document.querySelectorAll("#attendanceTableBody tr[data-student-id]");
    let present = 0;
    let absent = 0;

    rows.forEach(row => {
        if (row.dataset.status === "present") present++;
        else if (row.dataset.status === "absent") absent++;
    });

    const pBadge = document.querySelector("#presentCountBadge");
    const aBadge = document.querySelector("#absentCountBadge");
    if (pBadge) pBadge.textContent = `Present: ${present}`;
    if (aBadge) aBadge.textContent = `Absent: ${absent}`;
}

// Attendance Status Toggle click (Present / Absent)
document.addEventListener("click", function (e) {
    const button = e.target.closest(".status-toggle button");
    if (!button) return;

    const group = button.closest(".status-toggle");
    const row = button.closest("tr");
    const selectedStatus = button.dataset.status;

    // Update row dataset
    if (row) row.dataset.status = selectedStatus;

    // Reset button styles in this group
    const presentBtn = group.querySelector('[data-status="present"]');
    const absentBtn = group.querySelector('[data-status="absent"]');

    if (presentBtn) {
        presentBtn.classList.remove("btn-success", "text-white");
        presentBtn.classList.add("btn-outline-success", "text-dark");
    }
    if (absentBtn) {
        absentBtn.classList.remove("btn-danger", "text-white");
        absentBtn.classList.add("btn-outline-danger", "text-dark");
    }

    // Set active button style
    if (selectedStatus === "present" && presentBtn) {
        presentBtn.classList.remove("btn-outline-success", "text-dark");
        presentBtn.classList.add("btn-success", "text-white");
    } else if (selectedStatus === "absent" && absentBtn) {
        absentBtn.classList.remove("btn-outline-danger", "text-dark");
        absentBtn.classList.add("btn-danger", "text-white");
    }

    updateAttendanceCounters();
});

// Load Students for Attendance
document.addEventListener("click", async function (e) {
    const button = e.target.closest("#loadStudentsBtn");
    if (!button) return;

    const date = document.querySelector("#attendanceDate")?.value;
    const grade = document.querySelector("#classSelect")?.value;
    const shift = document.querySelector("#shiftSelect")?.value || "all";
    const tbody = document.querySelector("#attendanceTableBody");
    const summary = document.querySelector("#loadedSummary");

    if (!date || !grade) {
        alert("ദയവായി തീയതിയും ക്ലാസ്സും തെരഞ്ഞെടുക്കുക.");
        return;
    }

    button.disabled = true;
    const originalText = button.innerHTML;
    button.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Loading...';

    try {
        const url = `/admin/students/loadAttendance?date=${encodeURIComponent(date)}&grade=${encodeURIComponent(grade)}&shift=${encodeURIComponent(shift)}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error("Failed to load students");

        const students = await response.json();

        if (tbody) {
            if (students.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" class="text-center py-5 text-muted">
                            <i class="bi bi-info-circle fs-2 text-secondary d-block mb-2"></i>
                            <div>ഈ ക്ലാസ്സിലും ഷിഫ്റ്റിലും കുട്ടികളെ കണ്ടെത്തിയില്ല.</div>
                            <small class="text-muted">${grade} (${shift})</small>
                        </td>
                    </tr>
                `;
                if (summary) summary.textContent = `0 Students found`;
            } else {
                tbody.innerHTML = students.map((std, index) => {
                    const isPresent = std.status !== 'absent';
                    const shiftBadge = std.shift === 'Morning' 
                        ? '<span class="badge bg-warning text-dark"><i class="bi bi-sun"></i> Morning</span>'
                        : std.shift === 'Afternoon'
                        ? '<span class="badge bg-info text-dark"><i class="bi bi-brightness-high"></i> Afternoon</span>'
                        : std.shift === 'Evening'
                        ? '<span class="badge bg-primary"><i class="bi bi-moon-stars"></i> Evening</span>'
                        : '<span class="badge bg-light text-muted">General</span>';

                    return `
                        <tr data-student-id="${std.studentId}" data-student-name="${std.name}" data-class="${std.class}" data-shift="${std.shift}" data-status="${isPresent ? 'present' : 'absent'}">
                            <td class="text-muted fw-bold">${index + 1}</td>
                            <td><span class="badge bg-light text-dark border font-monospace">${std.studentId}</span></td>
                            <td><strong class="text-dark">${std.name}</strong></td>
                            <td><span class="badge bg-secondary-subtle text-secondary">${std.class}</span></td>
                            <td>${shiftBadge}</td>
                            <td class="text-center">
                                <div class="btn-group btn-group-sm status-toggle" role="group">
                                    <button type="button"
                                            class="btn ${isPresent ? 'btn-success text-white' : 'btn-outline-success text-dark'}"
                                            data-status="present">
                                        <i class="bi bi-check-lg"></i> Present
                                    </button>
                                    <button type="button"
                                            class="btn ${!isPresent ? 'btn-danger text-white' : 'btn-outline-danger text-dark'}"
                                            data-status="absent">
                                        <i class="bi bi-x-lg"></i> Absent
                                    </button>
                                </div>
                            </td>
                        </tr>
                    `;
                }).join("");

                if (summary) summary.textContent = `${students.length} Students loaded (${grade} - ${shift})`;
            }
        }
        updateAttendanceCounters();
    } catch (err) {
        console.error("Load students error:", err);
        alert("കുട്ടികളെ ലോഡ് ചെയ്യുന്നതിൽ തടസ്സം ഉണ്ടായി: " + err.message);
    } finally {
        button.disabled = false;
        button.innerHTML = originalText;
    }
});

// Mark All Present
document.addEventListener("click", function (e) {
    if (e.target.id !== "markAllPresentBtn" && !e.target.closest("#markAllPresentBtn")) return;
    const rows = document.querySelectorAll("#attendanceTableBody tr[data-student-id]");
    rows.forEach(row => {
        row.dataset.status = "present";
        const presentBtn = row.querySelector('[data-status="present"]');
        const absentBtn = row.querySelector('[data-status="absent"]');
        if (presentBtn) {
            presentBtn.classList.remove("btn-outline-success", "text-dark");
            presentBtn.classList.add("btn-success", "text-white");
        }
        if (absentBtn) {
            absentBtn.classList.remove("btn-danger", "text-white");
            absentBtn.classList.add("btn-outline-danger", "text-dark");
        }
    });
    updateAttendanceCounters();
});

// Mark All Absent
document.addEventListener("click", function (e) {
    if (e.target.id !== "markAllAbsentBtn" && !e.target.closest("#markAllAbsentBtn")) return;
    const rows = document.querySelectorAll("#attendanceTableBody tr[data-student-id]");
    rows.forEach(row => {
        row.dataset.status = "absent";
        const presentBtn = row.querySelector('[data-status="present"]');
        const absentBtn = row.querySelector('[data-status="absent"]');
        if (presentBtn) {
            presentBtn.classList.remove("btn-success", "text-white");
            presentBtn.classList.add("btn-outline-success", "text-dark");
        }
        if (absentBtn) {
            absentBtn.classList.remove("btn-outline-danger", "text-dark");
            absentBtn.classList.add("btn-danger", "text-white");
        }
    });
    updateAttendanceCounters();
});

// Save Attendance
document.addEventListener("click", async function (e) {
    const saveBtn = e.target.closest("#saveAttendance");
    if (!saveBtn) return;

    const rows = document.querySelectorAll("#attendanceTableBody tr[data-student-id]");
    const date = document.querySelector("#attendanceDate")?.value;
    const alertBox = document.querySelector("#attendanceAlert");

    if (rows.length === 0) {
        alert("സേവ് ചെയ്യാൻ വിദ്യാർത്ഥികളുടെ ലിസ്റ്റ് ഇല്ല.");
        return;
    }

    if (!date) {
        alert("തീയതി തെരഞ്ഞെടുക്കുക.");
        return;
    }

    const attendanceRecords = [];
    rows.forEach(row => {
        attendanceRecords.push({
            date: date,
            studentId: row.dataset.studentId,
            studentName: row.dataset.studentName,
            class: row.dataset.class,
            shift: row.dataset.shift,
            status: row.dataset.status || "present"
        });
    });

    saveBtn.disabled = true;
    const origText = saveBtn.innerHTML;
    saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Saving...';

    try {
        const response = await fetch('/admin/students/attendance', {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(attendanceRecords)
        });

        if (!response.ok) throw new Error(`HTTP error: ${response.status}`);

        if (alertBox) {
            alertBox.style.display = "block";
            alertBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            setTimeout(() => { alertBox.style.display = "none"; }, 4000);
        } else {
            alert("ഹാജർ വിജയകരമായി രേഖപ്പെടുത്തി! (Attendance Saved)");
        }
    } catch (err) {
        console.error("Save attendance error:", err);
        alert("ഹാജർ സേവ് ചെയ്യുന്നതിൽ പിഴവ് സംഭവിച്ചു: " + err.message);
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = origText;
    }
});

// -------------------------------------------------------------
// 4. Teacher Opinion & Voice Recording (Speech-to-Text)
// -------------------------------------------------------------
let recognition = null;
let isRecording = false;

function initTeacherOpinionPage() {
    const classSelect = document.querySelector("#opinionClassSelect");
    const studentSelect = document.querySelector("#opinionStudentSelect");
    const studentNameInput = document.querySelector("#opinionStudentName");

    if (classSelect) {
        classSelect.addEventListener("change", async function () {
            const selectedClass = this.value;
            if (!selectedClass || !studentSelect) return;

            studentSelect.disabled = true;
            studentSelect.innerHTML = '<option value="">വിദ്യാർത്ഥികളെ ലോഡ് ചെയ്യുന്നു...</option>';

            try {
                const response = await fetch(`/admin/students/by-class?className=${encodeURIComponent(selectedClass)}`);
                const students = await response.json();

                if (students.length === 0) {
                    studentSelect.innerHTML = '<option value="">-- ഈ ക്ലാസ്സിൽ കുട്ടികൾ ഇല്ല --</option>';
                    studentSelect.disabled = true;
                } else {
                    studentSelect.innerHTML = '<option value="" disabled selected>-- വിദ്യാർത്ഥിയെ തെരഞ്ഞെടുക്കുക --</option>' +
                        students.map(s => `<option value="${s.studentId}" data-name="${s.name}">${s.name} (${s.studentId} - ${s.shift || 'General'})</option>`).join("");
                    studentSelect.disabled = false;
                }
            } catch (err) {
                console.error("Fetch class students error:", err);
                studentSelect.innerHTML = '<option value="">ലോഡ് ചെയ്യാനായില്ല</option>';
            }
        });
    }

    if (studentSelect) {
        studentSelect.addEventListener("change", function () {
            const selectedOption = this.options[this.selectedIndex];
            if (studentNameInput && selectedOption) {
                studentNameInput.value = selectedOption.dataset.name || "";
            }
        });
    }

    setupVoiceRecognition();
}

function setupVoiceRecognition() {
    const voiceBtn = document.querySelector("#startVoiceBtn");
    const voiceBtnText = document.querySelector("#voiceBtnText");
    const voiceStatus = document.querySelector("#voiceStatus");
    const opinionText = document.querySelector("#opinionText");

    if (!voiceBtn) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        if (voiceStatus) {
            voiceStatus.innerHTML = '<span class="text-warning"><i class="bi bi-exclamation-triangle"></i> ഈ ബ്രൗസറിൽ സ്പീച്ച് റെക്കഗ്നിഷൻ സപ്പോർട്ട് ലഭ്യമല്ല. Chrome അല്ലെങ്കിൽ Edge ഉപയോഗിക്കുക.</span>';
        }
        voiceBtn.disabled = true;
        return;
    }

    voiceBtn.addEventListener("click", function () {
        if (isRecording) {
            stopVoiceRecording();
        } else {
            startVoiceRecording();
        }
    });

    function getSelectedLanguage() {
        const checkedLang = document.querySelector('input[name="speechLang"]:checked');
        return checkedLang ? checkedLang.value : 'ml-IN';
    }

  
function startVoiceRecording() {
    if (isRecording) return;

    const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    shouldKeepListening = true;
    createRecognition();

    function createRecognition() {
        if (!shouldKeepListening) return;

        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = getSelectedLanguage();

        recognition.onstart = function () {
            isRecording = true;

            voiceBtn.classList.remove("btn-outline-danger");
            voiceBtn.classList.add(
                "btn-danger", "text-white", "recording-pulse"
            );

            if (voiceBtnText) {
                voiceBtnText.textContent =
                    "Listening... (നിർത്താൻ ക്ലിക്ക് ചെയ്യൂ)";
            }

            if (voiceStatus) {
                voiceStatus.textContent =
                    "മൈക്ക് പ്രവർത്തിക്കുന്നു... സംസാരിക്കൂ!";
            }
        };

        
recognition.onresult = function (event) {
    let finalTranscript = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;

        if (event.results[i].isFinal) {
            finalTranscript += transcript + " ";
        }
    }

    if (finalTranscript && opinionText) {
        const existingText = opinionText.value.trim();

        opinionText.value = existingText
            ? existingText + " " + finalTranscript.trim()
            : finalTranscript.trim();

        opinionText.dispatchEvent(new Event("input", { bubbles: true }));
    }
};

        recognition.onerror = function (event) {
            console.warn("Speech recognition error:", event.error);

            if (voiceStatus) {
                voiceStatus.textContent =
                    `Speech recognition error: ${event.error}`;
            }

            // These errors require the user to start again.
            if (
                ["not-allowed", "service-not-allowed", "audio-capture"]
                    .includes(event.error)
            ) {
                shouldKeepListening = false;
            }
        };

        recognition.onend = function () {
            isRecording = false;

            if (recognition) recognition = null;

            // Restart only if the teacher hasn't clicked Stop.
            if (shouldKeepListening) {
                createRecognition();
            } else {
                resetVoiceButton();
            }
        };

        try {
            recognition.start();
        } catch (err) {
            console.error("Speech recognition start error:", err);
            shouldKeepListening = false;
            isRecording = false;
            resetVoiceButton();
        }
    }
}

function stopVoiceRecording() {
    shouldKeepListening = false;
    isRecording = false;

    const currentRecognition = recognition;
    recognition = null;

    if (currentRecognition) {
        try {
            currentRecognition.stop();
        } catch (err) {
            console.warn("Could not stop recognition:", err);
        }
    }

    resetVoiceButton();
}

function resetVoiceButton() {
    if (voiceBtn) {
        voiceBtn.classList.remove(
            "btn-danger", "text-white", "recording-pulse"
        );
        voiceBtn.classList.add("btn-outline-danger");
    }

    if (voiceBtnText) {
        voiceBtnText.textContent =
            "Click to Speak (സംസാരിച്ചു തുടങ്ങൂ)";
    }

    if (voiceStatus) {
        voiceStatus.textContent =
            "വോയ്സ് റെക്കോർഡിംഗ് പൂർത്തിയായി. ആവശ്യമെങ്കിൽ തിരുത്താം.";
    }
}
      if (voiceBtnText) voiceBtnText.textContent = "Click to Speak (സംസാരിച്ചു തുടങ്ങൂ)";
        if (voiceStatus) voiceStatus.innerHTML = "വോയ്സ് റെക്കോർഡിംഗ് പൂർത്തിയായി. ആവശ്യമെങ്കിൽ തിരുത്താം.";
    }


// Initialize on page load
document.addEventListener("DOMContentLoaded", function () {
    initAttendancePage();
    initTeacherOpinionPage();
});
