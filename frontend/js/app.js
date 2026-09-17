/**
 * BioScan AI - Core Single Page Application (SPA) Controller & Views
 */
const app = (function () {
    let currentUser = null;
    let currentRoute = "/";
    let pendingScanInterval = null;
    let istClockInterval = null;
    let studentDashboardTimeframe = "all"; // 'all', 'week', 'month', 'day'
    let studentAttendanceFilter = { timeframe: "all", week: "", month: "", subjectId: "" };
    let adminSubjectBranchFilter = "All"; // Branch filter for curriculum subjects view

    // Branch Badge Helper for Cyber UI
    function getDeptBadge(dept) {
        const d = (dept || "").toLowerCase();
        if (d.includes("computer")) return `<span class="dept-badge badge-cse"><i class="fa-solid fa-laptop-code"></i> Computer Engg</span>`;
        if (d.includes("information") || d.includes("it")) return `<span class="dept-badge badge-it"><i class="fa-solid fa-network-wired"></i> Info Tech</span>`;
        if (d.includes("telecom") || d.includes("electronic") || d.includes("entc")) return `<span class="dept-badge badge-entc"><i class="fa-solid fa-microchip"></i> Electronics & TC</span>`;
        if (d.includes("mech")) return `<span class="dept-badge badge-mech"><i class="fa-solid fa-gears"></i> Mechanical Engg</span>`;
        if (d.includes("data") || d.includes("ai")) return `<span class="dept-badge badge-aids"><i class="fa-solid fa-brain"></i> AI & Data Sci</span>`;
        if (d.includes("civil")) return `<span class="dept-badge badge-civil"><i class="fa-solid fa-trowel-bricks"></i> Civil Engg</span>`;
        return `<span class="dept-badge badge-all"><i class="fa-solid fa-globe"></i> ${dept || 'Common'}</span>`;
    }

    // Real-Time IST Digital Clock (Asia/Kolkata / UTC+5:30)
    function startLiveISTClock() {
        if (istClockInterval) return;

        function tick() {
            const clockEl = document.getElementById("header-ist-clock");
            if (!clockEl) return;

            const now = new Date();

            // Precise Indian Standard Time formatting
            const timeOptions = {
                timeZone: 'Asia/Kolkata',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true
            };
            const timeStr = new Intl.DateTimeFormat('en-US', timeOptions).format(now);
            const cleanTime = timeStr.replace(/\s+/g, '\u00A0');

            const dateOptions = {
                timeZone: 'Asia/Kolkata',
                weekday: 'short',
                day: '2-digit',
                month: 'short',
                year: 'numeric'
            };
            const dateStr = new Intl.DateTimeFormat('en-US', dateOptions).format(now);

            clockEl.innerHTML = `
                <div class="ist-clock-pill" title="Indian Standard Time (IST, UTC+5:30) Live Synchronized">
                    <span class="ist-live-pulse" title="Live IST Synchronization Active"></span>
                    <div class="ist-time-text">
                        <i class="fa-regular fa-clock" style="color:var(--brand-primary); margin-right:4px;"></i>
                        <span class="ist-digits">${cleanTime}</span>
                        <span class="ist-badge">IST</span>
                    </div>
                    <div class="ist-date-text">${dateStr}</div>
                </div>
            `;
        }

        tick();
        istClockInterval = setInterval(tick, 1000);
    }

    // Initialize application
    async function init() {
        startLiveISTClock();

        // Intercept browser back/forward
        window.addEventListener("popstate", () => {
            navigate(window.location.pathname, false);
        });

        // Check authentication state
        const token = api.getToken();
        if (token) {
            try {
                const res = await api.getMe();
                if (res && res.user) {
                    currentUser = res.user;
                }
            } catch (e) {
                api.logout();
                currentUser = null;
            }
        }

        renderHeader();
        navigate(window.location.pathname || "/", false);
    }

    // Client-side Router
    function navigate(path, push = true) {
        if (push && window.location.pathname !== path) {
            window.history.pushState({}, "", path);
        }
        currentRoute = path;

        // Cleanup any active webcam stream from previous view
        FaceEngine.stopCamera();
        if (pendingScanInterval) {
            clearInterval(pendingScanInterval);
            pendingScanInterval = null;
        }

        renderHeader();

        // RBAC route protection
        if (path.startsWith("/admin")) {
            if (path !== "/admin/login" && (!currentUser || currentUser.role !== "admin")) {
                showToast("Administrative login required to access this portal.", "warning");
                return navigate("/admin/login");
            }
        } else if (path.startsWith("/student")) {
            if (!currentUser || currentUser.role !== "student") {
                showToast("Please log in with your student account.", "warning");
                return navigate("/login");
            }
        }

        // View dispatch
        const viewport = document.getElementById("app-viewport");
        if (!viewport) return;

        if (path === "/" || path === "") {
            renderLanding(viewport);
        } else if (path === "/register") {
            renderStudentRegister(viewport);
        } else if (path === "/login") {
            renderStudentLogin(viewport);
        } else if (path === "/admin/login") {
            renderAdminLogin(viewport);
        } else if (path === "/student/dashboard") {
            renderStudentDashboard(viewport);
        } else if (path === "/student/face-registration") {
            renderStudentFaceRegistration(viewport);
        } else if (path === "/student/attendance-history") {
            renderStudentAttendanceHistory(viewport);
        } else if (path === "/admin/dashboard") {
            renderAdminDashboard(viewport);
        } else if (path === "/admin/pending") {
            renderAdminPending(viewport);
        } else if (path === "/admin/students") {
            renderAdminStudents(viewport);
        } else if (path === "/admin/subjects") {
            renderAdminSubjects(viewport);
        } else if (path === "/admin/sessions") {
            renderAdminSessions(viewport);
        } else if (path === "/admin/live-attendance" || path === "/admin/attendance") {
            renderAdminLiveAttendance(viewport);
        } else if (path === "/admin/reports") {
            renderAdminReports(viewport);
        } else if (path === "/admin/audit-logs") {
            renderAdminAuditLogs(viewport);
        } else if (path === "/admin/settings/security" || path === "/admin/settings") {
            renderAdminSettings(viewport);
        } else {
            viewport.innerHTML = `
                <div class="glass-panel" style="text-align:center; padding:4rem 2rem;">
                    <h2>404 - Page Not Found</h2>
                    <p style="color:var(--text-secondary); margin:1rem 0 2rem;">The requested page does not exist.</p>
                    <button class="btn btn-primary" onclick="app.navigate('/')">Return to Home</button>
                </div>
            `;
        }

        // Initialize 3D card tilt & depth physics on newly mounted view
        if (typeof ThreeD_Engine !== "undefined") {
            setTimeout(ThreeD_Engine.initCards, 50);
        }
    }

    // Render Navigation Bar
    function renderHeader() {
        const navLinks = document.getElementById("navbar-links");
        const navProfile = document.getElementById("nav-user-profile");
        if (!navLinks || !navProfile) return;

        if (!currentUser) {
            navLinks.innerHTML = `
                <a href="/" class="nav-item ${currentRoute === '/' ? 'active' : ''}" onclick="app.navigate('/'); return false;">
                    <i class="fa-solid fa-house"></i> Home
                </a>
                <a href="/login" class="nav-item ${currentRoute === '/login' ? 'active' : ''}" onclick="app.navigate('/login'); return false;">
                    <i class="fa-solid fa-user-graduate"></i> Student Login
                </a>
                <a href="/register" class="nav-item ${currentRoute === '/register' ? 'active' : ''}" onclick="app.navigate('/register'); return false;">
                    <i class="fa-solid fa-user-plus"></i> Register
                </a>
                <a href="/admin/login" class="nav-item ${currentRoute === '/admin/login' ? 'active' : ''}" onclick="app.navigate('/admin/login'); return false;">
                    <i class="fa-solid fa-shield-halved"></i> Admin Portal
                </a>
            `;
            navProfile.innerHTML = `
                <button class="btn btn-sm btn-primary" onclick="app.navigate('/login')">Get Started</button>
            `;
        } else if (currentUser.role === "student") {
            const st = currentUser.student || {};
            navLinks.innerHTML = `
                <a href="/student/dashboard" class="nav-item ${currentRoute === '/student/dashboard' ? 'active' : ''}" onclick="app.navigate('/student/dashboard'); return false;">
                    <i class="fa-solid fa-gauge-high"></i> Dashboard
                </a>
                <a href="/student/face-registration" class="nav-item ${currentRoute === '/student/face-registration' ? 'active' : ''}" onclick="app.navigate('/student/face-registration'); return false;">
                    <i class="fa-solid fa-camera-viewfinder"></i> Face Studio
                </a>
                <a href="/student/attendance-history" class="nav-item ${currentRoute === '/student/attendance-history' ? 'active' : ''}" onclick="app.navigate('/student/attendance-history'); return false;">
                    <i class="fa-solid fa-clipboard-user"></i> My Attendance
                </a>
            `;
            navProfile.innerHTML = `
                <div class="user-chip">
                    <div class="user-avatar-badge">${(st.name || "S").charAt(0)}</div>
                    <div>
                        <div style="font-weight:600; font-size:0.85rem;">${st.name || "Student"}</div>
                        <div class="user-role-tag">Roll: ${st.roll_number || "--"}</div>
                    </div>
                </div>
                <button class="btn btn-sm btn-secondary" title="Logout" onclick="app.handleLogout()">
                    <i class="fa-solid fa-right-from-bracket"></i>
                </button>
            `;
        } else if (currentUser.role === "admin") {
            navLinks.innerHTML = `
                <a href="/admin/dashboard" class="nav-item ${currentRoute === '/admin/dashboard' ? 'active' : ''}" onclick="app.navigate('/admin/dashboard'); return false;">
                    <i class="fa-solid fa-chart-pie"></i> Dashboard
                </a>
                <a href="/admin/pending" class="nav-item ${currentRoute === '/admin/pending' ? 'active' : ''}" onclick="app.navigate('/admin/pending'); return false;">
                    <i class="fa-solid fa-user-clock"></i> Pending Faces
                </a>
                <a href="/admin/live-attendance" class="nav-item ${currentRoute === '/admin/live-attendance' ? 'active' : ''}" onclick="app.navigate('/admin/live-attendance'); return false;">
                    <i class="fa-solid fa-camera"></i> Live Scanner
                </a>
                <a href="/admin/students" class="nav-item ${currentRoute === '/admin/students' ? 'active' : ''}" onclick="app.navigate('/admin/students'); return false;">
                    <i class="fa-solid fa-users"></i> Students
                </a>
                <a href="/admin/sessions" class="nav-item ${currentRoute === '/admin/sessions' ? 'active' : ''}" onclick="app.navigate('/admin/sessions'); return false;">
                    <i class="fa-solid fa-calendar-check"></i> Sessions
                </a>
                <a href="/admin/subjects" class="nav-item ${currentRoute === '/admin/subjects' ? 'active' : ''}" onclick="app.navigate('/admin/subjects'); return false;">
                    <i class="fa-solid fa-book"></i> Subjects
                </a>
                <a href="/admin/reports" class="nav-item ${currentRoute === '/admin/reports' ? 'active' : ''}" onclick="app.navigate('/admin/reports'); return false;">
                    <i class="fa-solid fa-file-invoice"></i> Reports
                </a>
                <a href="/admin/audit-logs" class="nav-item ${currentRoute === '/admin/audit-logs' ? 'active' : ''}" onclick="app.navigate('/admin/audit-logs'); return false;">
                    <i class="fa-solid fa-shield-cat"></i> Audit Logs
                </a>
                <a href="/admin/settings/security" class="nav-item ${currentRoute === '/admin/settings/security' ? 'active' : ''}" onclick="app.navigate('/admin/settings/security'); return false;">
                    <i class="fa-solid fa-sliders"></i> Security
                </a>
            `;
            navProfile.innerHTML = `
                <div class="user-chip">
                    <div class="user-avatar-badge" style="background:linear-gradient(135deg, #f59e0b, #d97706);"><i class="fa-solid fa-crown" style="font-size:0.7rem;"></i></div>
                    <div>
                        <div style="font-weight:600; font-size:0.85rem;">Admin</div>
                        <div class="user-role-tag admin">MASTER</div>
                    </div>
                </div>
                <button class="btn btn-sm btn-secondary" title="Logout" onclick="app.handleLogout()">
                    <i class="fa-solid fa-right-from-bracket"></i>
                </button>
            `;
        }
    }

    function handleLogout() {
        api.logout();
        currentUser = null;
        showToast("Logged out successfully.", "success");
        navigate("/");
    }

    // Helper: Toast Notifications
    function showToast(message, type = "info") {
        const container = document.getElementById("toast-container");
        if (!container) return;

        const toast = document.createElement("div");
        toast.className = `toast ${type}`;

        let icon = "fa-circle-info";
        if (type === "success") icon = "fa-circle-check";
        if (type === "error") icon = "fa-circle-exclamation";
        if (type === "warning") icon = "fa-triangle-exclamation";

        toast.innerHTML = `
            <i class="fa-solid ${icon}" style="font-size:1.2rem;"></i>
            <div style="font-size:0.9rem; flex:1;">${message}</div>
        `;

        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = "0";
            toast.style.transform = "translateX(100%)";
            toast.style.transition = "all 0.3s ease";
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    // Helper: Modal dialog
    function showModal(title, bodyHtml, footerButtonsHtml = "", customMaxWidth = "520px") {
        const overlay = document.getElementById("global-modal-overlay");
        const box = document.getElementById("global-modal-box");
        if (!overlay || !box) return;

        box.style.maxWidth = customMaxWidth;
        box.innerHTML = `
            <div class="modal-header">
                <h3>${title}</h3>
                <button class="btn btn-sm btn-secondary" style="border-radius:50%; width:30px; height:30px; padding:0;" onclick="app.closeModal()">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="modal-body">${bodyHtml}</div>
            ${footerButtonsHtml ? `<div class="modal-footer">${footerButtonsHtml}</div>` : ""}
        `;
        overlay.classList.remove("hidden");
    }

    function closeModal() {
        const overlay = document.getElementById("global-modal-overlay");
        const box = document.getElementById("global-modal-box");
        if (box) box.style.maxWidth = "";
        if (overlay) overlay.classList.add("hidden");
    }

    /* ==========================================================================
       VIEW: Landing Page (/) - High-End 3D Visual Experience
       ========================================================================== */
    function renderLanding(container) {
        container.innerHTML = `
            <!-- High-End Centered 3D Hero Section -->
            <section class="hero-layout-clean" style="max-width:960px; margin:2rem auto 3.5rem; text-align:center;">
                <div class="hero-pill-badge" style="margin:0 auto 1.5rem;">
                    <i class="fa-solid fa-sparkles"></i> 3D AI Biometric Attendance System
                </div>
                <h1 class="hero-heading" style="font-size:3.5rem; margin-bottom:1.25rem;">
                    Next-Gen Biometric <br><span class="brand-highlight">Face Recognition</span> Attendance
                </h1>
                <p class="hero-description" style="max-width:720px; margin:0 auto 2.5rem; font-size:1.15rem; line-height:1.8;">
                    Instant, touchless facial recognition powered by 128-dimensional mathematical embeddings, active liveness verification, dynamic 3D telemetry, and dual-portal automation.
                </p>
                <div class="hero-actions-group" style="justify-content:center; gap:1.25rem; margin-bottom:3rem;">
                    <button class="btn btn-primary btn-lg" onclick="app.navigate('/login')">
                        <i class="fa-solid fa-user-graduate"></i> Student Portal
                    </button>
                    <button class="btn btn-secondary btn-lg" onclick="app.navigate('/admin/login')">
                        <i class="fa-solid fa-shield-halved"></i> Admin Console
                    </button>
                    <button class="btn btn-outline btn-lg" onclick="app.navigate('/register')">
                        <i class="fa-solid fa-user-plus"></i> Register
                    </button>
                </div>

                <!-- Live Real-Time Telemetry Cards -->
                <div class="hero-telemetry-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:1.25rem; max-width:860px; margin:0 auto;">
                    <div class="glass-card" style="padding:1.2rem; text-align:center;">
                        <div style="font-size:1.6rem; font-weight:800; color:var(--brand-primary); font-family:var(--font-heading); margin-bottom:0.25rem;">
                            <i class="fa-solid fa-bullseye" style="font-size:1.2rem;"></i> 99.8%
                        </div>
                        <div style="font-size:0.8rem; color:var(--text-secondary); text-transform:uppercase; font-weight:600; letter-spacing:0.04em;">
                            Liveness Accuracy
                        </div>
                    </div>
                    <div class="glass-card" style="padding:1.2rem; text-align:center;">
                        <div style="font-size:1.6rem; font-weight:800; color:#10b981; font-family:var(--font-heading); margin-bottom:0.25rem;">
                            <i class="fa-solid fa-bolt" style="font-size:1.2rem;"></i> &lt; 45ms
                        </div>
                        <div style="font-size:0.8rem; color:var(--text-secondary); text-transform:uppercase; font-weight:600; letter-spacing:0.04em;">
                            Inference Speed
                        </div>
                    </div>
                    <div class="glass-card" style="padding:1.2rem; text-align:center;">
                        <div style="font-size:1.6rem; font-weight:800; color:#818cf8; font-family:var(--font-heading); margin-bottom:0.25rem;">
                            <i class="fa-solid fa-fingerprint" style="font-size:1.2rem;"></i> 128-D
                        </div>
                        <div style="font-size:0.8rem; color:var(--text-secondary); text-transform:uppercase; font-weight:600; letter-spacing:0.04em;">
                            Biometric Vectors
                        </div>
                    </div>
                    <div class="glass-card" style="padding:1.2rem; text-align:center;">
                        <div style="font-size:1.6rem; font-weight:800; color:#fbbf24; font-family:var(--font-heading); margin-bottom:0.25rem;">
                            <i class="fa-solid fa-shield-halved" style="font-size:1.2rem;"></i> AES-256
                        </div>
                        <div style="font-size:0.8rem; color:var(--text-secondary); text-transform:uppercase; font-weight:600; letter-spacing:0.04em;">
                            Encrypted Storage
                        </div>
                    </div>
                </div>
            </section>

            <!-- Dual Portals Cards -->
            <div style="max-width:1280px; margin:0 auto 4rem;">
                <div style="text-align:center; margin-bottom:2.5rem;">
                    <h2 style="font-size:2.2rem;">Choose Your Access Portal</h2>
                    <p style="color:var(--text-secondary); margin-top:0.5rem; font-size:1.05rem;">
                        Dedicated self-service environment for students and full-featured surveillance console for administrators.
                    </p>
                </div>

                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(340px, 1fr)); gap:2.5rem; text-align:left;">
                    <!-- Student Portal Card -->
                    <div class="glass-card cyber-portal-card" style="border-top:4px solid var(--brand-primary); position:relative; overflow:hidden;">
                        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:1.25rem;">
                            <div class="stat-icon" style="background:rgba(56,189,248,0.15); color:var(--brand-primary);">
                                <i class="fa-solid fa-graduation-cap"></i>
                            </div>
                            <span class="status-badge badge-not_registered">Self-Service</span>
                        </div>
                        <h3 style="font-size:1.4rem;">Student Portal</h3>
                        <p style="color:var(--text-secondary); font-size:0.95rem; margin:0.85rem 0 1.75rem; line-height:1.65;">
                            Create your student account, submit your facial biometric scan via webcam for administrative approval, and track subject-wise real-time attendance analytics.
                        </p>
                        <div style="display:flex; gap:0.85rem;">
                            <button class="btn btn-primary" style="flex:1;" onclick="app.navigate('/login')">
                                <i class="fa-solid fa-right-to-bracket"></i> Login
                            </button>
                            <button class="btn btn-secondary" style="flex:1;" onclick="app.navigate('/register')">
                                <i class="fa-solid fa-user-plus"></i> Register
                            </button>
                        </div>
                    </div>

                    <!-- Admin Portal Card -->
                    <div class="glass-card cyber-portal-card admin-theme" style="border-top:4px solid #f59e0b; position:relative; overflow:hidden;">
                        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:1.25rem;">
                            <div class="stat-icon" style="background:rgba(245,158,11,0.15); color:#f59e0b;">
                                <i class="fa-solid fa-shield-halved"></i>
                            </div>
                            <span class="status-badge" style="background:rgba(245,158,11,0.15); color:#fbbf24; border:1px solid rgba(245,158,11,0.3);">Administrative</span>
                        </div>
                        <h3 style="font-size:1.4rem;">Administrator Portal</h3>
                        <p style="color:var(--text-secondary); font-size:0.95rem; margin:0.85rem 0 1.75rem; line-height:1.65;">
                            Review & verify student biometric enrollments, initiate live lecture sessions, operate high-speed facial recognition camera kiosks, and export attendance audits.
                        </p>
                        <button class="btn" style="width:100%; background:linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color:#fff; box-shadow:0 4px 15px rgba(245,158,11,0.35);" onclick="app.navigate('/admin/login')">
                            <i class="fa-solid fa-lock"></i> Access Admin Console
                        </button>
                    </div>
                </div>

                <!-- Feature Highlights -->
                <div style="margin-top:4rem; display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:1.75rem;">
                    <div class="glass-card" style="padding:1.5rem;">
                        <i class="fa-solid fa-fingerprint" style="color:var(--brand-primary); font-size:2rem; margin-bottom:0.85rem; display:inline-block;"></i>
                        <h4 style="font-size:1.1rem;">Two-Step Biometrics</h4>
                        <p style="font-size:0.88rem; color:var(--text-secondary); margin-top:0.4rem; line-height:1.55;">Separated account creation and admin-reviewed biometric approval flow with zero spoofing.</p>
                    </div>
                    <div class="glass-card" style="padding:1.5rem;">
                        <i class="fa-solid fa-video" style="color:#10b981; font-size:2rem; margin-bottom:0.85rem; display:inline-block;"></i>
                        <h4 style="font-size:1.1rem;">Live AI Scanner</h4>
                        <p style="font-size:0.88rem; color:var(--text-secondary); margin-top:0.4rem; line-height:1.55;">Real-time multi-angle face tracking with zero duplicate marking in ongoing lecture sessions.</p>
                    </div>
                    <div class="glass-card" style="padding:1.5rem;">
                        <i class="fa-solid fa-shield-virus" style="color:#818cf8; font-size:2rem; margin-bottom:0.85rem; display:inline-block;"></i>
                        <h4 style="font-size:1.1rem;">Anti-Spoof Liveness</h4>
                        <p style="font-size:0.88rem; color:var(--text-secondary); margin-top:0.4rem; line-height:1.55;">Multi-frame eye-blink, head orientation variance, and motion analysis against photo presentation.</p>
                    </div>
                    <div class="glass-card" style="padding:1.5rem;">
                        <i class="fa-solid fa-chart-column" style="color:#fbbf24; font-size:2rem; margin-bottom:0.85rem; display:inline-block;"></i>
                        <h4 style="font-size:1.1rem;">Audit & Analytics</h4>
                        <p style="font-size:0.88rem; color:var(--text-secondary); margin-top:0.4rem; line-height:1.55;">Comprehensive subject-wise analytics with single-click CSV exports and audit trail logging.</p>
                    </div>
                </div>
            </div>
        `;

        // Initialize 3D Tilt Physics
        if (typeof ThreeD_Engine !== "undefined") {
            ThreeD_Engine.initCards();
        }
    }

    /* ==========================================================================
       VIEW: Student Registration (/register)
       ========================================================================== */
    function renderStudentRegister(container) {
        container.innerHTML = `
            <div class="glass-panel" style="max-width:640px; margin:1rem auto;">
                <div style="text-align:center; margin-bottom:2rem;">
                    <div class="stat-icon" style="margin:0 auto 1rem; background:rgba(56,189,248,0.15); color:var(--brand-primary);">
                        <i class="fa-solid fa-user-plus"></i>
                    </div>
                    <h2>Create Student Account</h2>
                    <p style="color:var(--text-secondary); font-size:0.92rem; margin-top:0.3rem;">
                        Step 1 of 2: Register your student profile
                    </p>
                </div>

                <div class="warning-banner" style="background:rgba(56,189,248,0.1); border-color:rgba(56,189,248,0.3); color:#38bdf8; font-size:0.88rem; margin-bottom:1.75rem;">
                    <i class="fa-solid fa-info-circle" style="font-size:1.2rem; flex-shrink:0;"></i>
                    <div>
                        <strong>Notice:</strong> Creating an account does <strong>NOT</strong> automatically register your face. You will capture your face from the dashboard after registration.
                    </div>
                </div>

                <form id="student-register-form">
                    <div class="form-group">
                        <label class="form-label">Full Name</label>
                        <input type="text" id="reg-name" class="form-control" placeholder="e.g. Rahul Sharma" required>
                    </div>

                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Roll Number</label>
                            <input type="text" id="reg-roll" class="form-control" placeholder="e.g. 23" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Email Address</label>
                            <input type="email" id="reg-email" class="form-control" placeholder="rahul@example.com" required>
                        </div>
                    </div>

                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Department</label>
                            <select id="reg-dept" class="form-control" required>
                                <option value="Computer Engineering">Computer Engineering</option>
                                <option value="Information Technology">Information Technology</option>
                                <option value="Electronics & Telecom">Electronics & Telecom</option>
                                <option value="Mechanical Engineering">Mechanical Engineering</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Class</label>
                            <input type="text" id="reg-class" class="form-control" placeholder="e.g. TY-CSE" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Division</label>
                            <input type="text" id="reg-div" class="form-control" placeholder="e.g. A" required>
                        </div>
                    </div>

                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Password</label>
                            <input type="password" id="reg-password" class="form-control" placeholder="Minimum 6 characters" minlength="6" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Confirm Password</label>
                            <input type="password" id="reg-confirm-password" class="form-control" placeholder="Re-enter password" minlength="6" required>
                        </div>
                    </div>

                    <button type="submit" id="reg-submit-btn" class="btn btn-primary" style="width:100%; margin-top:1.5rem;">
                        <i class="fa-solid fa-arrow-right-to-bracket"></i> Register & Access Dashboard
                    </button>
                </form>

                <div style="text-align:center; margin-top:1.5rem; font-size:0.9rem; color:var(--text-secondary);">
                    Already have an account? <a href="/login" style="color:var(--brand-primary); font-weight:600; text-decoration:none;" onclick="app.navigate('/login'); return false;">Log in here</a>
                </div>
            </div>
        `;

        document.getElementById("student-register-form").addEventListener("submit", async (e) => {
            e.preventDefault();
            const pwd = document.getElementById("reg-password").value;
            const confirmPwd = document.getElementById("reg-confirm-password").value;

            if (pwd !== confirmPwd) {
                return showToast("Password and confirmation password do not match.", "error");
            }

            const payload = {
                name: document.getElementById("reg-name").value.trim(),
                roll_number: document.getElementById("reg-roll").value.trim(),
                email: document.getElementById("reg-email").value.trim(),
                department: document.getElementById("reg-dept").value,
                class_name: document.getElementById("reg-class").value.trim(),
                division: document.getElementById("reg-div").value.trim(),
                password: pwd,
                confirm_password: confirmPwd
            };

            const btn = document.getElementById("reg-submit-btn");
            btn.disabled = true;
            btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Creating Account...`;

            try {
                const res = await api.registerStudent(payload);
                if (res.success && res.token) {
                    api.setToken(res.token);
                    api.setUser(res.user);
                    currentUser = res.user;
                    showToast("Account created successfully! Welcome to BioScan AI.", "success");
                    navigate("/student/dashboard");
                }
            } catch (err) {
                showToast(err.message, "error");
                btn.disabled = false;
                btn.innerHTML = `<i class="fa-solid fa-arrow-right-to-bracket"></i> Register & Access Dashboard`;
            }
        });
    }

    /* ==========================================================================
       VIEW: Student Login (/login)
       ========================================================================== */
    function renderStudentLogin(container) {
        container.innerHTML = `
            <div class="glass-panel" style="max-width:480px; margin:2rem auto;">
                <div style="text-align:center; margin-bottom:2rem;">
                    <div class="stat-icon" style="margin:0 auto 1rem; background:rgba(56,189,248,0.15); color:var(--brand-primary);">
                        <i class="fa-solid fa-user-graduate"></i>
                    </div>
                    <h2>Student Login</h2>
                    <p style="color:var(--text-secondary); font-size:0.92rem; margin-top:0.3rem;">
                        Sign in to view your attendance & face status
                    </p>
                </div>

                <form id="student-login-form">
                    <div class="form-group">
                        <label class="form-label">Email Address</label>
                        <input type="email" id="login-email" class="form-control" placeholder="e.g. rahul@example.com" required>
                    </div>

                    <div class="form-group">
                        <label class="form-label">Password</label>
                        <input type="password" id="login-password" class="form-control" placeholder="Enter password" required>
                    </div>

                    <button type="submit" id="login-submit-btn" class="btn btn-primary" style="width:100%; margin-top:1.25rem;">
                        <i class="fa-solid fa-right-to-bracket"></i> Log In
                    </button>
                </form>

                <div style="text-align:center; margin-top:1.75rem; font-size:0.9rem; color:var(--text-secondary);">
                    Don't have an account? <a href="/register" style="color:var(--brand-primary); font-weight:600; text-decoration:none;" onclick="app.navigate('/register'); return false;">Register here</a>
                </div>
            </div>
        `;

        document.getElementById("student-login-form").addEventListener("submit", async (e) => {
            e.preventDefault();
            const email = document.getElementById("login-email").value.trim();
            const password = document.getElementById("login-password").value;

            const btn = document.getElementById("login-submit-btn");
            btn.disabled = true;
            btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Authenticating...`;

            try {
                const res = await api.loginStudent({ email, password });
                if (res.success && res.token) {
                    api.setToken(res.token);
                    api.setUser(res.user);
                    currentUser = res.user;
                    showToast(`Welcome back, ${res.user.student?.name || 'Student'}!`, "success");
                    navigate("/student/dashboard");
                }
            } catch (err) {
                showToast(err.message, "error");
                btn.disabled = false;
                btn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> Log In`;
            }
        });
    }

    function quickFillStudent(email) {
        const emailEl = document.getElementById("login-email");
        const pwdEl = document.getElementById("login-password");
        if (emailEl && pwdEl) {
            emailEl.value = email;
            pwdEl.value = "student123";
        }
    }

    /* ==========================================================================
       VIEW: Admin Login (/admin/login)
       ========================================================================== */
    function renderAdminLogin(container) {
        container.innerHTML = `
            <div class="glass-panel" style="max-width:480px; margin:2rem auto; border-top:4px solid #f59e0b;">
                <div style="text-align:center; margin-bottom:2rem;">
                    <div class="stat-icon" style="margin:0 auto 1rem; background:rgba(245,158,11,0.15); color:#f59e0b;">
                        <i class="fa-solid fa-shield-halved"></i>
                    </div>
                    <h2>ADMIN LOGIN</h2>
                    <p style="color:var(--text-secondary); font-size:0.92rem; margin-top:0.3rem;">
                        Authorized Administrative Access Only
                    </p>
                </div>

                <form id="admin-login-form">
                    <div class="form-group">
                        <label class="form-label">Username</label>
                        <input type="text" id="admin-user" class="form-control" placeholder="Enter username" required autocomplete="username">
                    </div>

                    <div class="form-group">
                        <label class="form-label">Password</label>
                        <input type="password" id="admin-pass" class="form-control" placeholder="Enter password" required autocomplete="current-password">
                    </div>

                    <button type="submit" id="admin-submit-btn" class="btn" style="width:100%; margin-top:1.25rem; background:linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color:#fff;">
                        <i class="fa-solid fa-lock"></i> LOGIN
                    </button>
                </form>

                <div style="margin-top:1.5rem; padding-top:1rem; border-top:1px solid var(--border-subtle); text-align:center;">
                    <button class="btn btn-sm btn-secondary" onclick="app.quickFillAdmin()" style="font-size:0.8rem;">
                        <i class="fa-solid fa-key"></i> Auto-Fill Demo Credentials (admin / admin)
                    </button>
                </div>
            </div>
        `;

        document.getElementById("admin-login-form").addEventListener("submit", async (e) => {
            e.preventDefault();
            const username = document.getElementById("admin-user").value.trim();
            const password = document.getElementById("admin-pass").value;

            const btn = document.getElementById("admin-submit-btn");
            btn.disabled = true;
            btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Verifying...`;

            try {
                const res = await api.loginAdmin({ username, password });
                if (res.success && res.token) {
                    api.setToken(res.token);
                    api.setUser(res.user);
                    currentUser = res.user;

                    if (res.is_default_password) {
                        showToast("Warning: Default administrator credentials are in use. Please update your password in Security settings.", "warning");
                    } else {
                        showToast("Admin session authenticated.", "success");
                    }
                    navigate("/admin/dashboard");
                }
            } catch (err) {
                showToast(err.message, "error");
                btn.disabled = false;
                btn.innerHTML = `<i class="fa-solid fa-lock"></i> LOGIN`;
            }
        });
    }

    function quickFillAdmin() {
        const uEl = document.getElementById("admin-user");
        const pEl = document.getElementById("admin-pass");
        if (uEl && pEl) {
            uEl.value = "admin";
            pEl.value = "admin";
        }
    }

    /* ==========================================================================
       VIEW: Student Dashboard (/student/dashboard)
       ========================================================================== */
    async function renderStudentDashboard(container) {
        container.innerHTML = `
            <div class="loading-state">
                <div class="scanner-spinner"></div>
                <p>Loading your academic attendance profile...</p>
            </div>
        `;

        try {
            const data = await api.getStudentDashboard();
            const st = data.student;
            const metrics = data.metrics;
            const subjects = data.subject_attendance || [];
            const weeks = data.week_wise_attendance || [];
            const months = data.month_wise_attendance || [];
            const days = data.day_wise_attendance || [];
            const recent = data.recent_records || [];

            // Face status banner logic
            let faceBannerHtml = "";
            if (st.face_status === "not_registered") {
                faceBannerHtml = `
                    <div class="warning-banner" style="background:rgba(139,92,246,0.12); border-color:rgba(139,92,246,0.35); color:#c4b5fd;">
                        <div style="display:flex; align-items:center; gap:0.75rem;">
                            <i class="fa-solid fa-triangle-exclamation" style="font-size:1.5rem; color:#8b5cf6;"></i>
                            <div>
                                <strong style="color:#ffffff; font-size:1rem;">Face registration required</strong>
                                <div style="font-size:0.88rem; color:#c4b5fd; margin-top:0.2rem;">You must register your face biometric profile before your attendance can be marked automatically in class.</div>
                            </div>
                        </div>
                        <button class="btn btn-sm btn-primary" onclick="app.navigate('/student/face-registration')">
                            <i class="fa-solid fa-camera"></i> Register Face
                        </button>
                    </div>
                `;
            } else if (st.face_status === "pending") {
                faceBannerHtml = `
                    <div class="warning-banner" style="background:rgba(245,158,11,0.12); border-color:rgba(245,158,11,0.35); color:#fbbf24;">
                        <div style="display:flex; align-items:center; gap:0.75rem;">
                            <i class="fa-solid fa-hourglass-half" style="font-size:1.5rem; color:#f59e0b;"></i>
                            <div>
                                <strong style="color:#ffffff; font-size:1rem;">Face registration is waiting for admin approval</strong>
                                <div style="font-size:0.88rem; color:#fbbf24; margin-top:0.2rem;">Your biometric face scan has been submitted and is currently in the administrator review queue.</div>
                            </div>
                        </div>
                        <span class="status-badge badge-pending">PENDING</span>
                    </div>
                `;
            } else if (st.face_status === "rejected") {
                const reason = data.latest_submission?.rejection_reason || "Face was not clearly recognizable.";
                faceBannerHtml = `
                    <div class="warning-banner" style="background:rgba(239,68,68,0.12); border-color:rgba(239,68,68,0.35); color:#fca5a5;">
                        <div style="display:flex; align-items:center; gap:0.75rem;">
                            <i class="fa-solid fa-circle-xmark" style="font-size:1.5rem; color:#ef4444;"></i>
                            <div>
                                <strong style="color:#ffffff; font-size:1rem;">Face registration was rejected</strong>
                                <div style="font-size:0.88rem; color:#fca5a5; margin-top:0.2rem;">Reason: "${reason}"</div>
                            </div>
                        </div>
                        <button class="btn btn-sm btn-danger" onclick="app.navigate('/student/face-registration')">
                            <i class="fa-solid fa-rotate-right"></i> Register Again
                        </button>
                    </div>
                `;
            } else if (st.face_status === "verified") {
                faceBannerHtml = `
                    <div class="warning-banner" style="background:rgba(16,185,129,0.12); border-color:rgba(16,185,129,0.35); color:#6ee7b7;">
                        <div style="display:flex; align-items:center; gap:0.75rem;">
                            <i class="fa-solid fa-circle-check" style="font-size:1.5rem; color:#10b981;"></i>
                            <div>
                                <strong style="color:#ffffff; font-size:1rem;">✓ Face verified & Active for Biometric Attendance</strong>
                                <div style="font-size:0.88rem; color:#a7f3d0; margin-top:0.2rem;">Your face profile is active. You will be automatically marked present when scanned in class.</div>
                            </div>
                        </div>
                        <span class="status-badge badge-verified">VERIFIED</span>
                    </div>
                `;
            }

            // Subject rows html (All time)
            const isVerified = (st.face_status === "verified");
            const subjectRowsHtml = subjects.length > 0 ? subjects.map(s => {
                const subBadge = getDeptBadge(s.department || st.department);
                let statusNotice = "";
                if (!isVerified) {
                    statusNotice = `<div style="font-size:0.75rem; color:var(--status-pending); margin-top:0.35rem;"><i class="fa-solid fa-hourglass-half"></i> Face review pending — attendance tracking inactive</div>`;
                }
                
                return `
                <div class="glass-card subject-academic-card" style="padding:1.25rem; margin-bottom:1rem; position:relative; overflow:hidden;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0.75rem; flex-wrap:wrap; gap:0.5rem;">
                        <div>
                            <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
                                <strong style="font-size:1.1rem; font-family:var(--font-heading); color:var(--brand-primary);">${s.code}</strong>
                                ${subBadge}
                                ${s.semester ? `<span style="font-size:0.75rem; color:var(--text-muted); background:rgba(255,255,255,0.05); padding:0.15rem 0.45rem; border-radius:4px;">Sem ${s.semester}</span>` : ''}
                            </div>
                            <div style="color:var(--text-primary); font-size:0.95rem; font-weight:600; margin-top:0.35rem;">${s.name}</div>
                            ${statusNotice}
                        </div>
                        <span style="font-weight:800; font-family:var(--font-heading); font-size:1.25rem; color:${s.percentage >= 75 ? 'var(--status-verified)' : (s.total === 0 ? 'var(--text-muted)' : '#ef4444')};">
                            ${s.percentage}%
                        </span>
                    </div>
                    <!-- Progress bar -->
                    <div style="width:100%; height:8px; background:rgba(255,255,255,0.08); border-radius:4px; overflow:hidden; margin-bottom:0.5rem;">
                        <div style="width:${s.percentage}%; height:100%; background:${s.percentage >= 75 ? 'linear-gradient(90deg, #10b981, #38bdf8)' : (s.total === 0 ? 'rgba(255,255,255,0.08)' : 'linear-gradient(90deg, #ef4444, #f59e0b)')}; border-radius:4px;"></div>
                    </div>
                    <div style="display:flex; justify-content:space-between; font-size:0.84rem; color:var(--text-muted);">
                        <span>Attended: <strong style="color:var(--text-primary);">${s.attended}</strong> / ${s.total}</span>
                        <span>Missed: <strong style="color:${s.missed > 0 ? '#ef4444' : 'var(--text-muted)'};">${s.missed}</strong></span>
                    </div>
                </div>
            `;
            }).join("") : `
                <div class="glass-card" style="text-align:center; padding:3rem 1.5rem; color:var(--text-muted);">
                    <i class="fa-solid fa-graduation-cap" style="font-size:2.5rem; color:var(--brand-primary); margin-bottom:0.75rem; opacity:0.6;"></i>
                    <h4 style="color:var(--text-primary); margin-bottom:0.4rem;">No Subjects Scheduled Yet</h4>
                    <p style="font-size:0.88rem;">No curriculum subjects have been assigned for <strong>${st.department || 'your branch'}</strong> yet. Your department administrator will schedule them shortly.</p>
                </div>
            `;

            // Week-wise HTML
            let weekSectionHtml = "";
            if (weeks.length > 0) {
                weekSectionHtml = weeks.map(w => {
                    const subPills = (w.subjects_list || []).map(sub => `
                        <div style="background:rgba(255,255,255,0.04); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); padding:0.4rem 0.65rem; font-size:0.82rem;">
                            <strong>${sub.code}</strong>: <span style="color:${sub.attended === sub.total ? 'var(--status-verified)' : '#ef4444'}; font-weight:600;">${sub.attended}/${sub.total}</span>
                        </div>
                    `).join("");

                    return `
                        <div class="period-card">
                            <div class="period-header">
                                <div class="period-title">
                                    <i class="fa-solid fa-calendar-week" style="color:var(--brand-primary);"></i>
                                    ${w.week_label}
                                </div>
                                <div style="display:flex; align-items:center; gap:0.5rem;">
                                    <span class="stat-pill ${w.percentage >= 75 ? 'success' : 'danger'}">
                                        ${w.percentage}% Attendance
                                    </span>
                                </div>
                            </div>
                            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:0.75rem; margin-bottom:1rem;">
                                <div style="background:rgba(16,185,129,0.08); padding:0.6rem 0.85rem; border-radius:var(--radius-sm); border-left:3px solid var(--status-verified);">
                                    <div style="font-size:0.75rem; color:var(--text-muted);">Attended</div>
                                    <div style="font-size:1.1rem; font-weight:700; color:var(--status-verified);">${w.attended_lectures} Classes</div>
                                </div>
                                <div style="background:rgba(56,189,248,0.08); padding:0.6rem 0.85rem; border-radius:var(--radius-sm); border-left:3px solid var(--brand-primary);">
                                    <div style="font-size:0.75rem; color:var(--text-muted);">Total Conducted</div>
                                    <div style="font-size:1.1rem; font-weight:700; color:var(--text-primary);">${w.total_lectures} Classes</div>
                                </div>
                                <div style="background:rgba(239,68,68,0.08); padding:0.6rem 0.85rem; border-radius:var(--radius-sm); border-left:3px solid var(--status-rejected);">
                                    <div style="font-size:0.75rem; color:var(--text-muted);">Missed</div>
                                    <div style="font-size:1.1rem; font-weight:700; color:var(--status-rejected);">${w.missed_lectures} Classes</div>
                                </div>
                            </div>
                            <div>
                                <div style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:0.4rem; font-weight:600;">Subject-Wise Performance This Week:</div>
                                <div style="display:flex; flex-wrap:wrap; gap:0.5rem;">
                                    ${subPills || '<span style="color:var(--text-muted); font-size:0.82rem;">No subjects scheduled</span>'}
                                </div>
                            </div>
                        </div>
                    `;
                }).join("");
            } else {
                weekSectionHtml = `
                    <div class="glass-card" style="text-align:center; padding:3rem 1.5rem; color:var(--text-muted);">
                        <i class="fa-solid fa-calendar-week" style="font-size:2.5rem; color:var(--border-accent); margin-bottom:0.75rem;"></i>
                        <h4>No Weekly Class Sessions Found</h4>
                        <p style="font-size:0.88rem; margin-top:0.3rem;">Weekly class breakdowns will automatically appear here when sessions are conducted for your class (${st.class_name} - ${st.division}).</p>
                    </div>
                `;
            }

            // Month-wise HTML
            let monthSectionHtml = "";
            if (months.length > 0) {
                monthSectionHtml = months.map(m => {
                    const subBars = (m.subjects_list || []).map(sub => {
                        const pctSub = sub.total > 0 ? Math.round((sub.attended / sub.total) * 100) : 0;
                        return `
                            <div style="margin-bottom:0.6rem;">
                                <div style="display:flex; justify-content:space-between; font-size:0.82rem; margin-bottom:0.25rem;">
                                    <span><strong>${sub.code}</strong> — ${sub.name}</span>
                                    <span style="font-weight:700; color:${pctSub >= 75 ? 'var(--status-verified)' : '#ef4444'};">${sub.attended}/${sub.total} (${pctSub}%)</span>
                                </div>
                                <div style="width:100%; height:6px; background:rgba(255,255,255,0.06); border-radius:3px; overflow:hidden;">
                                    <div style="width:${pctSub}%; height:100%; background:${pctSub >= 75 ? 'var(--status-verified)' : '#ef4444'}; border-radius:3px;"></div>
                                </div>
                            </div>
                        `;
                    }).join("");

                    return `
                        <div class="period-card">
                            <div class="period-header">
                                <div class="period-title">
                                    <i class="fa-solid fa-calendar-days" style="color:var(--brand-primary);"></i>
                                    ${m.month_label}
                                </div>
                                <div>
                                    <span class="stat-pill ${m.percentage >= 75 ? 'success' : 'danger'}">
                                        ${m.percentage}% Monthly Rate
                                    </span>
                                </div>
                            </div>
                            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:0.75rem; margin-bottom:1.25rem;">
                                <div style="background:rgba(16,185,129,0.08); padding:0.6rem 0.85rem; border-radius:var(--radius-sm); border-left:3px solid var(--status-verified);">
                                    <div style="font-size:0.75rem; color:var(--text-muted);">Attended</div>
                                    <div style="font-size:1.1rem; font-weight:700; color:var(--status-verified);">${m.attended_lectures} Classes</div>
                                </div>
                                <div style="background:rgba(56,189,248,0.08); padding:0.6rem 0.85rem; border-radius:var(--radius-sm); border-left:3px solid var(--brand-primary);">
                                    <div style="font-size:0.75rem; color:var(--text-muted);">Total Classes</div>
                                    <div style="font-size:1.1rem; font-weight:700; color:var(--text-primary);">${m.total_lectures} Classes</div>
                                </div>
                                <div style="background:rgba(239,68,68,0.08); padding:0.6rem 0.85rem; border-radius:var(--radius-sm); border-left:3px solid var(--status-rejected);">
                                    <div style="font-size:0.75rem; color:var(--text-muted);">Missed</div>
                                    <div style="font-size:1.1rem; font-weight:700; color:var(--status-rejected);">${m.missed_lectures} Classes</div>
                                </div>
                            </div>
                            <div style="background:rgba(15,23,42,0.4); padding:1rem; border-radius:var(--radius-md); border:1px solid var(--border-subtle);">
                                <div style="font-size:0.84rem; font-weight:600; margin-bottom:0.75rem; color:var(--text-secondary);">Subject Breakdown for ${m.month_label}:</div>
                                ${subBars || '<div style="color:var(--text-muted); font-size:0.82rem;">No subjects recorded for this month</div>'}
                            </div>
                        </div>
                    `;
                }).join("");
            } else {
                monthSectionHtml = `
                    <div class="glass-card" style="text-align:center; padding:3rem 1.5rem; color:var(--text-muted);">
                        <i class="fa-solid fa-calendar-days" style="font-size:2.5rem; color:var(--border-accent); margin-bottom:0.75rem;"></i>
                        <h4>No Monthly Class Sessions Found</h4>
                        <p style="font-size:0.88rem; margin-top:0.3rem;">Monthly attendance records will appear here as lectures are conducted.</p>
                    </div>
                `;
            }

            // Day-wise HTML
            let daySectionHtml = "";
            if (days.length > 0) {
                daySectionHtml = days.map(d => {
                    const lectureRows = (d.lectures || []).map(l => {
                        let badge = "";
                        if (l.status === "present") {
                            badge = `<span class="status-badge badge-verified"><i class="fa-solid fa-check"></i> Present (${l.confidence ? l.confidence + '%' : '100%'})</span>`;
                        } else if (l.status === "in_progress") {
                            badge = `<span class="status-badge badge-pending"><i class="fa-solid fa-spinner fa-spin"></i> Session Active</span>`;
                        } else {
                            badge = `<span class="status-badge badge-rejected"><i class="fa-solid fa-xmark"></i> Absent</span>`;
                        }

                        return `
                            <div style="display:flex; justify-content:space-between; align-items:center; padding:0.6rem 0; border-bottom:1px solid var(--border-subtle); flex-wrap:wrap; gap:0.5rem;">
                                <div>
                                    <strong style="color:var(--brand-primary); font-family:var(--font-heading);">${l.subject_code}</strong>
                                    <span style="font-size:0.88rem; color:var(--text-primary); margin-left:0.4rem;">${l.subject_name}</span>
                                    <span style="font-size:0.8rem; color:var(--text-muted); margin-left:0.5rem;">(${l.start_time} - ${l.end_time})</span>
                                </div>
                                <div>${badge}</div>
                            </div>
                        `;
                    }).join("");

                    return `
                        <div class="period-card">
                            <div class="period-header">
                                <div class="period-title">
                                    <i class="fa-solid fa-calendar-day" style="color:var(--brand-primary);"></i>
                                    ${d.formatted_date} <span style="font-size:0.85rem; color:var(--text-muted); font-weight:400;">(${d.day_name})</span>
                                </div>
                                <span class="stat-pill ${d.day_percentage >= 75 ? 'success' : 'danger'}">
                                    ${d.attended_lectures}/${d.total_lectures} Attended (${d.day_percentage}%)
                                </span>
                            </div>
                            <div style="background:rgba(15,23,42,0.4); border-radius:var(--radius-md); padding:0.5rem 1rem; border:1px solid var(--border-subtle);">
                                ${lectureRows}
                            </div>
                        </div>
                    `;
                }).join("");
            } else {
                daySectionHtml = `
                    <div class="glass-card" style="text-align:center; padding:3rem 1.5rem; color:var(--text-muted);">
                        <i class="fa-solid fa-timeline" style="font-size:2.5rem; color:var(--border-accent); margin-bottom:0.75rem;"></i>
                        <h4>No Lecture Timeline Data Yet</h4>
                        <p style="font-size:0.88rem; margin-top:0.3rem;">Day-by-day class schedules and marked attendance will appear here.</p>
                    </div>
                `;
            }

            // Recent attendance table rows
            const recentRowsHtml = recent.length > 0 ? recent.map(r => `
                <tr>
                    <td><strong>${r.subject_code}</strong> (${r.subject_name})</td>
                    <td>${r.attendance_date}</td>
                    <td>${r.attendance_time}</td>
                    <td><span class="status-badge badge-verified">${r.status}</span></td>
                    <td><span style="font-family:var(--font-mono); color:var(--brand-primary); font-size:0.85rem;">${r.recognition_confidence ? r.recognition_confidence + '%' : 'Manual'}</span></td>
                </tr>
            `).join("") : `
                <tr>
                    <td colspan="5" style="text-align:center; color:var(--text-muted); padding:2rem;">No attendance records found yet.</td>
                </tr>
            `;

            // SVG Donut calculation
            const radius = 60;
            const circumference = 2 * Math.PI * radius;
            const pct = Math.min(100, Math.max(0, metrics.overall_percentage || 0));
            const dashoffset = circumference - (pct / 100) * circumference;

            // Render Timeframe Specific Main View
            let timeframeContentHtml = "";
            if (studentDashboardTimeframe === "week") {
                timeframeContentHtml = `
                    <div style="margin-bottom:2rem;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                            <h3 class="section-title"><i class="fa-solid fa-calendar-week" style="color:var(--brand-primary);"></i> Week-Wise Class Attendance</h3>
                        </div>
                        <div>${weekSectionHtml}</div>
                    </div>
                `;
            } else if (studentDashboardTimeframe === "month") {
                timeframeContentHtml = `
                    <div style="margin-bottom:2rem;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                            <h3 class="section-title"><i class="fa-solid fa-calendar-days" style="color:var(--brand-primary);"></i> Month-Wise Class Attendance</h3>
                        </div>
                        <div>${monthSectionHtml}</div>
                    </div>
                `;
            } else if (studentDashboardTimeframe === "day") {
                timeframeContentHtml = `
                    <div style="margin-bottom:2rem;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                            <h3 class="section-title"><i class="fa-solid fa-timeline" style="color:var(--brand-primary);"></i> Day-Wise Lecture History</h3>
                        </div>
                        <div>${daySectionHtml}</div>
                    </div>
                `;
            } else {
                // 'all'
                timeframeContentHtml = `
                    <!-- Metric Cards & Progress Gauge -->
                    <div style="display:grid; grid-template-columns:300px 1fr; gap:1.5rem; margin-bottom:2rem;">
                        <!-- Overall Attendance Donut Card -->
                        <div class="glass-card" style="display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:2rem 1.5rem;">
                            <h4 style="margin-bottom:1.25rem; font-size:1.1rem;">Overall Attendance</h4>
                            <div class="progress-donut-container">
                                <svg class="progress-donut-svg" width="150" height="150" viewBox="0 0 150 150">
                                    <defs>
                                        <linearGradient id="cyan-indigo-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                            <stop offset="0%" stop-color="#38bdf8" />
                                            <stop offset="100%" stop-color="#6366f1" />
                                        </linearGradient>
                                    </defs>
                                    <circle class="progress-donut-bg" cx="75" cy="75" r="${radius}" />
                                    <circle class="progress-donut-bar" cx="75" cy="75" r="${radius}" 
                                        stroke-dasharray="${circumference}" stroke-dashoffset="${dashoffset}" />
                                </svg>
                                <div class="progress-donut-text">
                                    <span class="progress-donut-val">${pct}%</span>
                                    <span class="progress-donut-sub">${pct >= 75 ? 'ELIGIBLE' : (metrics.total_classes === 0 ? 'CLEAN' : 'DEFICIT')}</span>
                                </div>
                            </div>
                            <div style="margin-top:1rem; font-size:0.82rem; color:${pct >= 75 ? 'var(--status-verified)' : (metrics.total_classes === 0 ? 'var(--text-muted)' : '#ef4444')}; font-weight:600;">
                                ${pct >= 75 ? '✓ Above 75% Minimum Criteria' : (metrics.total_classes === 0 ? 'No classes conducted yet' : '⚠ Below 75% Attendance Threshold')}
                            </div>
                        </div>

                        <!-- Attendance Stats Summary Grid -->
                        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:1rem;">
                            <div class="stat-card">
                                <div class="stat-icon emerald"><i class="fa-solid fa-calendar-check"></i></div>
                                <div class="stat-info">
                                    <span class="stat-label">Classes Attended</span>
                                    <span class="stat-value" style="color:var(--status-verified);">${metrics.classes_attended}</span>
                                </div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-icon indigo"><i class="fa-solid fa-book-open-reader"></i></div>
                                <div class="stat-info">
                                    <span class="stat-label">Total Classes</span>
                                    <span class="stat-value">${metrics.total_classes}</span>
                                </div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-icon rose"><i class="fa-solid fa-calendar-xmark"></i></div>
                                <div class="stat-info">
                                    <span class="stat-label">Classes Missed</span>
                                    <span class="stat-value" style="color:var(--status-rejected);">${metrics.classes_missed}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Subject-Wise Attendance Section -->
                    <div style="margin-bottom:2.5rem;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.25rem; flex-wrap:wrap; gap:0.75rem;">
                            <div>
                                <h3 class="section-title" style="margin-bottom:0.25rem;">
                                    <i class="fa-solid fa-chart-simple" style="color:var(--brand-primary);"></i> Subject-Wise Breakdown
                                </h3>
                                <div style="font-size:0.86rem; color:var(--text-secondary);">
                                    Curriculum Branch: <strong style="color:var(--text-primary);">${st.department}</strong> (${subjects.length} Assigned Courses)
                                </div>
                            </div>
                            <div>
                                ${getDeptBadge(st.department)}
                            </div>
                        </div>
                        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:1rem;">
                            ${subjectRowsHtml}
                        </div>
                    </div>

                    <!-- Recent Attendance History Section -->
                    <div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                            <h3 class="section-title"><i class="fa-solid fa-clock-rotate-left" style="color:var(--brand-primary);"></i> Recent Attendance Records</h3>
                            <button class="btn btn-secondary btn-sm" onclick="app.navigate('/student/attendance-history')">
                                View Full Log <i class="fa-solid fa-arrow-right"></i>
                            </button>
                        </div>
                        <div class="table-responsive">
                            <table class="custom-table">
                                <thead>
                                    <tr>
                                        <th>Subject</th>
                                        <th>Date</th>
                                        <th>Time</th>
                                        <th>Status</th>
                                        <th>AI Confidence</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${recentRowsHtml}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;
            }

            container.innerHTML = `
                <!-- Welcome Banner -->
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1.5rem; flex-wrap:wrap; gap:1rem;">
                    <div>
                        <h1 style="font-size:2rem;">Welcome, ${st.name}</h1>
                        <div style="color:var(--text-secondary); font-size:0.95rem; margin-top:0.3rem;">
                            Roll Number: <strong style="color:var(--text-primary); font-family:var(--font-mono);">${st.roll_number}</strong> | 
                            Class: <strong>${st.class_name}</strong> (${st.division}) | 
                            Dept: <strong>${st.department}</strong>
                        </div>
                    </div>
                    <div>
                        <button class="btn btn-secondary btn-sm" onclick="app.navigate('/student/face-registration')">
                            <i class="fa-solid fa-camera"></i> Biometric Studio
                        </button>
                    </div>
                </div>

                <!-- Face Status Banner -->
                ${faceBannerHtml}

                <!-- Timeframe Filter Tabs -->
                <div class="timeframe-bar" style="margin-bottom:1.75rem;">
                    <button class="timeframe-btn ${studentDashboardTimeframe === 'all' ? 'active' : ''}" onclick="app.setStudentDashboardTimeframe('all')">
                        <i class="fa-solid fa-chart-pie"></i> All-Time Overview
                    </button>
                    <button class="timeframe-btn ${studentDashboardTimeframe === 'week' ? 'active' : ''}" onclick="app.setStudentDashboardTimeframe('week')">
                        <i class="fa-solid fa-calendar-week"></i> Week-Wise Breakdown (${weeks.length})
                    </button>
                    <button class="timeframe-btn ${studentDashboardTimeframe === 'month' ? 'active' : ''}" onclick="app.setStudentDashboardTimeframe('month')">
                        <i class="fa-solid fa-calendar-days"></i> Month-Wise Breakdown (${months.length})
                    </button>
                    <button class="timeframe-btn ${studentDashboardTimeframe === 'day' ? 'active' : ''}" onclick="app.setStudentDashboardTimeframe('day')">
                        <i class="fa-solid fa-timeline"></i> Day-Wise Timeline (${days.length})
                    </button>
                </div>

                <!-- Dynamic View Body -->
                ${timeframeContentHtml}
            `;
        } catch (err) {
            container.innerHTML = `
                <div class="glass-panel" style="text-align:center; padding:3rem 1.5rem;">
                    <i class="fa-solid fa-triangle-exclamation" style="font-size:2.5rem; color:#ef4444; margin-bottom:1rem;"></i>
                    <h3>Error Loading Dashboard</h3>
                    <p style="color:var(--text-secondary); margin:0.5rem 0 1.5rem;">${err.message}</p>
                    <button class="btn btn-primary" onclick="app.navigate('/student/dashboard')">Retry</button>
                </div>
            `;
        }
    }

    /* ==========================================================================
       VIEW: Student Face Registration Studio (/student/face-registration)
       ========================================================================== */
    async function renderStudentFaceRegistration(container) {
        container.innerHTML = `
            <div style="max-width:840px; margin:0 auto;">
                <div style="margin-bottom:1.5rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
                    <div>
                        <h2>Biometric Face Registration Studio</h2>
                        <p style="color:var(--text-secondary); font-size:0.92rem; margin-top:0.2rem;">
                            Capture your face using webcam to generate a 128-dimensional biometric descriptor for admin approval.
                        </p>
                    </div>
                    <button class="btn btn-secondary btn-sm" onclick="app.navigate('/student/dashboard')">
                        <i class="fa-solid fa-arrow-left"></i> Dashboard
                    </button>
                </div>

                <!-- Camera stream container with Oval Head Guide -->
                <div class="glass-card" style="padding:1.5rem; text-align:center; margin-bottom:1.5rem;">
                    <div class="camera-wrapper" style="position:relative; display:inline-block; border-radius:var(--radius-lg); overflow:hidden; border:2px solid var(--border-accent); background:#000;">
                        <video id="student-face-video" width="640" height="480" autoplay muted playsinline style="transform:scaleX(-1); display:block; max-width:100%; height:auto;"></video>
                        <canvas id="student-face-canvas" width="640" height="480" style="position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none;"></canvas>
                        
                        <!-- Face Oval Guide Overlay -->
                        <div class="face-guide-oval"></div>

                        <!-- Live Status Overlay -->
                        <div id="student-scanner-hud" class="scanner-hud">
                            <div id="hud-status-text"><i class="fa-solid fa-camera"></i> Initializing Camera...</div>
                        </div>
                    </div>

                    <!-- Real-Time Biometric Feedback Checklist -->
                    <div style="display:flex; justify-content:center; gap:1.5rem; margin-top:1.25rem; flex-wrap:wrap; font-size:0.85rem;">
                        <div id="check-face"><span style="color:var(--text-muted);"><i class="fa-solid fa-circle-notch fa-spin"></i> Detecting Face...</span></div>
                        <div id="check-lighting"><span style="color:var(--text-muted);"><i class="fa-solid fa-sun"></i> Lighting: --</span></div>
                        <div id="check-liveness"><span style="color:var(--text-muted);"><i class="fa-solid fa-shield-halved"></i> Liveness: --</span></div>
                    </div>

                    <div style="margin-top:1.5rem; display:flex; justify-content:center; gap:1rem;">
                        <button id="btn-capture-face" class="btn btn-primary btn-lg" style="padding:0.75rem 2rem;">
                            <i class="fa-solid fa-camera"></i> Capture Biometric Profile
                        </button>
                    </div>
                </div>

                <!-- Preview & Submission Card (Hidden until capture) -->
                <div id="capture-result-panel" class="glass-panel" style="display:none; padding:1.5rem; margin-bottom:2rem;">
                    <h3 style="margin-bottom:1rem; color:var(--status-verified);"><i class="fa-solid fa-circle-check"></i> Biometric Sample Captured</h3>
                    <div style="display:flex; gap:1.5rem; align-items:center; flex-wrap:wrap;">
                        <img id="captured-preview-img" style="width:140px; height:140px; border-radius:var(--radius-md); object-fit:cover; border:2px solid var(--status-verified);" alt="Face Preview">
                        <div style="flex:1; min-width:260px;">
                            <h4>Verification Passed</h4>
                            <p style="color:var(--text-secondary); font-size:0.88rem; margin:0.3rem 0 1rem;">
                                AI Facial Feature Descriptor (128-dimensional embedding) successfully computed. Liveness score: <strong id="captured-liveness-val" style="color:var(--status-verified);">--</strong>
                            </p>
                            <div style="display:flex; gap:0.75rem;">
                                <button id="btn-submit-face-approval" class="btn btn-success">
                                    <i class="fa-solid fa-paper-plane"></i> Submit for Admin Review
                                </button>
                                <button id="btn-retake-face" class="btn btn-secondary">
                                    <i class="fa-solid fa-rotate-left"></i> Retake
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Initialize FaceEngine and camera
        const video = document.getElementById("student-face-video");
        const canvas = document.getElementById("student-face-canvas");
        const hud = document.getElementById("student-scanner-hud");
        const statusTextEl = document.getElementById("hud-status-text");
        const checkFaceEl = document.getElementById("check-face");
        const checkLightingEl = document.getElementById("check-lighting");
        const checkLivenessEl = document.getElementById("check-liveness");
        const btnCapture = document.getElementById("btn-capture-face");

        let lastAnalysis = null;
        let capturedData = null;

        await FaceEngine.init();
        const cameraStarted = await FaceEngine.startCamera(video, canvas);
        if (!cameraStarted) {
            statusTextEl.innerHTML = `<span style="color:#ef4444;"><i class="fa-solid fa-triangle-exclamation"></i> Camera Access Denied or Unavailable</span>`;
            return;
        }

        // Start tracking
        FaceEngine.startTrackingLoop((analysis) => {
            lastAnalysis = analysis;
            // ... (rest of logic)
        });
    }

    /* ==========================================================================
       VIEW: Student Attendance History (/student/attendance-history)
       ========================================================================== */
    async function renderStudentAttendanceHistory(container) {
        container.innerHTML = `
            <div class="loading-state">
                <div class="scanner-spinner"></div>
                <p>Fetching verified attendance history...</p>
            </div>
        `;

        try {
            const data = await api.getStudentAttendance(studentAttendanceFilter);
            const records = data.records || [];

            const rowsHtml = records.length > 0 ? records.map(r => `
                <tr>
                    <td><strong>${r.subject_code}</strong></td>
                    <td>${r.subject_name}</td>
                    <td>${r.session_name || "Regular Lecture"}</td>
                    <td>${r.attendance_date}</td>
                    <td>${r.attendance_time}</td>
                    <td><span class="status-badge badge-verified">${r.status}</span></td>
                    <td><span style="font-family:var(--font-mono); color:var(--brand-primary);">${r.recognition_confidence ? r.recognition_confidence + '%' : '100%'}</span></td>
                    <td><span style="color:var(--status-verified);">${(r.liveness_score * 100).toFixed(0)}%</span></td>
                </tr>
            `).join("") : `
                <tr>
                    <td colspan="8" style="text-align:center; color:var(--text-muted); padding:3rem;">
                        <i class="fa-solid fa-clipboard-question" style="font-size:2rem; margin-bottom:0.5rem; color:var(--border-accent);"></i>
                        <div>No attendance records found for the selected criteria.</div>
                    </td>
                </tr>
            `;

            container.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem; flex-wrap:wrap; gap:1rem;">
                    <div>
                        <h2>My Attendance History</h2>
                        <p style="color:var(--text-secondary); font-size:0.92rem;">Verified biometric attendance records logged for your account.</p>
                    </div>
                    <button class="btn btn-secondary btn-sm" onclick="app.navigate('/student/dashboard')">
                        <i class="fa-solid fa-arrow-left"></i> Dashboard
                    </button>
                </div>

                <div class="glass-panel" style="padding:1.5rem;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:0.75rem;">
                        <div style="font-size:0.9rem; color:var(--text-secondary);">
                            Total verified records: <strong style="color:var(--brand-primary);">${records.length}</strong>
                        </div>
                    </div>

                    <div class="table-responsive">
                        <table class="custom-table">
                            <thead>
                                <tr>
                                    <th>Subject Code</th>
                                    <th>Subject Name</th>
                                    <th>Session</th>
                                    <th>Date</th>
                                    <th>Time</th>
                                    <th>Status</th>
                                    <th>Confidence</th>
                                    <th>Liveness</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rowsHtml}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    /* ==========================================================================
       VIEW: Admin Dashboard (/admin/dashboard)
       ========================================================================== */
    async function renderAdminDashboard(container) {
        container.innerHTML = `
            <div class="loading-state">
                <div class="scanner-spinner"></div>
                <p>Loading Administrator Command Center...</p>
            </div>
        `;

        try {
            const data = await api.getAdminDashboard();
            const metrics = data.metrics;
            const pendingList = data.pending_preview || [];
            const sessions = data.sessions_today || [];
            const logs = data.recent_logs || [];

            // Warning banner if default password warning is active
            const showDefaultWarning = true; // Handled dynamically

            const pendingCardsHtml = pendingList.length > 0 ? pendingList.map(p => `
                <div class="glass-card" style="padding:1.25rem; display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:0.75rem;">
                    <div style="display:flex; align-items:center; gap:1rem;">
                        <img src="${p.preview_reference}" style="width:48px; height:48px; border-radius:50%; object-fit:cover; border:2px solid var(--border-accent);" alt="Face">
                        <div>
                            <strong>${p.name}</strong> (Roll: ${p.roll_number})
                            <div style="font-size:0.82rem; color:var(--text-secondary);">${p.class_name} - Div ${p.division} | ${p.department}</div>
                        </div>
                    </div>
                    <div style="display:flex; gap:0.5rem;">
                        <button class="btn btn-sm btn-success" onclick="app.handleApprovePending(${p.id})">
                            <i class="fa-solid fa-check"></i> Approve
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="app.promptRejectPending(${p.id}, '${p.name}')">
                            <i class="fa-solid fa-xmark"></i> Reject
                        </button>
                    </div>
                </div>
            `).join("") : `
                <div style="text-align:center; padding:2rem; color:var(--text-muted);">
                    <i class="fa-solid fa-circle-check" style="font-size:2rem; color:var(--status-verified); margin-bottom:0.5rem;"></i>
                    <div>All face registration requests reviewed!</div>
                </div>
            `;

            container.innerHTML = `
                <!-- Warning banner for default admin credentials -->
                <div class="warning-banner">
                    <div style="display:flex; align-items:center; gap:0.75rem;">
                        <i class="fa-solid fa-shield-exclamation" style="font-size:1.5rem; color:#f59e0b;"></i>
                        <div>
                            <strong style="color:#ffffff; font-size:0.95rem;">Security Notice:</strong>
                            Default administrator credentials are active. Please change your password before production deployment.
                        </div>
                    </div>
                    <button class="btn btn-sm" style="background:#f59e0b; color:#000; font-weight:700;" onclick="app.navigate('/admin/settings/security')">
                        Change Password
                    </button>
                </div>

                <!-- Header Title & Quick Actions -->
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem; flex-wrap:wrap; gap:1rem;">
                    <div>
                        <h2>Administrator Dashboard</h2>
                        <p style="color:var(--text-secondary); font-size:0.92rem;">Institution Attendance & Biometrics Control Hub</p>
                    </div>
                    <div style="display:flex; gap:0.75rem;">
                        <button class="btn btn-primary btn-sm" onclick="app.navigate('/admin/live-attendance')">
                            <i class="fa-solid fa-camera"></i> Launch Live Scanner
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="app.navigate('/admin/pending')">
                            <i class="fa-solid fa-user-clock"></i> Review Pending Faces (${metrics.pending_faces})
                        </button>
                    </div>
                </div>

                <!-- Key Metrics Grid -->
                <div class="stats-grid">
                    <div class="stat-card" style="cursor:pointer;" onclick="app.navigate('/admin/students')">
                        <div class="stat-icon indigo"><i class="fa-solid fa-users"></i></div>
                        <div class="stat-info">
                            <span class="stat-label">Total Students</span>
                            <span class="stat-value">${metrics.total_students}</span>
                        </div>
                    </div>

                    <div class="stat-card" style="cursor:pointer;" onclick="app.navigate('/admin/students')">
                        <div class="stat-icon emerald"><i class="fa-solid fa-user-check"></i></div>
                        <div class="stat-info">
                            <span class="stat-label">Active Accounts</span>
                            <span class="stat-value" style="color:var(--status-verified);">${metrics.active_students}</span>
                        </div>
                    </div>

                    <div class="stat-card" style="cursor:pointer;" onclick="app.navigate('/admin/pending')">
                        <div class="stat-icon amber"><i class="fa-solid fa-user-clock"></i></div>
                        <div class="stat-info">
                            <span class="stat-label">Pending Faces</span>
                            <span class="stat-value" style="color:var(--status-pending);">${metrics.pending_faces}</span>
                        </div>
                    </div>

                    <div class="stat-card">
                        <div class="stat-icon emerald"><i class="fa-solid fa-calendar-check"></i></div>
                        <div class="stat-info">
                            <span class="stat-label">Present Today</span>
                            <span class="stat-value" style="color:var(--status-verified);">${metrics.present_today}</span>
                        </div>
                    </div>

                    <div class="stat-card">
                        <div class="stat-icon ${metrics.absent_today > 0 ? 'rose' : 'emerald'}">
                            <i class="fa-solid ${metrics.absent_today > 0 ? 'fa-calendar-xmark' : 'fa-circle-check'}"></i>
                        </div>
                        <div class="stat-info">
                            <span class="stat-label">Absent Today</span>
                            <span class="stat-value" style="color:${metrics.absent_today > 0 ? 'var(--status-rejected)' : 'var(--status-verified)'};">${metrics.absent_today}</span>
                            ${sessions.length === 0 ? `<div style="font-size:0.72rem; color:var(--text-muted); margin-top:2px;">No sessions today</div>` : ''}
                        </div>
                    </div>

                    <div class="stat-card">
                        <div class="stat-icon" style="background:rgba(56,189,248,0.15); color:var(--brand-primary);"><i class="fa-solid fa-percent"></i></div>
                        <div class="stat-info">
                            <span class="stat-label">Overall Rate</span>
                            <span class="stat-value" style="color:var(--brand-primary);">${(metrics.total_students > 0 && metrics.overall_attendance_percentage != null) ? metrics.overall_attendance_percentage : 0}%</span>
                        </div>
                    </div>
                </div>

                <!-- Two-Column Section: Pending Face Reviews & Today's Sessions -->
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(400px, 1fr)); gap:1.5rem; margin-bottom:2rem;">
                    <!-- Pending Face Queue Card -->
                    <div class="glass-panel" style="padding:1.5rem;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                            <h3 class="section-title" style="font-size:1.15rem;">
                                <i class="fa-solid fa-id-card" style="color:var(--status-pending);"></i> Pending Face Reviews
                            </h3>
                            <button class="btn btn-outline btn-sm" onclick="app.navigate('/admin/pending')">View All</button>
                        </div>
                        <div>
                            ${pendingCardsHtml}
                        </div>
                    </div>

                    <!-- Today's Sessions Card -->
                    <div class="glass-panel" style="padding:1.5rem;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                            <h3 class="section-title" style="font-size:1.15rem;">
                                <i class="fa-solid fa-calendar-days" style="color:var(--brand-primary);"></i> Today's Lecture Sessions
                            </h3>
                            <button class="btn btn-outline btn-sm" onclick="app.navigate('/admin/sessions')">Manage Sessions</button>
                        </div>
                        <div>
                            ${sessions.length > 0 ? sessions.map(s => `
                                <div class="glass-card" style="padding:1rem; margin-bottom:0.75rem; display:flex; justify-content:space-between; align-items:center;">
                                    <div>
                                        <strong>${s.subject_code}</strong> — ${s.session_name}
                                        <div style="font-size:0.82rem; color:var(--text-secondary);">${s.start_time} - ${s.end_time} | Class: ${s.class_name} (${s.division})</div>
                                    </div>
                                    <button class="btn btn-primary btn-sm" onclick="app.launchSessionScanner(${s.id})">
                                        <i class="fa-solid fa-camera"></i> Scan
                                    </button>
                                </div>
                            `).join("") : `<div style="text-align:center; padding:2rem; color:var(--text-muted);">No sessions scheduled for today.</div>`}
                        </div>
                    </div>
                </div>

                <!-- Recent Audit Log Trail -->
                <div class="glass-panel" style="padding:1.5rem;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                        <h3 class="section-title" style="font-size:1.15rem;">
                            <i class="fa-solid fa-shield-cat" style="color:#818cf8;"></i> System Activity & Audit Trail
                        </h3>
                        <button class="btn btn-outline btn-sm" onclick="app.navigate('/admin/audit-logs')">Full Audit Log</button>
                    </div>
                    <div class="table-responsive">
                        <table class="custom-table">
                            <thead>
                                <tr>
                                    <th>Event Action</th>
                                    <th>Details</th>
                                    <th>Timestamp</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${logs.slice(0, 5).map(l => `
                                    <tr>
                                        <td><span class="user-role-tag" style="background:rgba(56,189,248,0.12);">${l.action}</span></td>
                                        <td>${l.details}</td>
                                        <td style="font-size:0.82rem; color:var(--text-muted);">${l.timestamp}</td>
                                    </tr>
                                `).join("")}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    /* ==========================================================================
       VIEW: Admin Pending Face Registrations (/admin/pending)
       ========================================================================== */
    async function renderAdminPending(container) {
        container.innerHTML = `
            <div class="loading-state">
                <div class="scanner-spinner"></div>
                <p>Loading pending biometric face queue...</p>
            </div>
        `;

        try {
            const data = await api.getPendingFaces();
            const items = data.pending_faces || [];

            const cardsHtml = items.length > 0 ? items.map(p => `
                <div class="glass-card" style="padding:1.5rem; display:flex; flex-direction:column; justify-content:space-between; gap:1.25rem;">
                    <div style="display:flex; gap:1.25rem;">
                        <img src="${p.preview_reference}" alt="Student Face" style="width:100px; height:100px; border-radius:var(--radius-md); object-fit:cover; border:2px solid var(--border-accent); cursor:pointer;" onclick="app.previewLargeImage('${p.preview_reference}', '${p.student_name}')">
                        <div style="flex:1;">
                            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                                <h4 style="font-size:1.15rem;">${p.student_name}</h4>
                                <span class="status-badge badge-pending">PENDING</span>
                            </div>
                            <div style="font-size:0.88rem; color:var(--text-secondary); margin-top:0.25rem;">
                                Roll Number: <strong style="color:var(--text-primary); font-family:var(--font-mono);">${p.roll_number}</strong>
                            </div>
                            <div style="font-size:0.84rem; color:var(--text-muted); margin-top:0.2rem;">
                                ${p.class_name} (${p.division}) • ${p.department}
                            </div>
                            <div style="font-size:0.8rem; color:var(--text-muted); margin-top:0.2rem;">
                                Email: ${p.email}
                            </div>
                        </div>
                    </div>
                    <div style="display:flex; gap:0.75rem; padding-top:1rem; border-top:1px solid var(--border-subtle);">
                        <button class="btn btn-success btn-sm" style="flex:1;" onclick="app.handleApprovePending(${p.pending_id})">
                            <i class="fa-solid fa-check"></i> APPROVE
                        </button>
                        <button class="btn btn-danger btn-sm" style="flex:1;" onclick="app.promptRejectPending(${p.pending_id}, '${p.student_name}')">
                            <i class="fa-solid fa-xmark"></i> REJECT
                        </button>
                    </div>
                </div>
            `).join("") : `
                <div class="glass-panel" style="grid-column:1/-1; text-align:center; padding:4rem 2rem;">
                    <i class="fa-solid fa-circle-check" style="font-size:3rem; color:var(--status-verified); margin-bottom:1rem;"></i>
                    <h3>No Pending Face Registrations</h3>
                    <p style="color:var(--text-secondary); margin-top:0.5rem;">All submitted student facial biometrics have been reviewed and processed.</p>
                </div>
            `;

            container.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem; flex-wrap:wrap; gap:1rem;">
                    <div>
                        <h2>Pending Face Registrations (${items.length})</h2>
                        <p style="color:var(--text-secondary); font-size:0.92rem;">Review student webcam captures. Approving activates their face for AI attendance recognition.</p>
                    </div>
                    <button class="btn btn-secondary btn-sm" onclick="app.navigate('/admin/dashboard')">
                        <i class="fa-solid fa-arrow-left"></i> Dashboard
                    </button>
                </div>

                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(360px, 1fr)); gap:1.5rem;">
                    ${cardsHtml}
                </div>
            `;
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    async function handleApprovePending(pendingId) {
        try {
            const res = await api.approvePendingFace(pendingId);
            if (res.success) {
                showToast(res.message, "success");
                if (currentRoute === "/admin/pending") renderAdminPending(document.getElementById("app-viewport"));
                else if (currentRoute === "/admin/dashboard") renderAdminDashboard(document.getElementById("app-viewport"));
            }
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    function promptRejectPending(pendingId, studentName) {
        showModal(
            `Reject Face Registration`,
            `
                <p style="color:var(--text-secondary); font-size:0.92rem; margin-bottom:1rem;">
                    Provide a rejection reason for <strong>${studentName}</strong>. The student will be notified and allowed to capture their face again.
                </p>
                <div class="form-group">
                    <label class="form-label">Rejection Reason</label>
                    <select id="modal-reject-reason" class="form-control" style="margin-bottom:0.75rem;">
                        <option value="Face was blurry or poorly illuminated">Face was blurry or poorly illuminated</option>
                        <option value="Face was not centered or too far">Face was not centered or too far</option>
                        <option value="Multiple faces or obstructed view">Multiple faces or obstructed view</option>
                        <option value="Invalid / spoofed photo detected">Invalid / spoofed photo detected</option>
                    </select>
                </div>
            `,
            `
                <button class="btn btn-secondary btn-sm" onclick="app.closeModal()">Cancel</button>
                <button class="btn btn-danger btn-sm" onclick="app.confirmRejectPending(${pendingId})">Confirm Rejection</button>
            `
        );
    }

    async function confirmRejectPending(pendingId) {
        const reason = document.getElementById("modal-reject-reason")?.value || "Face quality insufficient.";
        closeModal();

        try {
            const res = await api.rejectPendingFace(pendingId, reason);
            if (res.success) {
                showToast(res.message, "info");
                if (currentRoute === "/admin/pending") renderAdminPending(document.getElementById("app-viewport"));
                else if (currentRoute === "/admin/dashboard") renderAdminDashboard(document.getElementById("app-viewport"));
            }
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    function previewLargeImage(src, name) {
        showModal(
            `Face Biometric Preview: ${name}`,
            `<div style="text-align:center;"><img src="${src}" style="max-width:100%; border-radius:var(--radius-md); border:1px solid var(--border-subtle);" alt="${name}"></div>`,
            `<button class="btn btn-primary btn-sm" onclick="app.closeModal()">Close</button>`
        );
    }

    /* ==========================================================================
       VIEW: Admin Live AI Attendance Scanner (/admin/live-attendance)
       ========================================================================== */
    async function renderAdminLiveAttendance(container) {
        container.innerHTML = `
            <div class="loading-state">
                <div class="scanner-spinner"></div>
                <p>Loading attendance scanner module...</p>
            </div>
        `;

        try {
            const sessData = await api.getSessions("active");
            const sessions = sessData.sessions || [];

            container.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem; flex-wrap:wrap; gap:1rem;">
                    <div>
                        <h2>Live AI Attendance Scanner</h2>
                        <p style="color:var(--text-secondary); font-size:0.92rem;">Real-time camera recognition against verified student biometric profiles.</p>
                    </div>
                    <div style="display:flex; gap:0.5rem;">
                        <button class="btn btn-primary btn-sm" onclick="app.promptCreateSession()">
                            <i class="fa-solid fa-plus"></i> + New Lecture Session
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="app.navigate('/admin/dashboard')">
                            <i class="fa-solid fa-arrow-left"></i> Dashboard
                        </button>
                    </div>
                </div>

                <div style="display:grid; grid-template-columns:1fr 360px; gap:1.5rem;">
                    <!-- Left: Camera Kiosk Box -->
                    <div class="glass-panel" style="padding:1.5rem;">
                        <!-- Session Selector -->
                        <div style="margin-bottom:1.25rem; display:flex; gap:0.6rem; align-items:center; flex-wrap:wrap;">
                            <label class="form-label" style="margin:0; white-space:nowrap;"><i class="fa-solid fa-chalkboard-user"></i> Active Session:</label>
                            <select id="kiosk-session-select" class="form-control" style="flex:1; min-width:200px;">
                                ${sessions.length > 0 ? sessions.map(s => `
                                    <option value="${s.id}">${s.subject_code} - ${s.session_name} (${s.class_name} ${s.division})</option>
                                `).join("") : `<option value="">-- No Active Session (Click '+ Start Session' to open) --</option>`}
                            </select>
                            ${sessions.length > 0 ? `
                                <button class="btn btn-warning btn-sm" id="btn-reset-current-session" title="Reset all attendance for this active session" onclick="app.handleResetCurrentScannerSession()" style="white-space:nowrap;">
                                    <i class="fa-solid fa-rotate-left"></i> Reset Session
                                </button>
                                <button class="btn btn-secondary btn-sm" id="btn-view-current-session" title="View attendees & active student data for this session" onclick="app.viewCurrentScannerSessionData()" style="white-space:nowrap;">
                                    <i class="fa-solid fa-table-list"></i> View Data
                                </button>
                                <button class="btn btn-outline btn-sm" id="btn-close-current-session" title="End / Close this lecture session" onclick="app.handleCloseCurrentScannerSession()" style="white-space:nowrap;">
                                    <i class="fa-solid fa-lock"></i> End Session
                                </button>
                                <button class="btn btn-danger btn-sm" id="btn-delete-current-session" title="Delete / Remove this session" onclick="app.handleDeleteCurrentScannerSession()" style="white-space:nowrap; padding: 0.45rem 0.65rem;">
                                    <i class="fa-solid fa-trash"></i>
                                </button>
                            ` : `
                                <button class="btn btn-primary btn-sm" onclick="app.quickStartTodaySession()" style="white-space:nowrap;">
                                    <i class="fa-solid fa-bolt"></i> + Start Session
                                </button>
                            `}
                        </div>

                        ${sessions.length === 0 ? `
                            <div style="margin-bottom:1rem; padding:0.65rem 1rem; background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.3); border-radius:var(--radius-md); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
                                <span style="color:#f59e0b; font-size:0.85rem;"><i class="fa-solid fa-triangle-exclamation"></i> No active lecture session is currently open. Click <strong>'+ Start Session'</strong> to start taking attendance.</span>
                                <button class="btn btn-warning btn-sm" onclick="app.quickStartTodaySession()"><i class="fa-solid fa-bolt"></i> Quick Open Session</button>
                            </div>
                        ` : ''}

                        <!-- Live Video Stream -->
                        <div class="camera-scanner-wrapper">
                            <video id="kiosk-video" class="camera-video" playsinline autoplay muted></video>
                            <canvas id="kiosk-canvas" class="camera-canvas-overlay"></canvas>
                            <div class="scanner-laser-line"></div>
                            <div class="face-target-reticle"></div>
                        </div>

                        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:1.25rem;">
                            <div id="kiosk-recognition-feedback" style="font-size:0.92rem; color:var(--text-secondary);">
                                <i class="fa-solid fa-radar fa-spin"></i> Scanner active. Waiting for student in camera view...
                            </div>
                            <span class="status-badge badge-verified">
                                <i class="fa-solid fa-circle" style="font-size:0.5rem;"></i> AI ENGINE ACTIVE
                            </span>
                        </div>
                    </div>

                    <!-- Right: Live Attendance Ticker / Log -->
                    <div class="glass-panel" style="padding:1.5rem; display:flex; flex-direction:column;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                            <h4 style="margin:0; display:flex; align-items:center; gap:0.5rem;">
                                <i class="fa-solid fa-bolt" style="color:var(--brand-primary);"></i> Attendance Log
                            </h4>
                            <span id="kiosk-attendance-count-badge" class="status-badge badge-verified" style="font-size:0.75rem;">0 Marked</span>
                        </div>
                        <div id="kiosk-ticker-list" style="flex:1; overflow-y:auto; max-height:460px; display:flex; flex-direction:column; gap:0.6rem;">
                            <div style="text-align:center; padding:3rem 1rem; color:var(--text-muted); font-size:0.88rem;">
                                Attendance entries will appear here in real time as faces are verified.
                            </div>
                        </div>
                    </div>
                </div>
            `;

            const videoEl = document.getElementById("kiosk-video");
            const canvasEl = document.getElementById("kiosk-canvas");
            const feedbackEl = document.getElementById("kiosk-recognition-feedback");
            const tickerList = document.getElementById("kiosk-ticker-list");
            const sessionSelect = document.getElementById("kiosk-session-select");
            const countBadge = document.getElementById("kiosk-attendance-count-badge");

            async function loadSessionAttendance(sessId) {
                if (!sessId) {
                    tickerList.innerHTML = `<div style="text-align:center; padding:3rem 1rem; color:var(--text-muted); font-size:0.88rem;">No session active. Create one to start scanning.</div>`;
                    if (countBadge) countBadge.innerText = "0 Marked";
                    return;
                }
                try {
                    const recRes = await api.getAttendanceRecords({ session_id: sessId });
                    const records = recRes.records || [];
                    if (countBadge) countBadge.innerText = `${records.length} Marked`;

                    if (records.length === 0) {
                        tickerList.innerHTML = `<div style="text-align:center; padding:3rem 1rem; color:var(--text-muted); font-size:0.88rem;">No students marked present yet for this session. Look into the camera to mark attendance.</div>`;
                    } else {
                        tickerList.innerHTML = records.map(r => `
                            <div class="glass-card" style="padding:0.75rem 1rem; border-left:3px solid var(--status-verified);">
                                <div style="display:flex; justify-content:space-between; align-items:center;">
                                    <strong>${r.student_name}</strong>
                                    <span class="status-badge badge-verified" style="font-size:0.7rem;">PRESENT</span>
                                </div>
                                <div style="font-size:0.78rem; color:var(--text-secondary); margin-top:0.2rem;">
                                    Roll: ${r.roll_number} • Match: ${r.recognition_confidence}% • ${r.attendance_time}
                                </div>
                            </div>
                        `).join("");
                    }
                } catch (e) {
                    console.error("Failed to load session attendance records:", e);
                }
            }

            // Load initial attendance records for active session
            if (sessionSelect && sessionSelect.value) {
                loadSessionAttendance(sessionSelect.value);
            } else if (sessions.length > 0) {
                sessionSelect.value = sessions[0].id;
                loadSessionAttendance(sessions[0].id);
            }

            // Listen for session switch
            if (sessionSelect) {
                sessionSelect.addEventListener("change", () => {
                    feedbackEl.innerHTML = `<span style="color:var(--text-secondary);"><i class="fa-solid fa-rotate"></i> Switched session. Ready for scanning...</span>`;
                    loadSessionAttendance(sessionSelect.value);
                });
            }

            const camRes = await FaceEngine.startCamera(videoEl, canvasEl);
            if (!camRes.success) {
                feedbackEl.innerHTML = `<span style="color:#ef4444;"><i class="fa-solid fa-circle-exclamation"></i> ${camRes.error}</span>`;
                return showToast(camRes.error, "error");
            }

            let isMatchingInProgress = false;
            let lastAnalyzedFace = null;

            FaceEngine.startTrackingLoop((analysis) => {
                lastAnalyzedFace = analysis;
            });

            // Polling recognition loop every 750ms
            pendingScanInterval = setInterval(async () => {
                const sessionId = sessionSelect ? sessionSelect.value : null;
                if (!sessionId) {
                    if (feedbackEl) {
                        feedbackEl.innerHTML = `<span style="color:#f59e0b;"><i class="fa-solid fa-triangle-exclamation"></i> Please select or start an active session above to mark attendance.</span>`;
                    }
                    return;
                }
                if (!lastAnalyzedFace || !lastAnalyzedFace.detected || !lastAnalyzedFace.isReady || isMatchingInProgress) {
                    if (feedbackEl && (!lastAnalyzedFace || !lastAnalyzedFace.detected)) {
                        feedbackEl.innerHTML = `<span style="color:var(--text-muted);"><i class="fa-solid fa-camera"></i> Camera active. Looking for face in frame...</span>`;
                    }
                    return;
                }

                isMatchingInProgress = true;
                try {
                    const res = await api.recognizeAndMark({
                        session_id: parseInt(sessionId),
                        face_embedding: lastAnalyzedFace.descriptor,
                        liveness_score: lastAnalyzedFace.livenessScore
                    });

                    if (res.matched) {
                        const st = res.student;
                        if (res.already_marked) {
                            feedbackEl.innerHTML = `<span style="color:#f59e0b;"><i class="fa-solid fa-circle-info"></i> ${st.name} (Roll: ${st.roll_number}) already marked present in this session.</span>`;
                        } else {
                            feedbackEl.innerHTML = `<span style="color:var(--status-verified);"><i class="fa-solid fa-circle-check"></i> Marked present: ${st.name} (${st.confidence}% match)</span>`;
                            playRecognitionChime();

                            // Prepend to ticker list
                            const item = document.createElement("div");
                            item.className = "glass-card";
                            item.style.padding = "0.75rem 1rem";
                            item.style.borderLeft = "3px solid var(--status-verified)";
                            item.innerHTML = `
                                <div style="display:flex; justify-content:space-between; align-items:center;">
                                    <strong>${st.name}</strong>
                                    <span class="status-badge badge-verified" style="font-size:0.7rem;">PRESENT</span>
                                </div>
                                <div style="font-size:0.78rem; color:var(--text-secondary); margin-top:0.2rem;">
                                    Roll: ${st.roll_number} • Match: ${st.confidence}% • ${new Date().toLocaleTimeString()}
                                </div>
                            `;

                            // Remove empty placeholder
                            if (tickerList.innerText.includes("entries will appear") || tickerList.innerText.includes("No students marked")) {
                                tickerList.innerHTML = "";
                            }
                            tickerList.prepend(item);

                            // Update count badge
                            if (countBadge) {
                                const currentCount = parseInt(countBadge.innerText) || 0;
                                countBadge.innerText = `${currentCount + 1} Marked`;
                            }
                        }
                    } else {
                        feedbackEl.innerHTML = `<span style="color:#f59e0b;"><i class="fa-solid fa-eye"></i> ${res.detail || "Scanning face... Ensure face is centered in the frame."}</span>`;
                    }
                } catch (err) {
                    console.error("Live attendance recognition error:", err);
                } finally {
                    isMatchingInProgress = false;
                }
            }, 750);

        } catch (err) {
            showToast(err.message, "error");
        }
    }

    async function quickStartTodaySession() {
        try {
            const subData = await api.getSubjects();
            const subjects = subData.subjects || [];
            const subId = subjects.length > 0 ? subjects[0].id : 1;
            const subCode = subjects.length > 0 ? subjects[0].code : "DBMS";
            const todayStr = new Date().toISOString().split('T')[0];
            const now = new Date();
            const startStr = now.toTimeString().slice(0, 5);
            const endHour = new Date(now.getTime() + 60*60*1000).toTimeString().slice(0, 5);

            const payload = {
                subject_id: subId,
                session_name: `${subCode} Regular Lecture`,
                date: todayStr,
                start_time: startStr,
                end_time: endHour,
                class_name: "TY-CSE",
                division: "A"
            };

            const res = await api.createSession(payload);
            showToast("Active lecture session started!", "success");
            renderAdminLiveAttendance(document.getElementById("app-viewport"));
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    function playRecognitionChime() {
        try {
            // Web Audio API synthesized positive chime sound
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
            osc.frequency.setValueAtTime(880, ctx.currentTime + 0.08); // A5
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.35);
        } catch (e) { }
    }

    function launchSessionScanner(sessionId) {
        navigate("/admin/live-attendance");
        setTimeout(() => {
            const select = document.getElementById("kiosk-session-select");
            if (select && sessionId) {
                select.value = sessionId;
                select.dispatchEvent(new Event("change"));
            }
        }, 300);
    }

    /* ==========================================================================
       VIEW: Admin Student Directory (/admin/students)
       ========================================================================== */
    async function renderAdminStudents(container) {
        container.innerHTML = `
            <div class="loading-state">
                <div class="scanner-spinner"></div>
                <p>Loading student directory...</p>
            </div>
        `;

        try {
            const data = await api.getStudents();
            const students = data.students || [];

            const rowsHtml = students.length > 0 ? students.map(s => `
                <tr>
                    <td><strong>${s.roll_number}</strong></td>
                    <td>
                        <strong>${s.name}</strong>
                        <div style="font-size:0.78rem; color:var(--text-muted);">${s.email}</div>
                    </td>
                    <td>${s.class_name} (${s.division})</td>
                    <td>${s.department}</td>
                    <td>
                        <span class="status-badge badge-${s.face_status}">
                            ${s.face_status.replace('_', ' ')}
                        </span>
                    </td>
                    <td>
                        <span class="status-badge badge-${s.account_status}">
                            ${s.account_status}
                        </span>
                    </td>
                    <td>
                        <div style="display:flex; gap:0.4rem;">
                            <button class="btn btn-sm btn-secondary" title="Toggle Status" onclick="app.toggleStudentStatus(${s.id}, '${s.account_status}')">
                                <i class="fa-solid fa-power-off"></i>
                            </button>
                            <button class="btn btn-sm btn-secondary" title="Reset Face Profile" onclick="app.resetStudentFaceProfile(${s.id})">
                                <i class="fa-solid fa-camera-rotate"></i>
                            </button>
                            <button class="btn btn-sm btn-danger" title="Delete Student" onclick="app.deleteStudentAccount(${s.id}, '${s.name.replace(/'/g, "\\'")}')">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `).join("") : `
                <tr>
                    <td colspan="7" style="text-align:center; color:var(--text-muted); padding:3rem;">No students found in registry.</td>
                </tr>
            `;

            container.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem; flex-wrap:wrap; gap:1rem;">
                    <div>
                        <h2>Student Directory (${students.length})</h2>
                        <p style="color:var(--text-secondary); font-size:0.92rem;">Manage enrolled student accounts, biometric states, and account authorizations.</p>
                    </div>
                    <div style="display:flex; gap:0.75rem; flex-wrap:wrap;">
                        <button class="btn btn-secondary btn-sm" onclick="app.navigate('/admin/dashboard')">
                            <i class="fa-solid fa-arrow-left"></i> Dashboard
                        </button>
                    </div>
                </div>

                <div class="glass-panel" style="padding:1.5rem;">
                    <div class="table-responsive">
                        <table class="custom-table">
                            <thead>
                                <tr>
                                    <th>Roll No</th>
                                    <th>Student</th>
                                    <th>Class</th>
                                    <th>Department</th>
                                    <th>Face Status</th>
                                    <th>Account Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rowsHtml}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    async function toggleStudentStatus(id, currentStatus) {
        const newStatus = currentStatus === "active" ? "disabled" : "active";
        try {
            const res = await api.updateStudentStatus(id, newStatus);
            showToast(res.message, "success");
            renderAdminStudents(document.getElementById("app-viewport"));
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    async function resetStudentFaceProfile(id) {
        if (!confirm("Are you sure you want to reset this student's biometric face registration? They will need to re-register their face.")) return;
        try {
            const res = await api.resetStudentFace(id);
            showToast(res.message, "info");
            renderAdminStudents(document.getElementById("app-viewport"));
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    async function deleteStudentAccount(id, name) {
        if (!confirm(`Are you sure you want to delete student account '${name}'? This action is permanent.`)) return;
        try {
            const res = await api.deleteStudent(id);
            showToast(res.message, "success");
            renderAdminStudents(document.getElementById("app-viewport"));
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    /* ==========================================================================
       VIEW: Admin Subjects (/admin/subjects) - Branch-Wise Curriculum Control
       ========================================================================== */
    const DEFAULT_BRANCH_OPTIONS = [
        "Computer Engineering",
        "Information Technology",
        "Electronics & Telecom",
        "Mechanical Engineering",
        "AI & Data Science",
        "Civil Engineering",
        "All Branches"
    ];

    function filterAdminSubjectsByBranch(branch) {
        adminSubjectBranchFilter = branch;
        const container = document.getElementById("app-viewport");
        if (container) renderAdminSubjects(container);
    }

    function promptAddNewBranch() {
        showModal(
            "Add New Engineering Branch / Department",
            `
                <div class="form-group">
                    <label class="form-label">Branch / Department Name</label>
                    <input type="text" id="modal-new-branch-name" class="form-control" placeholder="e.g. Aeronautical Engineering, Chemical Engineering" required>
                    <div class="form-hint" style="margin-top:0.4rem;">Once added, you can immediately schedule and assign curriculum subjects to this branch.</div>
                </div>
            `,
            `
                <button class="btn btn-secondary btn-sm" onclick="app.closeModal()">Cancel</button>
                <button class="btn btn-primary btn-sm" onclick="app.confirmAddNewBranch()"><i class="fa-solid fa-plus"></i> Create Branch</button>
            `
        );
    }

    function confirmAddNewBranch() {
        const branchName = document.getElementById("modal-new-branch-name").value.trim();
        if (!branchName) return showToast("Branch name is required.", "warning");

        closeModal();
        if (!window._customBranches) window._customBranches = [];
        if (!window._customBranches.includes(branchName)) {
            window._customBranches.push(branchName);
        }
        adminSubjectBranchFilter = branchName;
        showToast(`Branch '${branchName}' created! Now add its subjects.`, "success");
        
        const container = document.getElementById("app-viewport");
        if (container) renderAdminSubjects(container);

        // Immediately open Add Subject for this new branch
        setTimeout(() => {
            promptAddSubject(branchName);
        }, 200);
    }

    async function renderAdminSubjects(container) {
        container.innerHTML = `
            <div class="loading-state">
                <div class="scanner-spinner"></div>
                <p>Loading curriculum subjects and branch matrix...</p>
            </div>
        `;

        try {
            const data = await api.getSubjects();
            const allSubjects = data.subjects || [];
            window._allAdminSubjects = allSubjects;

            // Merge default branches, existing subjects' branches, and custom branches
            const customBranches = window._customBranches || [];
            const existingDepts = allSubjects.map(s => s.department).filter(Boolean);
            const activeBranches = Array.from(new Set([...DEFAULT_BRANCH_OPTIONS, ...existingDepts, ...customBranches]));

            // Calculate counts per branch
            const branchCounts = { "All": allSubjects.length };
            activeBranches.forEach(b => { branchCounts[b] = 0; });
            allSubjects.forEach(s => {
                const dept = (s.department || "").trim();
                let matched = false;
                for (const b of activeBranches) {
                    if (b.toLowerCase() === dept.toLowerCase() || (b === "All Branches" && (dept.toLowerCase().includes("all") || dept.toLowerCase().includes("common")))) {
                        branchCounts[b] = (branchCounts[b] || 0) + 1;
                        matched = true;
                        break;
                    }
                }
                if (!matched && dept) {
                    branchCounts[dept] = (branchCounts[dept] || 0) + 1;
                }
            });

            // Filter subjects by selected branch
            let filteredSubjects = allSubjects;
            if (adminSubjectBranchFilter && adminSubjectBranchFilter !== "All") {
                if (adminSubjectBranchFilter === "All Branches") {
                    filteredSubjects = allSubjects.filter(s => {
                        const d = (s.department || "").toLowerCase();
                        return d.includes("all") || d.includes("common") || d === "";
                    });
                } else {
                    filteredSubjects = allSubjects.filter(s => 
                        (s.department || "").toLowerCase() === adminSubjectBranchFilter.toLowerCase()
                    );
                }
            }

            const currentBranchName = adminSubjectBranchFilter === "All" ? "Curriculum" : adminSubjectBranchFilter;

            const rowsHtml = filteredSubjects.length > 0 ? filteredSubjects.map(s => {
                const safeName = (s.name || '').replace(/'/g, "\\'");
                const safeCode = (s.code || '').replace(/'/g, "\\'");
                return `
                <tr>
                    <td><strong style="font-family:var(--font-heading); color:var(--brand-primary); font-size:1rem;">${s.code}</strong></td>
                    <td><span style="font-weight:600; color:var(--text-primary);">${s.name}</span></td>
                    <td>${getDeptBadge(s.department)}</td>
                    <td><span style="font-size:0.85rem; color:var(--text-secondary); background:rgba(255,255,255,0.05); padding:0.2rem 0.55rem; border-radius:4px;">Semester ${s.semester}</span></td>
                    <td>
                        <div style="display:flex; gap:0.4rem; align-items:center;">
                            <button class="btn btn-sm btn-secondary" title="Edit Subject Details" onclick="app.promptEditSubject(${s.id})">
                                <i class="fa-solid fa-pen-to-square"></i> Edit
                            </button>
                            <button class="btn btn-sm btn-danger" title="Remove Subject" onclick="app.deleteSubjectItem(${s.id}, '${safeCode}')">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `}).join("") : `
                <tr>
                    <td colspan="5" style="text-align:center; padding:3.5rem 1.5rem; color:var(--text-muted);">
                        <i class="fa-solid fa-folder-open" style="font-size:2.8rem; color:var(--brand-primary); margin-bottom:1rem; opacity:0.5;"></i>
                        <h4 style="color:var(--text-primary); margin-bottom:0.4rem;">No subjects added to ${currentBranchName} yet</h4>
                        <p style="font-size:0.88rem; max-width:440px; margin:0 auto 1.25rem;">As Administrator, you have full control to assign and create curriculum subjects for this branch.</p>
                        <button class="btn btn-primary btn-sm" onclick="app.promptAddSubject('${adminSubjectBranchFilter !== 'All' ? adminSubjectBranchFilter : 'Computer Engineering'}')">
                            <i class="fa-solid fa-plus"></i> Add Subject to ${currentBranchName}
                        </button>
                    </td>
                </tr>
            `;

            // Build branch filter pills dynamically
            const branchPillsHtml = [
                `<button class="branch-filter-pill ${adminSubjectBranchFilter === 'All' ? 'active' : ''}" onclick="app.filterAdminSubjectsByBranch('All')">
                    <i class="fa-solid fa-layer-group"></i> All Branches (${allSubjects.length})
                </button>`,
                ...activeBranches.filter(b => b !== "All Branches").map(b => `
                    <button class="branch-filter-pill ${adminSubjectBranchFilter === b ? 'active' : ''}" onclick="app.filterAdminSubjectsByBranch('${b}')">
                        ${getDeptBadge(b)} (${branchCounts[b] || 0})
                    </button>
                `),
                `<button class="branch-filter-pill ${adminSubjectBranchFilter === 'All Branches' ? 'active' : ''}" onclick="app.filterAdminSubjectsByBranch('All Branches')">
                    <i class="fa-solid fa-globe"></i> Common Curriculum (${branchCounts['All Branches'] || 0})
                </button>`,
                `<button class="branch-filter-pill" style="border-style:dashed; color:var(--brand-primary); border-color:rgba(56,189,248,0.4);" onclick="app.promptAddNewBranch()">
                    <i class="fa-solid fa-plus"></i> New Branch
                </button>`
            ].join("");

            container.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem; flex-wrap:wrap; gap:1rem;">
                    <div>
                        <h2>Branch Curriculum Manager</h2>
                        <p style="color:var(--text-secondary); font-size:0.92rem;">Empowers you as Administrator to assign, organize, and schedule curriculum subjects branch by branch.</p>
                    </div>
                    <div style="display:flex; gap:0.75rem; flex-wrap:wrap;">
                        <button class="btn btn-outline btn-sm" onclick="app.promptAddNewBranch()">
                            <i class="fa-solid fa-folder-plus"></i> New Branch
                        </button>
                        <button class="btn btn-primary btn-sm" onclick="app.promptAddSubject('${adminSubjectBranchFilter !== 'All' ? adminSubjectBranchFilter : 'Computer Engineering'}')">
                            <i class="fa-solid fa-plus"></i> Add Subject to ${currentBranchName}
                        </button>
                    </div>
                </div>

                <!-- Branch Filter Tab Navigation -->
                <div class="branch-filter-nav">
                    ${branchPillsHtml}
                </div>

                <div class="glass-panel" style="padding:1.5rem;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:0.5rem;">
                        <div style="font-size:0.9rem; color:var(--text-secondary);">
                            Showing subjects for: <strong style="color:var(--text-primary);">${currentBranchName}</strong> (${filteredSubjects.length} subjects found)
                        </div>
                        <button class="btn btn-secondary btn-sm" onclick="app.promptAddSubject('${adminSubjectBranchFilter !== 'All' ? adminSubjectBranchFilter : 'Computer Engineering'}')">
                            <i class="fa-solid fa-plus"></i> Add Subject to ${currentBranchName}
                        </button>
                    </div>

                    <div class="table-responsive">
                        <table class="custom-table">
                            <thead>
                                <tr>
                                    <th>Subject Code</th>
                                    <th>Subject Title</th>
                                    <th>Branch / Department</th>
                                    <th>Semester</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rowsHtml}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    function promptAddSubject(preferredBranch) {
        const customBranches = window._customBranches || [];
        const existingDepts = (window._allAdminSubjects || []).map(s => s.department).filter(Boolean);
        const branchList = Array.from(new Set([...DEFAULT_BRANCH_OPTIONS, ...existingDepts, ...customBranches]));

        const defaultBranch = preferredBranch || (adminSubjectBranchFilter && adminSubjectBranchFilter !== "All" ? adminSubjectBranchFilter : "Computer Engineering");
        
        const branchOptionsHtml = branchList.map(b => 
            `<option value="${b}" ${b.toLowerCase() === defaultBranch.toLowerCase() ? 'selected' : ''}>${b}</option>`
        ).join("");

        showModal(
            `Add Subject to ${defaultBranch === 'All Branches' ? 'Common Curriculum' : defaultBranch}`,
            `
                <div class="form-group">
                    <label class="form-label">Subject Code (e.g. IT501, CS302, ME504)</label>
                    <input type="text" id="modal-sub-code" class="form-control" placeholder="e.g. IT501" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Subject Title</label>
                    <input type="text" id="modal-sub-name" class="form-control" placeholder="e.g. Cloud Computing & DevOps" required>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Assign to Branch / Department</label>
                        <select id="modal-sub-dept" class="form-control" required>
                            ${branchOptionsHtml}
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Semester</label>
                        <select id="modal-sub-sem" class="form-control" required>
                            ${[1,2,3,4,5,6,7,8].map(s => `<option value="${s}" ${s === 5 ? 'selected' : ''}>Semester ${s}</option>`).join("")}
                        </select>
                    </div>
                </div>
            `,
            `
                <button class="btn btn-secondary btn-sm" onclick="app.closeModal()">Cancel</button>
                <button class="btn btn-primary btn-sm" onclick="app.confirmAddSubject()"><i class="fa-solid fa-save"></i> Save Subject</button>
            `
        );
    }

    async function confirmAddSubject() {
        const code = document.getElementById("modal-sub-code").value.trim();
        const name = document.getElementById("modal-sub-name").value.trim();
        const dept = document.getElementById("modal-sub-dept").value.trim();
        const sem = parseInt(document.getElementById("modal-sub-sem").value) || 1;

        if (!code || !name) return showToast("Subject Code and Title are required.", "warning");

        closeModal();
        try {
            const res = await api.createSubject({ code, name, department: dept, semester: sem });
            showToast(res.message, "success");
            // Set current filter to this branch so admin immediately sees their newly created subject
            adminSubjectBranchFilter = dept;
            renderAdminSubjects(document.getElementById("app-viewport"));
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    function promptEditSubject(id) {
        const subjects = window._allAdminSubjects || [];
        const sub = subjects.find(s => s.id === id);
        if (!sub) return showToast("Subject details could not be found.", "error");

        const customBranches = window._customBranches || [];
        const existingDepts = subjects.map(s => s.department).filter(Boolean);
        const branchList = Array.from(new Set([...DEFAULT_BRANCH_OPTIONS, ...existingDepts, ...customBranches]));

        const branchOptionsHtml = branchList.map(b => 
            `<option value="${b}" ${b.toLowerCase() === (sub.department || '').toLowerCase() ? 'selected' : ''}>${b}</option>`
        ).join("");

        showModal(
            `Edit Subject: ${sub.code}`,
            `
                <div class="form-group">
                    <label class="form-label">Subject Code</label>
                    <input type="text" id="modal-edit-sub-code" class="form-control" value="${sub.code}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Subject Title</label>
                    <input type="text" id="modal-edit-sub-name" class="form-control" value="${sub.name}" required>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Branch / Department</label>
                        <select id="modal-edit-sub-dept" class="form-control" required>
                            ${branchOptionsHtml}
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Semester</label>
                        <select id="modal-edit-sub-sem" class="form-control" required>
                            ${[1,2,3,4,5,6,7,8].map(s => `<option value="${s}" ${s === sub.semester ? 'selected' : ''}>Semester ${s}</option>`).join("")}
                        </select>
                    </div>
                </div>
            `,
            `
                <button class="btn btn-secondary btn-sm" onclick="app.closeModal()">Cancel</button>
                <button class="btn btn-primary btn-sm" onclick="app.confirmEditSubject(${id})"><i class="fa-solid fa-check"></i> Update Subject</button>
            `
        );
    }

    async function confirmEditSubject(id) {
        const code = document.getElementById("modal-edit-sub-code").value.trim();
        const name = document.getElementById("modal-edit-sub-name").value.trim();
        const dept = document.getElementById("modal-edit-sub-dept").value.trim();
        const sem = parseInt(document.getElementById("modal-edit-sub-sem").value) || 1;

        if (!code || !name) return showToast("Subject Code and Title are required.", "warning");

        closeModal();
        try {
            const res = await api.updateSubject(id, { code, name, department: dept, semester: sem });
            showToast(res.message, "success");
            renderAdminSubjects(document.getElementById("app-viewport"));
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    async function deleteSubjectItem(id, code = "") {
        if (!confirm(`Are you sure you want to remove subject ${code || id}?`)) return;
        try {
            const res = await api.deleteSubject(id);
            showToast(res.message, "info");
            renderAdminSubjects(document.getElementById("app-viewport"));
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    /* ==========================================================================
       VIEW: Admin Sessions (/admin/sessions)
       ========================================================================== */
    async function renderAdminSessions(container) {
        container.innerHTML = `
            <div class="loading-state">
                <div class="scanner-spinner"></div>
                <p>Loading attendance sessions...</p>
            </div>
        `;

        try {
            const [sessData, subData] = await Promise.all([api.getSessions(), api.getSubjects()]);
            const sessions = sessData.sessions || [];
            const subjects = subData.subjects || [];
            const hasClosedSessions = sessions.some(s => s.status === 'closed');

            const rowsHtml = sessions.length > 0 ? sessions.map(s => {
                const safeName = (s.session_name || 'Lecture').replace(/'/g, "\\'");
                const activeCnt = s.active_attendance_count !== undefined ? s.active_attendance_count : s.attendance_count;
                return `
                <tr>
                    <td><strong>${s.subject_code}</strong> (${s.subject_name})</td>
                    <td><strong>${s.session_name}</strong></td>
                    <td>${s.date}</td>
                    <td>${s.start_time} - ${s.end_time}</td>
                    <td>${s.class_name} (${s.division})</td>
                    <td><span class="status-badge ${s.status === 'active' ? 'badge-verified' : 'badge-disabled'}">${s.status}</span></td>
                    <td>
                        <strong style="font-family:var(--font-mono); color:var(--status-verified);">${activeCnt} Active</strong>
                        <span style="font-size:0.75rem; color:var(--text-muted);">(${s.attendance_count} tot)</span>
                    </td>
                    <td>
                        <div style="display:flex; gap:0.35rem; align-items:center; flex-wrap:nowrap;">
                            ${s.status === 'active' ? `
                                <button class="btn btn-primary btn-sm" title="Launch Live Scanner" onclick="app.launchSessionScanner(${s.id})">
                                    <i class="fa-solid fa-camera"></i>
                                </button>
                                <button class="btn btn-secondary btn-sm" title="View Active Student Data" onclick="app.viewSessionData(${s.id})">
                                    <i class="fa-solid fa-eye"></i>
                                </button>
                                <button class="btn btn-secondary btn-sm" style="color:#f59e0b;" title="Reset Active Session Attendance" onclick="app.handleResetSession(${s.id}, '${safeName}')">
                                    <i class="fa-solid fa-rotate-left"></i>
                                </button>
                                <button class="btn btn-secondary btn-sm" title="End / Close Session" onclick="app.handleCloseSession(${s.id})">
                                    <i class="fa-solid fa-lock"></i>
                                </button>
                                <button class="btn btn-danger btn-sm" title="Remove / Delete Session" onclick="app.handleDeleteSession(${s.id}, '${safeName}')">
                                    <i class="fa-solid fa-trash"></i>
                                </button>
                            ` : `
                                <button class="btn btn-primary btn-sm" title="Get Data of Active People" onclick="app.viewSessionData(${s.id})">
                                    <i class="fa-solid fa-chart-pie"></i> Get Data
                                </button>
                                <button class="btn btn-secondary btn-sm" title="Download Active Students CSV" onclick="app.exportSessionActiveCsv(${s.id})">
                                    <i class="fa-solid fa-file-csv"></i>
                                </button>
                                <button class="btn btn-secondary btn-sm" title="Re-open Session" onclick="app.handleReopenSession(${s.id})">
                                    <i class="fa-solid fa-lock-open"></i>
                                </button>
                                <button class="btn btn-secondary btn-sm" style="color:#f59e0b;" title="Reset Attendance Records" onclick="app.handleResetSession(${s.id}, '${safeName}')">
                                    <i class="fa-solid fa-rotate-left"></i>
                                </button>
                                <button class="btn btn-danger btn-sm" title="Remove / Delete Session" onclick="app.handleDeleteSession(${s.id}, '${safeName}')">
                                    <i class="fa-solid fa-trash"></i>
                                </button>
                            `}
                        </div>
                    </td>
                </tr>
            `}).join("") : `
                <tr>
                    <td colspan="8" style="text-align:center; color:var(--text-muted); padding:3rem;">No sessions created yet.</td>
                </tr>
            `;

            container.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem; flex-wrap:wrap; gap:1rem;">
                    <div>
                        <h2>Attendance Sessions</h2>
                        <p style="color:var(--text-secondary); font-size:0.92rem;">Create, reset, or remove lecture sessions and retrieve active student data from closed sessions.</p>
                    </div>
                    <div style="display:flex; gap:0.75rem; flex-wrap:wrap;">
                        ${hasClosedSessions ? `
                            <button class="btn btn-outline btn-sm" onclick="app.handleCleanupClosedSessions()" title="Remove all closed sessions" style="color:#ef4444; border-color:rgba(239,68,68,0.4);">
                                <i class="fa-solid fa-broom"></i> Clean Up Closed Sessions
                            </button>
                        ` : ''}
                        <button class="btn btn-primary btn-sm" onclick="app.promptCreateSession()">
                            <i class="fa-solid fa-plus"></i> Start New Lecture Session
                        </button>
                    </div>
                </div>

                <div class="glass-panel" style="padding:1.5rem;">
                    <div class="table-responsive">
                        <table class="custom-table">
                            <thead>
                                <tr>
                                    <th>Subject</th>
                                    <th>Session Name</th>
                                    <th>Date</th>
                                    <th>Time Slot</th>
                                    <th>Class / Div</th>
                                    <th>Status</th>
                                    <th>Attended</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rowsHtml}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;

            window._availableSubjects = subjects;
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    async function promptCreateSession() {
        if (!window._availableSubjects || window._availableSubjects.length === 0) {
            try {
                const subData = await api.getSubjects();
                window._availableSubjects = subData.subjects || [];
            } catch (e) {}
        }
        const subjects = window._availableSubjects || [];
        const todayStr = new Date().toISOString().split('T')[0];

        showModal(
            "Start Lecture Attendance Session",
            `
                <div class="form-group">
                    <label class="form-label">Subject</label>
                    <select id="modal-ses-subject" class="form-control">
                        ${subjects.length > 0 ? subjects.map(s => `<option value="${s.id}">[${s.department}] ${s.code} — ${s.name}</option>`).join("") : `<option value="1">DBMS — Database Management Systems</option>`}
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Session / Lecture Name</label>
                    <input type="text" id="modal-ses-name" class="form-control" value="Regular Lecture" required>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Date</label>
                        <input type="date" id="modal-ses-date" class="form-control" value="${todayStr}" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Start Time</label>
                        <input type="time" id="modal-ses-start" class="form-control" value="10:00" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">End Time</label>
                        <input type="time" id="modal-ses-end" class="form-control" value="11:00" required>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Class</label>
                        <input type="text" id="modal-ses-class" class="form-control" value="TY-CSE" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Division</label>
                        <input type="text" id="modal-ses-div" class="form-control" value="A" required>
                    </div>
                </div>
            `,
            `
                <button class="btn btn-secondary btn-sm" onclick="app.closeModal()">Cancel</button>
                <button class="btn btn-primary btn-sm" onclick="app.confirmCreateSession()">Create & Open</button>
            `
        );
    }

    async function confirmCreateSession() {
        const payload = {
            subject_id: parseInt(document.getElementById("modal-ses-subject").value),
            session_name: document.getElementById("modal-ses-name").value.trim(),
            date: document.getElementById("modal-ses-date").value,
            start_time: document.getElementById("modal-ses-start").value,
            end_time: document.getElementById("modal-ses-end").value,
            class_name: document.getElementById("modal-ses-class").value.trim(),
            division: document.getElementById("modal-ses-div").value.trim()
        };

        closeModal();
        try {
            const res = await api.createSession(payload);
            showToast(res.message, "success");
            if (currentRoute === "/admin/live-attendance") {
                renderAdminLiveAttendance(document.getElementById("app-viewport"));
            } else {
                renderAdminSessions(document.getElementById("app-viewport"));
            }
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    async function handleCloseSession(id) {
        try {
            const res = await api.closeSession(id);
            showToast(res.message, "info");
            renderAdminSessions(document.getElementById("app-viewport"));
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    async function handleReopenSession(id) {
        try {
            const res = await api.reopenSession(id);
            showToast(res.message, "success");
            renderAdminSessions(document.getElementById("app-viewport"));
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    async function handleResetSession(id, sessionName) {
        if (!confirm(`Are you sure you want to reset attendance for session '${sessionName || 'this session'}'? This will clear all attendance records and allow attendance to be re-taken.`)) return;
        try {
            const res = await api.resetSession(id);
            showToast(res.message, "info");
            if (currentRoute === "/admin/live-attendance") {
                renderAdminLiveAttendance(document.getElementById("app-viewport"));
            } else {
                renderAdminSessions(document.getElementById("app-viewport"));
            }
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    async function handleDeleteSession(id, sessionName) {
        if (!confirm(`Are you sure you want to permanently remove session '${sessionName || 'this session'}' and all its attendance records? This action cannot be undone.`)) return;
        try {
            const res = await api.deleteSession(id);
            showToast(res.message, "success");
            if (currentRoute === "/admin/live-attendance") {
                renderAdminLiveAttendance(document.getElementById("app-viewport"));
            } else {
                renderAdminSessions(document.getElementById("app-viewport"));
            }
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    async function handleCleanupClosedSessions() {
        if (!confirm("Are you sure you want to permanently delete all closed attendance sessions and their records?")) return;
        try {
            const res = await api.cleanupClosedSessions();
            showToast(res.message, "success");
            renderAdminSessions(document.getElementById("app-viewport"));
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    async function handleCloseCurrentScannerSession() {
        const select = document.getElementById("kiosk-session-select");
        if (!select || !select.value) {
            return showToast("No active lecture session selected to close.", "warning");
        }
        try {
            const res = await api.closeSession(parseInt(select.value));
            showToast(res.message, "info");
            renderAdminLiveAttendance(document.getElementById("app-viewport"));
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    async function handleResetCurrentScannerSession() {
        const select = document.getElementById("kiosk-session-select");
        if (!select || !select.value) {
            return showToast("No active lecture session selected to reset.", "warning");
        }
        const sessId = parseInt(select.value);
        if (!confirm("Are you sure you want to reset this active session? All marked attendance records for this session will be cleared and reset to 0.")) return;
        try {
            const res = await api.resetSession(sessId);
            showToast(res.message, "info");
            const tickerList = document.getElementById("kiosk-ticker-list");
            const countBadge = document.getElementById("kiosk-attendance-count-badge");
            if (tickerList) tickerList.innerHTML = `<div style="text-align:center; padding:3rem 1rem; color:var(--text-muted); font-size:0.88rem;">Session reset. Ready to scan attendance.</div>`;
            if (countBadge) countBadge.innerText = "0 Marked";
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    async function handleDeleteCurrentScannerSession() {
        const select = document.getElementById("kiosk-session-select");
        if (!select || !select.value) {
            return showToast("No active lecture session selected to delete.", "warning");
        }
        const sessId = parseInt(select.value);
        if (!confirm("Are you sure you want to remove this attendance session? All records will be permanently deleted.")) return;
        try {
            const res = await api.deleteSession(sessId);
            showToast(res.message, "success");
            renderAdminLiveAttendance(document.getElementById("app-viewport"));
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    async function viewCurrentScannerSessionData() {
        const select = document.getElementById("kiosk-session-select");
        if (!select || !select.value) {
            return showToast("No active session selected.", "warning");
        }
        viewSessionData(parseInt(select.value));
    }

    function exportSessionActiveCsv(sessionId) {
        window.open(`/api/attendance/export/csv?session_id=${sessionId}&account_status=active`, "_blank");
    }

    /* ==========================================================================
       VIEW: Session Data & Active Attendees Modal
       ========================================================================== */
    async function viewSessionData(sessionId) {
        showModal(
            "Session Attendee Data",
            `
                <div class="loading-state" style="padding:2rem;">
                    <div class="scanner-spinner"></div>
                    <p>Loading session data...</p>
                </div>
            `,
            `<button class="btn btn-secondary btn-sm" onclick="app.closeModal()">Close</button>`,
            "900px"
        );

        try {
            const res = await api.getSessionAttendees(sessionId);
            const ses = res.session;
            const metrics = res.metrics;
            const records = res.records || [];
            const safeName = (ses.session_name || 'Session').replace(/'/g, "\\'");

            const renderTable = (filterStatus = "active", searchQuery = "") => {
                let filtered = records;
                if (filterStatus === "active") {
                    filtered = filtered.filter(r => (r.student_account_status || 'active') === 'active');
                } else if (filterStatus === "disabled") {
                    filtered = filtered.filter(r => (r.student_account_status || 'active') === 'disabled');
                }

                if (searchQuery.trim()) {
                    const q = searchQuery.toLowerCase().trim();
                    filtered = filtered.filter(r => 
                        (r.student_name && r.student_name.toLowerCase().includes(q)) ||
                        (r.roll_number && r.roll_number.toLowerCase().includes(q)) ||
                        (r.student_email && r.student_email.toLowerCase().includes(q))
                    );
                }

                if (filtered.length === 0) {
                    return `<tr><td colspan="7" style="text-align:center; padding:2.5rem; color:var(--text-muted);">No attendance entries match the current filter.</td></tr>`;
                }

                return filtered.map(r => `
                    <tr>
                        <td><strong>${r.roll_number}</strong></td>
                        <td>
                            <strong>${r.student_name}</strong>
                            <div style="font-size:0.75rem; color:var(--text-muted);">${r.student_email || ''}</div>
                        </td>
                        <td>${r.class_name} (${r.division})</td>
                        <td>
                            <span class="status-badge ${r.student_account_status === 'active' ? 'badge-verified' : 'badge-disabled'}">
                                ${r.student_account_status || 'active'}
                            </span>
                        </td>
                        <td>${r.attendance_time}</td>
                        <td><span style="font-family:var(--font-mono); color:var(--brand-primary);">${r.recognition_confidence}%</span></td>
                        <td><span class="status-badge badge-verified">PRESENT</span></td>
                    </tr>
                `).join("");
            };

            const bodyHtml = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1.25rem; flex-wrap:wrap; gap:1rem;">
                    <div>
                        <div style="font-size:1.15rem; font-weight:700; color:var(--text-primary); margin-bottom:0.2rem;">
                            ${ses.subject_code} — ${ses.session_name}
                        </div>
                        <div style="font-size:0.85rem; color:var(--text-secondary);">
                            ${ses.subject_name} • ${ses.class_name} (${ses.division}) • ${ses.date} (${ses.start_time} - ${ses.end_time})
                        </div>
                    </div>
                    <span class="status-badge ${ses.status === 'active' ? 'badge-verified' : 'badge-disabled'}" style="font-size:0.85rem; padding:0.3rem 0.8rem;">
                        ${ses.status.toUpperCase()} SESSION
                    </span>
                </div>

                <!-- Metric stats cards -->
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:0.75rem; margin-bottom:1.25rem;">
                    <div class="glass-card" style="padding:0.75rem 1rem; border-left:3px solid var(--status-verified);">
                        <div style="font-size:0.75rem; color:var(--text-secondary); text-transform:uppercase;">Active Students</div>
                        <div style="font-size:1.4rem; font-weight:800; color:var(--status-verified);">${metrics.active_attendees}</div>
                    </div>
                    <div class="glass-card" style="padding:0.75rem 1rem; border-left:3px solid var(--brand-primary);">
                        <div style="font-size:0.75rem; color:var(--text-secondary); text-transform:uppercase;">Total Present</div>
                        <div style="font-size:1.4rem; font-weight:800; color:var(--brand-primary);">${metrics.total_attendees}</div>
                    </div>
                    <div class="glass-card" style="padding:0.75rem 1rem; border-left:3px solid #94a3b8;">
                        <div style="font-size:0.75rem; color:var(--text-secondary); text-transform:uppercase;">Disabled Accounts</div>
                        <div style="font-size:1.4rem; font-weight:800; color:var(--text-secondary);">${metrics.disabled_attendees}</div>
                    </div>
                </div>

                <!-- Filter and Action Bar -->
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem; margin-bottom:1rem; background:rgba(15,23,42,0.6); padding:0.75rem 1rem; border-radius:var(--radius-md); border:1px solid var(--border-subtle);">
                    <div style="display:flex; gap:0.5rem; align-items:center;">
                        <button id="filter-btn-active" class="btn btn-sm btn-primary" style="font-size:0.78rem;">
                            <i class="fa-solid fa-user-check"></i> Active Students (${metrics.active_attendees})
                        </button>
                        <button id="filter-btn-all" class="btn btn-sm btn-secondary" style="font-size:0.78rem;">
                            <i class="fa-solid fa-users"></i> All (${metrics.total_attendees})
                        </button>
                    </div>
                    <div style="display:flex; gap:0.5rem; align-items:center;">
                        <input type="text" id="session-modal-search" class="form-control" placeholder="Search student or roll..." style="font-size:0.8rem; padding:0.35rem 0.75rem; width:180px;">
                        <a href="/api/attendance/export/csv?session_id=${sessionId}&account_status=active" target="_blank" class="btn btn-success btn-sm" title="Download active students CSV">
                            <i class="fa-solid fa-download"></i> Active CSV
                        </a>
                        <a href="/api/attendance/export/csv?session_id=${sessionId}" target="_blank" class="btn btn-secondary btn-sm" title="Download all attendance CSV">
                            <i class="fa-solid fa-file-csv"></i> All CSV
                        </a>
                    </div>
                </div>

                <!-- Attendees Table -->
                <div class="table-responsive" style="max-height:340px; overflow-y:auto;">
                    <table class="custom-table" style="font-size:0.85rem;">
                        <thead>
                            <tr>
                                <th>Roll No</th>
                                <th>Student</th>
                                <th>Class</th>
                                <th>Account</th>
                                <th>Time</th>
                                <th>Confidence</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody id="session-modal-table-body">
                            ${renderTable("active", "")}
                        </tbody>
                    </table>
                </div>
            `;

            const footerHtml = `
                <div style="display:flex; justify-content:space-between; width:100%; align-items:center; flex-wrap:wrap; gap:0.5rem;">
                    <div style="display:flex; gap:0.5rem;">
                        <button class="btn btn-danger btn-sm" onclick="app.closeModal(); app.handleDeleteSession(${sessionId}, '${safeName}');">
                            <i class="fa-solid fa-trash"></i> Remove Session
                        </button>
                        <button class="btn btn-warning btn-sm" onclick="app.closeModal(); app.handleResetSession(${sessionId}, '${safeName}');">
                            <i class="fa-solid fa-rotate-left"></i> Reset Attendance
                        </button>
                    </div>
                    <button class="btn btn-secondary btn-sm" onclick="app.closeModal()">Close</button>
                </div>
            `;

            showModal(`Session Data — ${ses.session_name}`, bodyHtml, footerHtml, "900px");

            // Attach interactive listeners for the modal
            let currentFilter = "active";
            const tableBody = document.getElementById("session-modal-table-body");
            const searchInput = document.getElementById("session-modal-search");
            const btnActive = document.getElementById("filter-btn-active");
            const btnAll = document.getElementById("filter-btn-all");

            const updateView = () => {
                if (tableBody) {
                    tableBody.innerHTML = renderTable(currentFilter, searchInput ? searchInput.value : "");
                }
            };

            if (btnActive && btnAll) {
                btnActive.addEventListener("click", () => {
                    currentFilter = "active";
                    btnActive.className = "btn btn-sm btn-primary";
                    btnAll.className = "btn btn-sm btn-secondary";
                    updateView();
                });
                btnAll.addEventListener("click", () => {
                    currentFilter = "all";
                    btnAll.className = "btn btn-sm btn-primary";
                    btnActive.className = "btn btn-sm btn-secondary";
                    updateView();
                });
            }

            if (searchInput) {
                searchInput.addEventListener("input", updateView);
            }

        } catch (err) {
            showModal("Error", `<p style="color:#ef4444;">${err.message}</p>`, `<button class="btn btn-secondary btn-sm" onclick="app.closeModal()">Close</button>`);
        }
    }

    /* ==========================================================================
       VIEW: Admin Reports (/admin/reports)
       ========================================================================== */
    async function renderAdminReports(container) {
        container.innerHTML = `
            <div class="loading-state">
                <div class="scanner-spinner"></div>
                <p>Generating reports & analytics...</p>
            </div>
        `;

        try {
            const [subData, sessData, recData] = await Promise.all([
                api.getSubjects(),
                api.getSessions(),
                api.getAttendanceRecords()
            ]);

            const subjects = subData.subjects || [];
            const sessions = sessData.sessions || [];
            const records = recData.records || [];

            container.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem; flex-wrap:wrap; gap:1rem;">
                    <div>
                        <h2>Attendance Reports & Export</h2>
                        <p style="color:var(--text-secondary); font-size:0.92rem;">Audit and download class attendance records by subject, session (active or closed), and student status.</p>
                    </div>
                    <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                        <a id="btn-export-active-csv" href="/api/attendance/export/csv?account_status=active" target="_blank" class="btn btn-success btn-sm">
                            <i class="fa-solid fa-file-arrow-down"></i> Export Active Students CSV
                        </a>
                        <a id="btn-export-full-csv" href="/api/attendance/export/csv" target="_blank" class="btn btn-secondary btn-sm">
                            <i class="fa-solid fa-file-csv"></i> Export Full CSV
                        </a>
                    </div>
                </div>

                <!-- Filters -->
                <div class="glass-panel" style="padding:1.25rem; margin-bottom:1.5rem;">
                    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:1rem; align-items:flex-end;">
                        <div class="form-group" style="margin:0;">
                            <label class="form-label">Subject</label>
                            <select id="report-filter-subject" class="form-control">
                                <option value="">-- All Subjects --</option>
                                ${subjects.map(s => `<option value="${s.id}">${s.code} - ${s.name}</option>`).join("")}
                            </select>
                        </div>
                        <div class="form-group" style="margin:0;">
                            <label class="form-label">Session</label>
                            <select id="report-filter-session" class="form-control">
                                <option value="">-- All Sessions --</option>
                                ${sessions.map(s => `<option value="${s.id}">${s.subject_code} - ${s.session_name} (${s.date}) [${s.status.toUpperCase()}]</option>`).join("")}
                            </select>
                        </div>
                        <div class="form-group" style="margin:0;">
                            <label class="form-label">Account Status</label>
                            <select id="report-filter-account-status" class="form-control">
                                <option value="">-- All Accounts --</option>
                                <option value="active" selected>Active Students Only</option>
                                <option value="disabled">Disabled Accounts Only</option>
                            </select>
                        </div>
                        <div class="form-group" style="margin:0;">
                            <label class="form-label">Date</label>
                            <input type="date" id="report-filter-date" class="form-control">
                        </div>
                        <button class="btn btn-primary" id="btn-apply-report-filter" style="height:42px;">
                            <i class="fa-solid fa-filter"></i> Apply Filter
                        </button>
                    </div>
                </div>

                <!-- Records Table -->
                <div class="glass-panel" style="padding:1.5rem;">
                    <div class="table-responsive">
                        <table class="custom-table" id="report-table">
                            <thead>
                                <tr>
                                    <th>Date & Time</th>
                                    <th>Student</th>
                                    <th>Roll Number</th>
                                    <th>Class / Div</th>
                                    <th>Account</th>
                                    <th>Subject & Session</th>
                                    <th>AI Confidence</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody id="report-table-body">
                                ${records.length > 0 ? records.map(r => `
                                    <tr>
                                        <td>${r.attendance_date} <span style="font-size:0.8rem; color:var(--text-muted);">${r.attendance_time}</span></td>
                                        <td>
                                            <strong>${r.student_name}</strong>
                                            <div style="font-size:0.75rem; color:var(--text-muted);">${r.student_email || ''}</div>
                                        </td>
                                        <td><code style="color:var(--brand-primary);">${r.roll_number}</code></td>
                                        <td>${r.class_name} (${r.division})</td>
                                        <td>
                                            <span class="status-badge ${r.student_account_status === 'active' ? 'badge-verified' : 'badge-disabled'}">
                                                ${r.student_account_status || 'active'}
                                            </span>
                                        </td>
                                        <td><strong>${r.subject_code}</strong> <span style="font-size:0.8rem; color:var(--text-secondary);">(${r.session_name || 'Regular'})</span></td>
                                        <td>${r.recognition_confidence}% (Liveness: ${r.liveness_score})</td>
                                        <td><span class="status-badge badge-verified">PRESENT</span></td>
                                    </tr>
                                `).join("") : `
                                    <tr>
                                        <td colspan="8" style="text-align:center; color:var(--text-muted); padding:3rem;">No attendance records found.</td>
                                    </tr>
                                `}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;

            const updateExportUrls = () => {
                const subId = document.getElementById("report-filter-subject").value;
                const sessId = document.getElementById("report-filter-session").value;
                const accStatus = document.getElementById("report-filter-account-status").value;
                const dt = document.getElementById("report-filter-date").value;

                const params = new URLSearchParams();
                if (subId) params.append("subject_id", subId);
                if (sessId) params.append("session_id", sessId);
                if (dt) {
                    params.append("date_from", dt);
                    params.append("date_to", dt);
                }

                const fullParams = new URLSearchParams(params);
                if (accStatus) fullParams.append("account_status", accStatus);

                const activeParams = new URLSearchParams(params);
                activeParams.append("account_status", "active");

                const btnFull = document.getElementById("btn-export-full-csv");
                const btnActive = document.getElementById("btn-export-active-csv");
                if (btnFull) btnFull.href = `/api/attendance/export/csv?${fullParams.toString()}`;
                if (btnActive) btnActive.href = `/api/attendance/export/csv?${activeParams.toString()}`;
            };

            document.getElementById("btn-apply-report-filter").addEventListener("click", async () => {
                const subId = document.getElementById("report-filter-subject").value;
                const sessId = document.getElementById("report-filter-session").value;
                const accStatus = document.getElementById("report-filter-account-status").value;
                const dt = document.getElementById("report-filter-date").value;

                const params = {};
                if (subId) params.subject_id = subId;
                if (sessId) params.session_id = sessId;
                if (accStatus) params.account_status = accStatus;
                if (dt) {
                    params.date_from = dt;
                    params.date_to = dt;
                }

                updateExportUrls();

                try {
                    const filtered = await api.getAttendanceRecords(params);
                    const list = filtered.records || [];
                    const tbody = document.getElementById("report-table-body");
                    if (list.length === 0) {
                        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:3rem;">No records matched your filter.</td></tr>`;
                    } else {
                        tbody.innerHTML = list.map(r => `
                            <tr>
                                <td>${r.attendance_date} <span style="font-size:0.8rem; color:var(--text-muted);">${r.attendance_time}</span></td>
                                <td>
                                    <strong>${r.student_name}</strong>
                                    <div style="font-size:0.75rem; color:var(--text-muted);">${r.student_email || ''}</div>
                                </td>
                                <td><code style="color:var(--brand-primary);">${r.roll_number}</code></td>
                                <td>${r.class_name} (${r.division})</td>
                                <td>
                                    <span class="status-badge ${r.student_account_status === 'active' ? 'badge-verified' : 'badge-disabled'}">
                                        ${r.student_account_status || 'active'}
                                    </span>
                                </td>
                                <td><strong>${r.subject_code}</strong> <span style="font-size:0.8rem; color:var(--text-secondary);">(${r.session_name || 'Regular'})</span></td>
                                <td>${r.recognition_confidence}% (Liveness: ${r.liveness_score})</td>
                                <td><span class="status-badge badge-verified">PRESENT</span></td>
                            </tr>
                        `).join("");
                    }
                } catch (e) {
                    showToast(e.message, "error");
                }
            });

        } catch (err) {
            showToast(err.message, "error");
        }
    }

    /* ==========================================================================
       VIEW: Admin Audit Logs (/admin/audit-logs)
       ========================================================================== */
    async function renderAdminAuditLogs(container) {
        container.innerHTML = `
            <div class="loading-state">
                <div class="scanner-spinner"></div>
                <p>Loading security audit trails...</p>
            </div>
        `;

        try {
            const data = await api.getAuditLogs();
            const logs = data.logs || [];

            container.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem; flex-wrap:wrap; gap:1rem;">
                    <div>
                        <h2>System Audit Logs</h2>
                        <p style="color:var(--text-secondary); font-size:0.92rem;">Immutable event trail of administrative and security events.</p>
                    </div>
                </div>

                <div class="glass-panel" style="padding:1.5rem;">
                    <div class="table-responsive">
                        <table class="custom-table">
                            <thead>
                                <tr>
                                    <th>Timestamp</th>
                                    <th>Action Type</th>
                                    <th>Description</th>
                                    <th>User</th>
                                    <th>IP Address</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${logs.length > 0 ? logs.map(l => `
                                    <tr>
                                        <td style="white-space:nowrap; font-size:0.85rem; color:var(--text-secondary);">${l.timestamp || l.created_at || "—"}</td>
                                        <td><span class="status-badge ${l.action && l.action.includes('DELETE') ? 'badge-rejected' : 'badge-verified'}" style="font-family:var(--font-mono); font-size:0.75rem;">${l.action || l.action_type || "EVENT"}</span></td>
                                        <td>${l.details || "—"}</td>
                                        <td><strong>${l.username || l.email || l.user_email || "System"}</strong></td>
                                        <td><code style="font-size:0.78rem;">${l.ip_address || "127.0.0.1"}</code></td>
                                    </tr>
                                `).join("") : `
                                    <tr>
                                        <td colspan="5" style="text-align:center; color:var(--text-muted); padding:3rem;">No audit logs registered yet.</td>
                                    </tr>
                                `}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    /* ==========================================================================
       VIEW: Admin Security Settings (/admin/settings)
       ========================================================================== */
    async function renderAdminSettings(container) {
        container.innerHTML = `
            <div class="loading-state">
                <div class="scanner-spinner"></div>
                <p>Loading security configuration...</p>
            </div>
        `;

        try {
            const data = await api.getSettings();
            const settings = data.settings || {};

            container.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem; flex-wrap:wrap; gap:1rem;">
                    <div>
                        <h2>Admin Security & Settings</h2>
                        <p style="color:var(--text-secondary); font-size:0.92rem;">Manage administrator credentials and AI biometric confidence thresholds.</p>
                    </div>
                    <button class="btn btn-secondary btn-sm" onclick="app.navigate('/admin/dashboard')">
                        <i class="fa-solid fa-arrow-left"></i> Dashboard
                    </button>
                </div>

                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(380px, 1fr)); gap:1.5rem;">
                    <!-- Change Password Card -->
                    <div class="glass-panel" style="padding:1.75rem;">
                        <h3 style="margin-bottom:1.25rem; display:flex; align-items:center; gap:0.5rem;">
                            <i class="fa-solid fa-key" style="color:#f59e0b;"></i> Update Administrator Password
                        </h3>
                        <form id="admin-change-pwd-form">
                            <div class="form-group">
                                <label class="form-label">Current Password</label>
                                <input type="password" id="admin-curr-pwd" class="form-control" placeholder="Enter current password" required>
                            </div>
                            <div class="form-group">
                                <label class="form-label">New Password</label>
                                <input type="password" id="admin-new-pwd" class="form-control" placeholder="Enter new password (min 6 chars)" minlength="6" required>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Confirm New Password</label>
                                <input type="password" id="admin-confirm-pwd" class="form-control" placeholder="Re-enter new password" minlength="6" required>
                            </div>
                            <button type="submit" class="btn btn-primary" style="width:100%; margin-top:1rem;">
                                <i class="fa-solid fa-shield-check"></i> Update Master Password
                            </button>
                        </form>
                    </div>

                    <!-- AI Biometric Threshold Tuning Card -->
                    <div class="glass-panel" style="padding:1.75rem;">
                        <h3 style="margin-bottom:1.25rem; display:flex; align-items:center; gap:0.5rem;">
                            <i class="fa-solid fa-sliders" style="color:var(--brand-primary);"></i> AI Recognition Thresholds
                        </h3>
                        <form id="ai-threshold-form">
                            <div class="form-group">
                                <label class="form-label">Similarity Distance Threshold (Default: 0.55)</label>
                                <input type="number" step="0.01" id="thresh-sim" class="form-control" value="${settings.similarity_threshold || '0.55'}" min="0.1" max="1.0">
                                <span class="form-hint">Lower values demand stricter facial matches. Higher values allow looser matches.</span>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Anti-Spoof Liveness Threshold (Default: 0.50)</label>
                                <input type="number" step="0.01" id="thresh-live" class="form-control" value="${settings.liveness_threshold || '0.50'}" min="0.1" max="1.0">
                                <span class="form-hint">Minimum dynamic variation required to prevent static photo spoofing.</span>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Institution Name</label>
                                <input type="text" id="setting-inst" class="form-control" value="${settings.college_name || 'BioScan AI Institute of Technology'}">
                            </div>
                            <button type="submit" class="btn btn-secondary" style="width:100%; margin-top:1rem;">
                                <i class="fa-solid fa-floppy-disk"></i> Save System Settings
                            </button>
                        </form>
                    </div>
                </div>
            `;

            // Password change listener
            document.getElementById("admin-change-pwd-form").addEventListener("submit", async (e) => {
                e.preventDefault();
                const curr = document.getElementById("admin-curr-pwd").value;
                const newP = document.getElementById("admin-new-pwd").value;
                const conf = document.getElementById("admin-confirm-pwd").value;

                if (newP !== conf) return showToast("New passwords do not match.", "error");

                try {
                    const res = await api.changeAdminPassword({ current_password: curr, new_password: newP, confirm_password: conf });
                    showToast(res.message, "success");
                    document.getElementById("admin-change-pwd-form").reset();
                } catch (err) {
                    showToast(err.message, "error");
                }
            });

            // Thresholds form listener
            document.getElementById("ai-threshold-form").addEventListener("submit", async (e) => {
                e.preventDefault();
                const sim = parseFloat(document.getElementById("thresh-sim").value);
                const live = parseFloat(document.getElementById("thresh-live").value);
                const inst = document.getElementById("setting-inst").value;

                try {
                    const res = await api.updateSettings({ similarity_threshold: sim, liveness_threshold: live, college_name: inst });
                    showToast(res.message, "success");
                } catch (err) {
                    showToast(err.message, "error");
                }
            });

        } catch (err) {
            showToast(err.message, "error");
        }
    }
    const renderAdminSecurity = renderAdminSettings;

    // Timeframe selector handler for student dashboard
    function setStudentDashboardTimeframe(tab) {
        studentDashboardTimeframe = tab;
        const viewport = document.getElementById("app-viewport");
        if (viewport && currentRoute === "/student/dashboard") {
            renderStudentDashboard(viewport);
        }
    }

    // Admin Student Attendance Reset Prompt
    function promptResetStudentAttendanceAdmin(studentId, name) {
        showModal(
            "Reset Student Attendance",
            `
            <div style="text-align:center; padding:1.25rem 0.5rem;">
                <div style="width:60px; height:60px; background:rgba(239,68,68,0.12); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 1.25rem;">
                    <i class="fa-solid fa-clock-rotate-left" style="font-size:1.75rem; color:#ef4444;"></i>
                </div>
                <h3 style="margin-bottom:0.75rem;">Reset Attendance for ${name}?</h3>
                <p style="color:var(--text-secondary); font-size:0.92rem; line-height:1.5;">
                    This will delete all verified attendance records for <strong>${name}</strong> and reset their attendance counters to <strong>0</strong>.
                </p>
            </div>
            `,
            `
            <button class="btn btn-secondary btn-sm" onclick="app.closeModal()">Cancel</button>
            <button class="btn btn-danger btn-sm" onclick="app.confirmResetStudentAttendanceAdmin(${studentId})">
                <i class="fa-solid fa-trash-can"></i> Reset Records
            </button>
            `
        );
    }

    async function confirmResetStudentAttendanceAdmin(studentId) {
        try {
            const res = await api.resetStudentAttendanceAdmin(studentId);
            closeModal();
            showToast(res.message || "Student attendance reset successfully.", "success");
            const viewport = document.getElementById("app-viewport");
            if (viewport) {
                if (currentRoute === "/admin/students") renderAdminStudents(viewport);
                else if (currentRoute === "/admin/dashboard") renderAdminDashboard(viewport);
            }
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    // Admin Institution-Wide Attendance Wipe Prompt
    function promptResetAllAttendanceAdmin() {
        showModal(
            "Wipe All Institution Attendance",
            `
            <div style="text-align:center; padding:1.25rem 0.5rem;">
                <div style="width:60px; height:60px; background:rgba(239,68,68,0.15); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 1.25rem;">
                    <i class="fa-solid fa-radiation" style="font-size:2rem; color:#ef4444;"></i>
                </div>
                <h3 style="margin-bottom:0.75rem; color:#ef4444;">Wipe All Attendance Records?</h3>
                <p style="color:var(--text-secondary); font-size:0.92rem; line-height:1.5;">
                    This will permanently wipe <strong>ALL attendance logs</strong> across all students, subjects, and sessions in the institution database.
                </p>
            </div>
            `,
            `
            <button class="btn btn-secondary btn-sm" onclick="app.closeModal()">Cancel</button>
            <button class="btn btn-danger btn-sm" onclick="app.confirmResetAllAttendanceAdmin()">
                <i class="fa-solid fa-trash-can"></i> Yes, Wipe All Records
            </button>
            `
        );
    }

    async function confirmResetAllAttendanceAdmin() {
        try {
            const res = await api.resetAllAttendanceAdmin();
            closeModal();
            showToast(res.message || "All attendance records wiped successfully.", "success");
            const viewport = document.getElementById("app-viewport");
            if (viewport) {
                if (currentRoute === "/admin/dashboard") renderAdminDashboard(viewport);
                else if (currentRoute === "/admin/students") renderAdminStudents(viewport);
            }
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    return {
        init,
        navigate,
        showToast,
        showModal,
        closeModal,
        handleLogout,
        quickFillStudent,
        quickFillAdmin,
        handleApprovePending,
        promptRejectPending,
        confirmRejectPending,
        previewLargeImage,
        launchSessionScanner,
        toggleStudentStatus,
        resetStudentFaceProfile,
        deleteStudentAccount,
        promptAddSubject,
        confirmAddSubject,
        promptEditSubject,
        confirmEditSubject,
        promptAddNewBranch,
        confirmAddNewBranch,
        filterAdminSubjectsByBranch,
        deleteSubjectItem,
        promptCreateSession,
        confirmCreateSession,
        handleCloseSession,
        handleReopenSession,
        handleResetSession,
        handleDeleteSession,
        handleCleanupClosedSessions,
        handleCloseCurrentScannerSession,
        handleResetCurrentScannerSession,
        handleDeleteCurrentScannerSession,
        viewCurrentScannerSessionData,
        viewSessionData,
        exportSessionActiveCsv,
        quickStartTodaySession,
        setStudentDashboardTimeframe,
        promptResetStudentAttendanceAdmin,
        confirmResetStudentAttendanceAdmin,
        promptResetAllAttendanceAdmin,
        confirmResetAllAttendanceAdmin
    };
})();

// Bootstrap app on DOM Ready
document.addEventListener("DOMContentLoaded", () => {
    app.init();
});


