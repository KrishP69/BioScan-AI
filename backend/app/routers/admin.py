import json
from datetime import datetime, date
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, HTTPException, status, Depends, Request
from app.models.schemas import (
    FaceReviewRequest,
    StudentStatusUpdateRequest,
    AdminPasswordChangeRequest,
    SettingsUpdateRequest
)
from app.database import get_db
from app.auth import require_admin, hash_password, verify_password
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/api/admin", tags=["Administrator"])

@router.get("/dashboard")
def get_admin_dashboard(current_user: Dict[str, Any] = Depends(require_admin)):
    today_str = date.today().isoformat()
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        # 1. Total Students & Active Students
        cursor.execute("SELECT COUNT(*) as total, SUM(CASE WHEN account_status = 'active' THEN 1 ELSE 0 END) as active FROM students")
        student_counts = cursor.fetchone()
        total_students = student_counts["total"] or 0
        active_students = student_counts["active"] or 0
        
        # 2. Pending Face Registrations
        cursor.execute("SELECT COUNT(*) as pending_cnt FROM pending_faces WHERE status = 'pending'")
        pending_faces_count = cursor.fetchone()["pending_cnt"] or 0
        
        # 3. Present Today
        cursor.execute("""
            SELECT COUNT(DISTINCT student_id) as present_today
            FROM attendance_records
            WHERE attendance_date = ? AND status IN ('present', 'late')
        """, (today_str,))
        present_today = cursor.fetchone()["present_today"] or 0
        
        absent_today = max(0, active_students - present_today)
        
        # 4. Overall Attendance across all records
        cursor.execute("""
            SELECT COUNT(*) as total_records,
                   SUM(CASE WHEN status IN ('present', 'late') THEN 1 ELSE 0 END) as present_records
            FROM attendance_records
        """)
        rec_stats = cursor.fetchone()
        tot_recs = rec_stats["total_records"] or 0
        pres_recs = rec_stats["present_records"] or 0
        overall_attendance_pct = round((pres_recs / tot_recs * 100.0), 1) if tot_recs > 0 else 85.0
        
        # 5. Pending face list preview for dashboard widget
        cursor.execute("""
            SELECT pf.id, pf.student_id, pf.preview_reference, pf.submitted_at,
                   s.name, s.roll_number, s.department, s.class_name, s.division, u.email
            FROM pending_faces pf
            JOIN students s ON pf.student_id = s.id
            JOIN users u ON s.user_id = u.id
            WHERE pf.status = 'pending'
            ORDER BY pf.submitted_at ASC
            LIMIT 5
        """)
        pending_items = [dict(r) for r in cursor.fetchall()]
        
        # 6. Active sessions today
        cursor.execute("""
            SELECT ses.id, ses.session_name, ses.start_time, ses.end_time, ses.class_name, ses.division, ses.status,
                   sub.code as subject_code, sub.name as subject_name
            FROM attendance_sessions ses
            JOIN subjects sub ON ses.subject_id = sub.id
            WHERE ses.date = ?
            ORDER BY ses.start_time ASC
        """, (today_str,))
        sessions_today = [dict(r) for r in cursor.fetchall()]
        
        # 7. Day-wise sessions breakdown (All recent dates)
        cursor.execute("""
            SELECT ses.id as session_id, ses.session_name, ses.date, ses.start_time, ses.end_time,
                   ses.class_name, ses.division, ses.status as session_status,
                   sub.code as subject_code, sub.name as subject_name,
                   (SELECT COUNT(*) FROM attendance_records ar JOIN students st ON ar.student_id = st.id WHERE ar.session_id = ses.id AND st.account_status = 'active') as attended_count,
                   (SELECT COUNT(*) FROM students st WHERE st.account_status = 'active') as total_active_students
            FROM attendance_sessions ses
            JOIN subjects sub ON ses.subject_id = sub.id
            ORDER BY ses.date DESC, ses.start_time DESC
        """)
        all_session_rows = cursor.fetchall()
        
        admin_days_map = {}
        for r in all_session_rows:
            d_str = r["date"]
            if d_str not in admin_days_map:
                try:
                    dt = datetime.strptime(d_str, "%Y-%m-%d")
                    day_name = dt.strftime("%A")
                except Exception:
                    day_name = "Day"
                admin_days_map[d_str] = {
                    "date": d_str,
                    "day_name": day_name,
                    "total_sessions": 0,
                    "total_attendances": 0,
                    "sessions": []
                }
            
            tot_st = r["total_active_students"] or 1
            att_cnt = r["attended_count"] or 0
            rate = round((att_cnt / tot_st * 100.0), 1) if tot_st > 0 else 0.0
            
            admin_days_map[d_str]["total_sessions"] += 1
            admin_days_map[d_str]["total_attendances"] += att_cnt
            admin_days_map[d_str]["sessions"].append({
                "session_id": r["session_id"],
                "subject_code": r["subject_code"],
                "subject_name": r["subject_name"],
                "session_name": r["session_name"],
                "start_time": r["start_time"],
                "end_time": r["end_time"],
                "class_name": r["class_name"],
                "division": r["division"],
                "session_status": r["session_status"],
                "attended_count": att_cnt,
                "total_students": tot_st,
                "attendance_rate": rate
            })
            
        day_wise_sessions = list(admin_days_map.values())

        # 8. Recent activity / audit logs
        cursor.execute("""
            SELECT id, action, details, timestamp
            FROM audit_logs
            ORDER BY timestamp DESC
            LIMIT 6
        """)
        recent_logs = [dict(r) for r in cursor.fetchall()]

        return {
            "success": True,
            "metrics": {
                "total_students": total_students,
                "active_students": active_students,
                "pending_faces": pending_faces_count,
                "present_today": present_today,
                "absent_today": absent_today,
                "overall_attendance_percentage": overall_attendance_pct
            },
            "pending_preview": pending_items,
            "sessions_today": sessions_today,
            "day_wise_sessions": day_wise_sessions,
            "recent_logs": recent_logs
        }

@router.get("/pending-faces")
def list_pending_face_registrations(current_user: Dict[str, Any] = Depends(require_admin)):
    """
    List all pending face registration requests waiting for admin review.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT pf.id as pending_id, pf.student_id, pf.face_embedding, pf.preview_reference, 
                   pf.status, pf.submitted_at,
                   s.name as student_name, s.roll_number, s.department, s.class_name, s.division,
                   u.email
            FROM pending_faces pf
            JOIN students s ON pf.student_id = s.id
            JOIN users u ON s.user_id = u.id
            WHERE pf.status = 'pending'
            ORDER BY pf.submitted_at ASC
        """)
        items = []
        for r in cursor.fetchall():
            row = dict(r)
            # Remove raw embedding array from list output to keep payload light
            row.pop("face_embedding", None)
            items.append(row)
            
        return {
            "success": True,
            "count": len(items),
            "pending_faces": items
        }

@router.post("/pending-faces/{pending_id}/approve")
def approve_face_registration(
    pending_id: int, 
    request: Request,
    current_user: Dict[str, Any] = Depends(require_admin)
):
    admin_id = current_user["id"]
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Get pending record
        cursor.execute("""
            SELECT pf.id, pf.student_id, pf.face_embedding, s.name, s.roll_number
            FROM pending_faces pf
            JOIN students s ON pf.student_id = s.id
            WHERE pf.id = ? AND pf.status = 'pending'
        """, (pending_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Pending face registration not found or already processed.")
            
        student_id = row["student_id"]
        student_name = row["name"]
        roll_number = row["roll_number"]
        embedding = row["face_embedding"]
        
        # 1. Update pending_faces to approved
        cursor.execute("""
            UPDATE pending_faces
            SET status = 'approved', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (admin_id, pending_id))
        
        # 2. Update students table face_status = 'verified'
        cursor.execute("""
            UPDATE students
            SET face_status = 'verified', updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (student_id,))
        
        # 3. Create or replace active face profile
        cursor.execute("""
            INSERT INTO face_profiles (student_id, face_embedding, model_version, updated_at)
            VALUES (?, ?, 'face-api-v1', CURRENT_TIMESTAMP)
            ON CONFLICT(student_id) DO UPDATE SET
                face_embedding = excluded.face_embedding,
                updated_at = CURRENT_TIMESTAMP
        """, (student_id, embedding))
        
        client_ip = request.client.host if request.client else None
        log_audit_event("FACE_APPROVED", f"Admin approved face registration for student '{student_name}' (Roll: {roll_number}).", admin_id, client_ip, conn=conn)
        
        return {
            "success": True,
            "message": f"Face registration for {student_name} (Roll: {roll_number}) has been APPROVED and is now active for attendance."
        }

@router.post("/pending-faces/{pending_id}/reject")
def reject_face_registration(
    pending_id: int, 
    review: FaceReviewRequest,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_admin)
):
    admin_id = current_user["id"]
    reason = review.rejection_reason or "Face was not clearly recognizable or image quality was insufficient."
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT pf.id, pf.student_id, s.name, s.roll_number
            FROM pending_faces pf
            JOIN students s ON pf.student_id = s.id
            WHERE pf.id = ? AND pf.status = 'pending'
        """, (pending_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Pending face registration not found or already processed.")
            
        student_id = row["student_id"]
        student_name = row["name"]
        roll_number = row["roll_number"]
        
        # Update pending_faces
        cursor.execute("""
            UPDATE pending_faces
            SET status = 'rejected', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, rejection_reason = ?
            WHERE id = ?
        """, (admin_id, reason, pending_id))
        
        # Update student face_status to rejected
        cursor.execute("""
            UPDATE students
            SET face_status = 'rejected', updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (student_id,))
        
        client_ip = request.client.host if request.client else None
        log_audit_event("FACE_REJECTED", f"Admin rejected face registration for student '{student_name}' (Roll: {roll_number}). Reason: {reason}", admin_id, client_ip, conn=conn)
        
        return {
            "success": True,
            "message": f"Face registration for {student_name} was rejected. The student can submit a new face scan."
        }

@router.get("/students")
def get_all_students(
    search: Optional[str] = None,
    face_status: Optional[str] = None,
    account_status: Optional[str] = None,
    department: Optional[str] = None,
    current_user: Dict[str, Any] = Depends(require_admin)
):
    with get_db() as conn:
        cursor = conn.cursor()
        
        query = """
            SELECT s.id, s.user_id, s.name, s.roll_number, s.department, s.class_name, s.division,
                   s.account_status, s.face_status, s.created_at, u.email,
                   (SELECT COUNT(*) FROM attendance_records ar WHERE ar.student_id = s.id AND ar.status IN ('present', 'late')) as attended_classes,
                   (SELECT COUNT(*) FROM attendance_records ar WHERE ar.student_id = s.id) as total_recorded
            FROM students s
            JOIN users u ON s.user_id = u.id
            WHERE 1=1
        """
        params = []
        
        if search:
            query += " AND (s.name LIKE ? OR s.roll_number LIKE ? OR u.email LIKE ?)"
            term = f"%{search}%"
            params.extend([term, term, term])
            
        if face_status:
            query += " AND s.face_status = ?"
            params.append(face_status)
            
        if account_status:
            query += " AND s.account_status = ?"
            params.append(account_status)
            
        if department:
            query += " AND s.department = ?"
            params.append(department)
            
        query += " ORDER BY s.roll_number ASC, s.name ASC"
        
        cursor.execute(query, tuple(params))
        students = [dict(r) for r in cursor.fetchall()]
        
        return {
            "success": True,
            "students": students,
            "total": len(students)
        }

@router.put("/students/{student_id}/status")
def update_student_account_status(
    student_id: int,
    req: StudentStatusUpdateRequest,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_admin)
):
    if req.account_status not in ("active", "disabled"):
        raise HTTPException(status_code=400, detail="Invalid status value. Must be 'active' or 'disabled'.")
        
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, roll_number FROM students WHERE id = ?", (student_id,))
        st = cursor.fetchone()
        if not st:
            raise HTTPException(status_code=404, detail="Student not found.")
            
        cursor.execute("UPDATE students SET account_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (req.account_status, student_id))
        
        client_ip = request.client.host if request.client else None
        log_audit_event("STUDENT_STATUS_CHANGE", f"Admin changed status of '{st['name']}' to '{req.account_status}'.", current_user["id"], client_ip, conn=conn)
        
        return {
            "success": True,
            "message": f"Student '{st['name']}' account is now {req.account_status}."
        }

@router.post("/students/{student_id}/reset-face")
def reset_student_face(
    student_id: int,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_admin)
):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, roll_number FROM students WHERE id = ?", (student_id,))
        st = cursor.fetchone()
        if not st:
            raise HTTPException(status_code=404, detail="Student not found.")
            
        # Delete face profile and reset status
        cursor.execute("DELETE FROM face_profiles WHERE student_id = ?", (student_id,))
        cursor.execute("UPDATE students SET face_status = 'not_registered', updated_at = CURRENT_TIMESTAMP WHERE id = ?", (student_id,))
        
        client_ip = request.client.host if request.client else None
        log_audit_event("FACE_RESET", f"Admin reset face profile for '{st['name']}' (Roll: {st['roll_number']}).", current_user["id"], client_ip, conn=conn)
        
        return {
            "success": True,
            "message": f"Face registration for '{st['name']}' has been reset to not registered."
        }

@router.delete("/students/{student_id}")
def delete_student(
    student_id: int,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_admin)
):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT user_id, name, roll_number FROM students WHERE id = ?", (student_id,))
        st = cursor.fetchone()
        if not st:
            raise HTTPException(status_code=404, detail="Student not found.")
            
        user_id = st["user_id"]
        # Deleting from users cascades to students, face_profiles, pending_faces, attendance_records
        cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
        
        client_ip = request.client.host if request.client else None
        log_audit_event("STUDENT_DELETED", f"Admin deleted student '{st['name']}' (Roll: {st['roll_number']}).", current_user["id"], client_ip, conn=conn)
        
        return {
            "success": True,
            "message": f"Student '{st['name']}' and associated records have been removed."
        }

@router.get("/audit-logs")
def get_audit_logs(
    limit: int = 50,
    current_user: Dict[str, Any] = Depends(require_admin)
):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT al.id, al.action, al.details, al.ip_address, al.timestamp,
                   u.username, u.email
            FROM audit_logs al
            LEFT JOIN users u ON al.user_id = u.id
            ORDER BY al.timestamp DESC
            LIMIT ?
        """, (limit,))
        logs = [dict(r) for r in cursor.fetchall()]
        return {"success": True, "logs": logs}

@router.post("/settings/password")
def change_admin_password(
    req: AdminPasswordChangeRequest,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_admin)
):
    admin_id = current_user["id"]
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT password_hash FROM users WHERE id = ?", (admin_id,))
        row = cursor.fetchone()
        
        if not row or not verify_password(req.current_password, row["password_hash"]):
            raise HTTPException(status_code=400, detail="Current password does not match.")
            
        new_hash = hash_password(req.new_password)
        cursor.execute("UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (new_hash, admin_id))
        
        # Mark default password as changed
        cursor.execute("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('default_admin_warning_dismissed', '1')")
        
        client_ip = request.client.host if request.client else None
        log_audit_event("ADMIN_PASSWORD_CHANGED", "Admin updated master security password.", admin_id, client_ip, conn=conn)
        
        return {
            "success": True,
            "message": "Administrator password updated successfully."
        }

@router.get("/settings")
def get_system_settings(current_user: Dict[str, Any] = Depends(require_admin)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT key, value FROM system_settings")
        settings_dict = {row["key"]: row["value"] for row in cursor.fetchall()}
        return {"success": True, "settings": settings_dict}

@router.put("/settings")
def update_system_settings(
    req: SettingsUpdateRequest,
    current_user: Dict[str, Any] = Depends(require_admin)
):
    with get_db() as conn:
        cursor = conn.cursor()
        if req.similarity_threshold is not None:
            cursor.execute("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('similarity_threshold', ?)", (str(req.similarity_threshold),))
        if req.liveness_threshold is not None:
            cursor.execute("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('liveness_threshold', ?)", (str(req.liveness_threshold),))
        if req.college_name is not None:
            cursor.execute("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('college_name', ?)", (req.college_name,))
        if req.academic_year is not None:
            cursor.execute("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('academic_year', ?)", (req.academic_year,))
            
        return {"success": True, "message": "System settings updated successfully."}

@router.post("/students/{student_id}/reset-attendance")
def reset_student_attendance_admin(
    student_id: int,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_admin)
):
    """
    Admin action to reset attendance records for a specific student.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, roll_number FROM students WHERE id = ?", (student_id,))
        st = cursor.fetchone()
        if not st:
            raise HTTPException(status_code=404, detail="Student not found.")
            
        cursor.execute("SELECT COUNT(*) as count FROM attendance_records WHERE student_id = ?", (student_id,))
        count = cursor.fetchone()["count"] or 0
        
        cursor.execute("DELETE FROM attendance_records WHERE student_id = ?", (student_id,))
        
        client_ip = request.client.host if request.client else None
        log_audit_event("STUDENT_ATTENDANCE_RESET_ADMIN", f"Admin reset attendance records ({count} cleared) for student '{st['name']}' (Roll: {st['roll_number']}).", current_user["id"], client_ip, conn=conn)
        
        return {
            "success": True,
            "message": f"Successfully reset attendance for {st['name']} ({count} records cleared).",
            "cleared_count": count
        }

@router.post("/attendance/reset-all")
def reset_all_attendance_admin(
    request: Request,
    current_user: Dict[str, Any] = Depends(require_admin)
):
    """
    Admin action to reset all attendance records across the institution.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) as count FROM attendance_records")
        count = cursor.fetchone()["count"] or 0
        
        cursor.execute("DELETE FROM attendance_records")
        
        client_ip = request.client.host if request.client else None
        log_audit_event("ALL_ATTENDANCE_RESET_ADMIN", f"Admin wiped all attendance records ({count} records cleared) across institution.", current_user["id"], client_ip, conn=conn)
        
        return {
            "success": True,
            "message": f"Successfully reset all attendance records ({count} logs cleared).",
            "cleared_count": count
        }

