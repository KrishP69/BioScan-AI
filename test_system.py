import sys
import os
import json
import asyncio
import httpx

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

try:
    from backend.app.main import app
    from backend.app.database import init_db
    from backend.app.seed import seed_database
except ImportError:
    from app.main import app
    from app.database import init_db
    from app.seed import seed_database

async def run_tests():
    init_db()
    seed_database()
    
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        print("\n" + "="*60)
        print("RUNNING AUTOMATED TEST SUITE: AI FACE ATTENDANCE SYSTEM")
        print("="*60)

        # 1. Health check
        res = await client.get("/api/health")
        assert res.status_code == 200, f"Health check failed: {res.text}"
        print("[PASS] 1. System Health Check")

        import time
        ts = int(time.time())
        test_roll = f"T{ts%10000}"
        test_email = f"student_{ts}@test.com"

        # 2. Student Self-Registration
        reg_data = {
            "name": "Arjun Nair",
            "roll_number": test_roll,
            "email": test_email,
            "password": "Password@123",
            "confirm_password": "Password@123",
            "department": "Computer Engineering",
            "class_name": "TY-CSE",
            "division": "A"
        }
        res = await client.post("/api/auth/register", json=reg_data)
        assert res.status_code == 200, f"Registration failed: {res.text}"
        data = res.json()
        assert data["success"] is True
        assert data["user"]["role"] == "student"
        assert data["user"]["student"]["account_status"] == "active"
        assert data["user"]["student"]["face_status"] == "not_registered"
        student_token = data["token"]
        student_headers = {"Authorization": f"Bearer {student_token}"}
        print("[PASS] 2. Student Self-Registration (role=student, face_status=not_registered)")

        # 3. Duplicate Email / Roll Number rejection
        res_dup = await client.post("/api/auth/register", json=reg_data)
        assert res_dup.status_code == 400, "Duplicate registration was not rejected!"
        print("[PASS] 3. Duplicate Account Prevention")

        # 4. Student Login
        login_res = await client.post("/api/auth/login", json={
            "email": test_email,
            "password": "Password@123"
        })
        assert login_res.status_code == 200
        assert login_res.json()["user"]["role"] == "student"
        print("[PASS] 4. Student Authentication via Email/Password")

        # 5. Admin Login (admin / admin)
        admin_login_res = await client.post("/api/auth/admin/login", json={
            "username": "admin",
            "password": "admin"
        })
        assert admin_login_res.status_code == 200
        admin_data = admin_login_res.json()
        assert admin_data["user"]["role"] == "admin"
        admin_token = admin_data["token"]
        admin_headers = {"Authorization": f"Bearer {admin_token}"}
        print("[PASS] 5. Admin Authentication (Bcrypt Verified)")

        # 6. RBAC Enforcement: Student blocked from Admin API
        rbac_res = await client.get("/api/admin/dashboard", headers=student_headers)
        assert rbac_res.status_code == 403, f"RBAC failed! Student accessed admin route: {rbac_res.status_code}"
        print("[PASS] 6. RBAC Backend Security (Students strictly prohibited from /api/admin/*)")

        # 7. Student Face Registration submission -> PENDING
        test_embedding = [(ts % 500) * 0.002 + 0.1 if i == 0 else 0.5 for i in range(128)]
        face_res = await client.post("/api/student/face-register", headers=student_headers, json={
            "face_embedding": test_embedding,
            "preview_image": "data:image/svg+xml;utf8,<svg width='100' height='100'><circle cx='50' cy='50' r='40' fill='%2338bdf8'/></svg>"
        })
        assert face_res.status_code == 200
        assert face_res.json()["face_status"] == "pending"
        print("[PASS] 7. Student Biometric Submission (Status set to PENDING)")

        # 8. Student Dashboard reflects PENDING state
        dash_res = await client.get("/api/student/dashboard", headers=student_headers)
        assert dash_res.status_code == 200
        assert dash_res.json()["student"]["face_status"] == "pending"
        print("[PASS] 8. Student Dashboard Dynamic Face Status Notification")

        # 9. Admin lists Pending Face Reviews
        pending_list_res = await client.get("/api/admin/pending-faces", headers=admin_headers)
        assert pending_list_res.status_code == 200
        pending_items = pending_list_res.json()["pending_faces"]
        target_pending = next((p for p in pending_items if p["roll_number"] == test_roll), None)
        assert target_pending is not None, "Target pending face not found in review queue!"
        pending_id = target_pending["pending_id"]
        print(f"[PASS] 9. Admin Review Queue Detection (Pending Item ID: {pending_id})")

        # 10. Admin Approves Face Registration -> VERIFIED
        approve_res = await client.post(f"/api/admin/pending-faces/{pending_id}/approve", headers=admin_headers)
        assert approve_res.status_code == 200
        print("[PASS] 10. Admin Face Approval (Student status -> VERIFIED, Active embedding stored)")

        # 11. Student Dashboard reflects VERIFIED state
        dash_res2 = await client.get("/api/student/dashboard", headers=student_headers)
        assert dash_res2.status_code == 200
        assert dash_res2.json()["student"]["face_status"] == "verified"
        print("[PASS] 11. Student Dashboard Updates to Face verified")

        # 12. Create Attendance Session
        new_sess_res = await client.post("/api/attendance/sessions", headers=admin_headers, json={
            "subject_id": 1,
            "session_name": f"Automated Test Session {ts}",
            "date": time.strftime("%Y-%m-%d"),
            "start_time": "09:00",
            "end_time": "10:00",
            "class_name": "TY-CSE",
            "division": "A"
        })
        assert new_sess_res.status_code == 200
        active_session_id = new_sess_res.json()["session_id"]
        print(f"[PASS] 12. Dynamic Session Initialization (Session ID: {active_session_id})")

        # 13. Live Face Recognition & Attendance Marking
        mark_res = await client.post("/api/attendance/recognize-and-mark", headers=admin_headers, json={
            "session_id": active_session_id,
            "face_embedding": test_embedding,
            "liveness_score": 0.98
        })
        assert mark_res.status_code == 200
        mark_data = mark_res.json()
        assert mark_data["matched"] is True
        assert mark_data["already_marked"] is False
        assert mark_data["student"]["roll_number"] == test_roll
        print(f"[PASS] 12. Live AI Face Recognition & Instant Attendance Marking ({mark_data['student']['name']} - Match: {mark_data['student']['confidence']}%)")

        # 14. Duplicate Attendance Protection
        dup_mark_res = await client.post("/api/attendance/recognize-and-mark", headers=admin_headers, json={
            "session_id": active_session_id,
            "face_embedding": test_embedding,
            "liveness_score": 0.98
        })
        assert dup_mark_res.status_code == 200
        assert dup_mark_res.json()["already_marked"] is True
        print("[PASS] 13. Duplicate Attendance Prevention in Same Session")

        # 15. Reset Active Session (clears records and resets count)
        reset_res = await client.post(f"/api/attendance/sessions/{active_session_id}/reset", headers=admin_headers)
        assert reset_res.status_code == 200
        assert reset_res.json()["cleared_count"] == 1
        
        # Verify attendance records for session is now 0
        records_after_reset = await client.get(f"/api/attendance/records?session_id={active_session_id}", headers=admin_headers)
        assert records_after_reset.status_code == 200
        assert len(records_after_reset.json()["records"]) == 0
        print("[PASS] 14. Reset Active Session & Clear Attendance Records")

        # 16. Re-mark attendance after reset & close session
        re_mark = await client.post("/api/attendance/recognize-and-mark", headers=admin_headers, json={
            "session_id": active_session_id,
            "face_embedding": test_embedding,
            "liveness_score": 0.98
        })
        assert re_mark.status_code == 200
        assert re_mark.json()["matched"] is True

        close_res = await client.put(f"/api/attendance/sessions/{active_session_id}/close", headers=admin_headers)
        assert close_res.status_code == 200
        print("[PASS] 15. Close Attendance Session")

        # 17. Get Data from Closed Session of Active Students
        closed_data_res = await client.get(f"/api/attendance/sessions/{active_session_id}/attendees?account_status=active", headers=admin_headers)
        assert closed_data_res.status_code == 200
        closed_data = closed_data_res.json()
        assert closed_data["session"]["status"] == "closed"
        assert closed_data["metrics"]["active_attendees"] >= 1
        assert len(closed_data["records"]) >= 1
        assert closed_data["records"][0]["student_account_status"] == "active"
        print(f"[PASS] 16. Extract Data From Closed Session of Active Students ({closed_data['metrics']['active_attendees']} Active Attendee(s))")

        # 18. Export CSV for Closed Session (Active Students)
        csv_res = await client.get(f"/api/attendance/export/csv?session_id={active_session_id}&account_status=active", headers=admin_headers)
        assert csv_res.status_code == 200
        assert "text/csv" in csv_res.headers["content-type"]
        assert test_roll.encode() in csv_res.content
        print("[PASS] 17. Export Active Students CSV from Closed Session")

        # 19. Remove / Delete Session
        del_sess_res = await client.delete(f"/api/attendance/sessions/{active_session_id}", headers=admin_headers)
        assert del_sess_res.status_code == 200
        print(f"[PASS] 18. Remove Attendance Session (Session ID: {active_session_id})")

        # 20. Audit Logs
        audit_res = await client.get("/api/admin/audit-logs", headers=admin_headers)
        assert audit_res.status_code == 200
        assert len(audit_res.json()["logs"]) > 0
        print("[PASS] 19. System Audit Trail Verification")

        print("\n" + "="*60)
        print("ALL 19 TEST SUITES PASSED PERFECTLY!")
        print("="*60 + "\n")

if __name__ == "__main__":
    asyncio.run(run_tests())
