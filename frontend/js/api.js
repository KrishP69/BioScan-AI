/**
 * BioScan AI - API Client & Session Management
 */
const api = (function () {
    const TOKEN_KEY = "bioscan_jwt_token";
    const USER_KEY = "bioscan_user_data";

    function getToken() {
        return localStorage.getItem(TOKEN_KEY);
    }

    function setToken(token) {
        if (token) {
            localStorage.setItem(TOKEN_KEY, token);
        } else {
            localStorage.removeItem(TOKEN_KEY);
        }
    }

    function getUser() {
        try {
            const u = localStorage.getItem(USER_KEY);
            return u ? JSON.parse(u) : null;
        } catch (e) {
            return null;
        }
    }

    function setUser(user) {
        if (user) {
            localStorage.setItem(USER_KEY, JSON.stringify(user));
        } else {
            localStorage.removeItem(USER_KEY);
        }
    }

    function logout() {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
    }

    async function request(endpoint, options = {}) {
        const url = endpoint.startsWith("http") ? endpoint : endpoint;
        const headers = {
            "Content-Type": "application/json",
            ...(options.headers || {})
        };

        const token = getToken();
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        try {
            const response = await fetch(url, {
                ...options,
                headers
            });

            if (response.status === 401) {
                // If unauthorized and on protected route, clear session
                if (!endpoint.includes("/api/auth/login") && !endpoint.includes("/api/auth/register")) {
                    logout();
                    if (window.location.pathname.startsWith("/admin")) {
                        window.app?.navigate("/admin/login");
                    } else if (window.location.pathname.startsWith("/student")) {
                        window.app?.navigate("/login");
                    }
                }
            }

            const data = await response.json();
            if (!response.ok) {
                const msg = data.detail || data.message || "An error occurred during request.";
                throw new Error(msg);
            }
            return data;
        } catch (error) {
            console.error("API Error:", error);
            throw error;
        }
    }

    return {
        getToken,
        setToken,
        getUser,
        setUser,
        logout,
        get: (url) => request(url, { method: "GET" }),
        post: (url, body) => request(url, { method: "POST", body: JSON.stringify(body) }),
        put: (url, body) => request(url, { method: "PUT", body: JSON.stringify(body) }),
        delete: (url) => request(url, { method: "DELETE" }),

        // Auth
        registerStudent: (data) => request("/api/auth/register", { method: "POST", body: JSON.stringify(data) }),
        loginStudent: (data) => request("/api/auth/login", { method: "POST", body: JSON.stringify(data) }),
        loginAdmin: (data) => request("/api/auth/admin/login", { method: "POST", body: JSON.stringify(data) }),
        getMe: () => request("/api/auth/me", { method: "GET" }),

        // Student
        getStudentDashboard: () => request("/api/student/dashboard", { method: "GET" }),
        submitFaceRegistration: (data) => request("/api/student/face-register", { method: "POST", body: JSON.stringify(data) }),
        getStudentAttendance: (subjectId) => request(`/api/student/attendance${subjectId ? '?subject_id=' + subjectId : ''}`, { method: "GET" }),

        // Admin
        getAdminDashboard: () => request("/api/admin/dashboard", { method: "GET" }),
        getPendingFaces: () => request("/api/admin/pending-faces", { method: "GET" }),
        approvePendingFace: (id) => request(`/api/admin/pending-faces/${id}/approve`, { method: "POST" }),
        rejectPendingFace: (id, reason) => request(`/api/admin/pending-faces/${id}/reject`, { method: "POST", body: JSON.stringify({ rejection_reason: reason }) }),
        getStudents: (params = {}) => {
            const query = new URLSearchParams(params).toString();
            return request(`/api/admin/students${query ? '?' + query : ''}`, { method: "GET" });
        },
        updateStudentStatus: (id, status) => request(`/api/admin/students/${id}/status`, { method: "PUT", body: JSON.stringify({ account_status: status }) }),
        resetStudentFace: (id) => request(`/api/admin/students/${id}/reset-face`, { method: "POST" }),
        deleteStudent: (id) => request(`/api/admin/students/${id}`, { method: "DELETE" }),
        getAuditLogs: () => request("/api/admin/audit-logs", { method: "GET" }),
        changeAdminPassword: (data) => request("/api/admin/settings/password", { method: "POST", body: JSON.stringify(data) }),
        getSettings: () => request("/api/admin/settings", { method: "GET" }),
        updateSettings: (data) => request("/api/admin/settings", { method: "PUT", body: JSON.stringify(data) }),

        // Attendance & Sessions
        getSessions: (status) => request(`/api/attendance/sessions${status ? '?status_filter=' + status : ''}`, { method: "GET" }),
        createSession: (data) => request("/api/attendance/sessions", { method: "POST", body: JSON.stringify(data) }),
        closeSession: (id) => request(`/api/attendance/sessions/${id}/close`, { method: "PUT" }),
        recognizeAndMark: (data) => request("/api/attendance/recognize-and-mark", { method: "POST", body: JSON.stringify(data) }),
        getAttendanceRecords: (params = {}) => {
            const query = new URLSearchParams(params).toString();
            return request(`/api/attendance/records${query ? '?' + query : ''}`, { method: "GET" });
        },
        getSubjects: () => request("/api/subjects", { method: "GET" }),
        createSubject: (data) => request("/api/subjects", { method: "POST", body: JSON.stringify(data) }),
        deleteSubject: (id) => request(`/api/subjects/${id}`, { method: "DELETE" }),
    };
})();
