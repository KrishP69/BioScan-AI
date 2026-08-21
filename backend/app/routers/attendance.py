import csv
import io
from datetime import datetime, date
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, HTTPException, status, Depends, Request, Response
from app.models.schemas import SessionCreateRequest, LiveAttendanceMarkRequest
from app.database import get_db
from app.auth import get_current_user, require_admin
from app.services.face_service import find_matching_student
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/api/attendance", tags=["Attendance"])

@router.get("/sessions")
def get_attendance_sessions(
    status_filter: Optional[str] = None,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    with get_db() as conn:
        cursor = conn.cursor()
        query = """
            SELECT ses.id, ses.subject_id, ses.session_name, ses.date, ses.start_time, ses.end_time,
                   ses.class_name, ses.division, ses.status, ses.created_at,
                   sub.code as subject_code, sub.name as subject_name,
                   (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id = ses.id) as attendance_count,
                   (SELECT COUNT(*) FROM attendance_records ar JOIN students st ON ar.student_id = st.id WHERE ar.session_id = ses.id AND st.account_status = 'active') as active_attendance_count
            FROM attendance_sessions ses
            JOIN subjects sub ON ses.subject_id = sub.id
            WHERE 1=1
        """
        params = []
        if status_filter:
            query += " AND ses.status = ?"
            params.append(status_filter)
            
        query += " ORDER BY ses.date DESC, ses.start_time DESC"
        cursor.execute(query, tuple(params))
        sessions = [dict(r) for r in cursor.fetchall()]
        return {"success": True, "sessions": sessions}

@router.get("/sessions/{session_id}/attendees")
def get_session_attendees(
    session_id: int,
    account_status: Optional[str] = None,
    current_user: Dict[str, Any] = Depends(require_admin)
):
    """
    Get all attendance records and student data from a specific session (active or closed),
    with optional filtering for active students.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Verify session
        cursor.execute("""
            SELECT ses.id, ses.subject_id, ses.session_name, ses.date, ses.start_time, ses.end_time,
                   ses.class_name, ses.division, ses.status, ses.created_at,
                   sub.code as subject_code, sub.name as subject_name
            FROM attendance_sessions ses
            JOIN subjects sub ON ses.subject_id = sub.id
            WHERE ses.id = ?
        """, (session_id,))
        session = cursor.fetchone()
        if not session:
            raise HTTPException(status_code=404, detail="Attendance session not found.")
            
        # Metrics breakdown
        cursor.execute("""
            SELECT 
                COUNT(*) as total_attendees,
                SUM(CASE WHEN s.account_status = 'active' THEN 1 ELSE 0 END) as active_attendees,
                SUM(CASE WHEN s.account_status = 'disabled' THEN 1 ELSE 0 END) as disabled_attendees
            FROM attendance_records ar
            JOIN students s ON ar.student_id = s.id
            WHERE ar.session_id = ?
        """, (session_id,))
        metrics_row = cursor.fetchone()
        total_att = metrics_row["total_attendees"] if metrics_row and metrics_row["total_attendees"] else 0
        active_att = metrics_row["active_attendees"] if metrics_row and metrics_row["active_attendees"] else 0
        disabled_att = metrics_row["disabled_attendees"] if metrics_row and metrics_row["disabled_attendees"] else 0
        
        query = """
            SELECT ar.id, ar.attendance_date, ar.attendance_time, ar.status, 
                   ar.recognition_confidence, ar.liveness_score, ar.created_at,
                   s.id as student_id, s.name as student_name, s.roll_number, s.department, 
                   s.class_name, s.division, s.account_status as student_account_status,
                   s.face_status as student_face_status, u.email as student_email,
                   sub.code as subject_code, sub.name as subject_name,
                   ses.session_name, ses.status as session_status
            FROM attendance_records ar
            JOIN students s ON ar.student_id = s.id
            JOIN users u ON s.user_id = u.id
            JOIN subjects sub ON ar.subject_id = sub.id
            JOIN attendance_sessions ses ON ar.session_id = ses.id
            WHERE ar.session_id = ?
        """
        params = [session_id]
        if account_status:
            query += " AND s.account_status = ?"
            params.append(account_status)
            
        query += " ORDER BY ar.attendance_time ASC, s.roll_number ASC"
        cursor.execute(query, tuple(params))
        records = [dict(r) for r in cursor.fetchall()]
        
        return {
            "success": True,
            "session": dict(session),
            "metrics": {
                "total_attendees": total_att,
                "active_attendees": active_att,
                "disabled_attendees": disabled_att
            },
            "records": records,
            "total": len(records)
        }

@router.post("/sessions")
def create_attendance_session(
    req: SessionCreateRequest,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_admin)
):
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Verify subject exists
        cursor.execute("SELECT name FROM subjects WHERE id = ?", (req.subject_id,))
        sub = cursor.fetchone()
        if not sub:
            raise HTTPException(status_code=404, detail="Subject not found.")
            
        cursor.execute("""
            INSERT INTO attendance_sessions 
            (subject_id, session_name, date, start_time, end_time, class_name, division, status, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
        """, (req.subject_id, req.session_name.strip(), req.date, req.start_time, req.end_time, req.class_name.strip(), req.division.strip(), current_user["id"]))
        session_id = cursor.lastrowid
        
        client_ip = request.client.host if request.client else None
        log_audit_event("SESSION_CREATED", f"Admin started attendance session '{req.session_name}' for subject ID {req.subject_id}.", current_user["id"], client_ip, conn=conn)
        
        return {
            "success": True,
            "message": "Attendance session created and opened for live scanning.",
            "session_id": session_id
        }

@router.put("/sessions/{session_id}/close")
def close_attendance_session(
    session_id: int,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_admin)
):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT session_name FROM attendance_sessions WHERE id = ?", (session_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Session not found.")
            
        cursor.execute("UPDATE attendance_sessions SET status = 'closed' WHERE id = ?", (session_id,))
        
        client_ip = request.client.host if request.client else None
        log_audit_event("SESSION_CLOSED", f"Admin closed attendance session '{row['session_name']}'.", current_user["id"], client_ip, conn=conn)
        
        return {"success": True, "message": "Attendance session closed."}

@router.put("/sessions/{session_id}/reopen")
def reopen_attendance_session(
    session_id: int,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_admin)
):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT session_name FROM attendance_sessions WHERE id = ?", (session_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Session not found.")
            
        cursor.execute("UPDATE attendance_sessions SET status = 'active' WHERE id = ?", (session_id,))
        
        client_ip = request.client.host if request.client else None
        log_audit_event("SESSION_REOPENED", f"Admin reopened attendance session '{row['session_name']}'.", current_user["id"], client_ip, conn=conn)
        
        return {"success": True, "message": "Attendance session reopened and active for scanning."}

@router.post("/sessions/{session_id}/reset")
def reset_attendance_session(
    session_id: int,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_admin)
):
    """
    Clears all attendance records marked for this session so attendance can be re-taken.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT session_name FROM attendance_sessions WHERE id = ?", (session_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Session not found.")
            
        cursor.execute("SELECT COUNT(*) as count FROM attendance_records WHERE session_id = ?", (session_id,))
        count_row = cursor.fetchone()
        records_count = count_row["count"] if count_row else 0
        
        cursor.execute("DELETE FROM attendance_records WHERE session_id = ?", (session_id,))
        cursor.execute("UPDATE attendance_sessions SET status = 'active' WHERE id = ?", (session_id,))
        
        client_ip = request.client.host if request.client else None
        log_audit_event("SESSION_RESET", f"Admin reset attendance records ({records_count} cleared) for session '{row['session_name']}'.", current_user["id"], client_ip, conn=conn)
        
        return {
            "success": True, 
            "message": f"Attendance reset successfully. {records_count} attendance record(s) cleared for '{row['session_name']}'.",
            "cleared_count": records_count
        }

@router.delete("/sessions/cleanup/closed")
def cleanup_closed_sessions(
    request: Request,
    current_user: Dict[str, Any] = Depends(require_admin)
):
    """
    Permanently removes all closed/inactive attendance sessions and their records.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM attendance_sessions WHERE status = 'closed'")
        closed_ids = [r["id"] for r in cursor.fetchall()]
        
        if closed_ids:
            placeholders = ",".join("?" for _ in closed_ids)
            cursor.execute(f"DELETE FROM attendance_records WHERE session_id IN ({placeholders})", tuple(closed_ids))
            cursor.execute(f"DELETE FROM attendance_sessions WHERE id IN ({placeholders})", tuple(closed_ids))
            
        client_ip = request.client.host if request.client else None
        log_audit_event("SESSIONS_CLEANED", f"Admin deleted {len(closed_ids)} closed sessions.", current_user["id"], client_ip, conn=conn)
        
        return {"success": True, "message": f"Cleaned up {len(closed_ids)} closed session(s)."}

@router.delete("/sessions/{session_id}")
def delete_attendance_session(
    session_id: int,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_admin)
):
    """
    Permanently removes an attendance session and all its associated records.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT session_name FROM attendance_sessions WHERE id = ?", (session_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Session not found.")
            
        cursor.execute("DELETE FROM attendance_records WHERE session_id = ?", (session_id,))
        cursor.execute("DELETE FROM attendance_sessions WHERE id = ?", (session_id,))
        
        client_ip = request.client.host if request.client else None
        log_audit_event("SESSION_DELETED", f"Admin deleted attendance session '{row['session_name']}' (ID: {session_id}).", current_user["id"], client_ip, conn=conn)
        
        return {"success": True, "message": f"Session '{row['session_name']}' and its attendance records were permanently removed."}

@router.post("/recognize-and-mark")
def recognize_face_and_mark_attendance(
    req: LiveAttendanceMarkRequest,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_admin)
):
    """
    Live AI recognition & 1-click attendance marking pipeline:
    1. Match live query embedding against active face_profiles.
    2. Check liveness score threshold.
    3. Check duplicate attendance in current session / date.
    4. Record attendance with confidence & timestamp.
    """
    # 1. Fetch system thresholds
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM system_settings WHERE key = 'similarity_threshold'")
        sim_row = cursor.fetchone()
        dist_threshold = float(sim_row["value"]) if sim_row else 0.55
        
        cursor.execute("SELECT value FROM system_settings WHERE key = 'liveness_threshold'")
        live_row = cursor.fetchone()
        live_threshold = float(live_row["value"]) if live_row else 0.50

        # 2. Check session exists and is active
        cursor.execute("""
            SELECT s.id, s.session_name, s.subject_id, s.class_name, s.division, s.status,
                   sub.code as subject_code, sub.name as subject_name
            FROM attendance_sessions s
            JOIN subjects sub ON s.subject_id = sub.id
            WHERE s.id = ?
        """, (req.session_id,))
        session = cursor.fetchone()
        if not session:
            raise HTTPException(status_code=404, detail="Attendance session not found.")
        if session["status"] != "active":
            raise HTTPException(status_code=400, detail="This attendance session is closed.")

        # 3. Liveness check
        liveness = req.liveness_score if req.liveness_score is not None else 1.0
        if liveness < live_threshold:
            return {
                "success": False,
                "matched": False,
                "detail": f"Spoofing detected: Liveness score {liveness:.2f} is below required threshold {live_threshold:.2f}."
            }

        # 4. Search matching student
        match = find_matching_student(req.face_embedding, distance_threshold=dist_threshold, liveness_score=liveness)
        if not match:
            return {
                "success": False,
                "matched": False,
                "detail": "Face not recognized among verified student profiles. Please ensure face registration was approved."
            }

        student_id = match["student_id"]
        subject_id = session["subject_id"]
        today_date = date.today().isoformat()
        current_time = datetime.now().strftime("%H:%M:%S")

        # 5. Prevent duplicate attendance in same session today
        cursor.execute("""
            SELECT id, attendance_time, recognition_confidence
            FROM attendance_records
            WHERE student_id = ? AND session_id = ? AND attendance_date = ?
        """, (student_id, req.session_id, today_date))
        existing_record = cursor.fetchone()
        
        if existing_record:
            return {
                "success": True,
                "matched": True,
                "already_marked": True,
                "message": f"Attendance already marked for {match['name']} at {existing_record['attendance_time']}",
                "student": match,
                "record": dict(existing_record)
            }

        # 6. Insert new attendance record
        cursor.execute("""
            INSERT INTO attendance_records 
            (student_id, subject_id, session_id, attendance_date, attendance_time, status, recognition_confidence, liveness_score)
            VALUES (?, ?, ?, ?, ?, 'present', ?, ?)
        """, (student_id, subject_id, req.session_id, today_date, current_time, match["confidence"], liveness))
        record_id = cursor.lastrowid
        
        client_ip = request.client.host if request.client else None
        log_audit_event("ATTENDANCE_MARKED", f"Marked attendance for '{match['name']}' (Roll: {match['roll_number']}) in session '{session['session_name']}'. Confidence: {match['confidence']}%", current_user["id"], client_ip, conn=conn)
        
        return {
            "success": True,
            "matched": True,
            "already_marked": False,
            "message": f"✓ Attendance successfully recorded for {match['name']} (Roll: {match['roll_number']})",
            "student": match,
            "record": {
                "id": record_id,
                "attendance_date": today_date,
                "attendance_time": current_time,
                "status": "present",
                "confidence": match["confidence"],
                "liveness": round(liveness, 2)
            }
        }

@router.get("/records")
def get_attendance_records(
    session_id: Optional[int] = None,
    subject_id: Optional[int] = None,
    student_id: Optional[int] = None,
    account_status: Optional[str] = None,
    session_status: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    current_user: Dict[str, Any] = Depends(require_admin)
):
    with get_db() as conn:
        cursor = conn.cursor()
        
        query = """
            SELECT ar.id, ar.attendance_date, ar.attendance_time, ar.status, 
                   ar.recognition_confidence, ar.liveness_score, ar.created_at,
                   s.id as student_id, s.name as student_name, s.roll_number, s.department, s.class_name, s.division,
                   s.account_status as student_account_status, s.face_status as student_face_status, u.email as student_email,
                   sub.code as subject_code, sub.name as subject_name,
                   ses.id as session_id, ses.session_name, ses.status as session_status
            FROM attendance_records ar
            JOIN students s ON ar.student_id = s.id
            JOIN users u ON s.user_id = u.id
            JOIN subjects sub ON ar.subject_id = sub.id
            LEFT JOIN attendance_sessions ses ON ar.session_id = ses.id
            WHERE 1=1
        """
        params = []
        
        if session_id:
            query += " AND ar.session_id = ?"
            params.append(session_id)
        if subject_id:
            query += " AND ar.subject_id = ?"
            params.append(subject_id)
        if student_id:
            query += " AND ar.student_id = ?"
            params.append(student_id)
        if account_status:
            query += " AND s.account_status = ?"
            params.append(account_status)
        if session_status:
            query += " AND ses.status = ?"
            params.append(session_status)
        if date_from:
            query += " AND ar.attendance_date >= ?"
            params.append(date_from)
        if date_to:
            query += " AND ar.attendance_date <= ?"
            params.append(date_to)
            
        query += " ORDER BY ar.attendance_date DESC, ar.attendance_time DESC"
        
        cursor.execute(query, tuple(params))
        records = [dict(r) for r in cursor.fetchall()]
        return {"success": True, "records": records, "total": len(records)}

@router.get("/export/csv")
def export_attendance_csv(
    subject_id: Optional[int] = None,
    session_id: Optional[int] = None,
    account_status: Optional[str] = None,
    session_status: Optional[str] = None,
    current_user: Dict[str, Any] = Depends(require_admin)
):
    with get_db() as conn:
        cursor = conn.cursor()
        query = """
            SELECT ar.id, ar.attendance_date, ar.attendance_time, ar.status, 
                   ar.recognition_confidence, ar.liveness_score,
                   s.name as student_name, s.roll_number, s.department, s.class_name, s.division,
                   s.account_status as student_account_status, u.email as student_email,
                   sub.code as subject_code, sub.name as subject_name,
                   ses.session_name, ses.status as session_status
            FROM attendance_records ar
            JOIN students s ON ar.student_id = s.id
            JOIN users u ON s.user_id = u.id
            JOIN subjects sub ON ar.subject_id = sub.id
            LEFT JOIN attendance_sessions ses ON ar.session_id = ses.id
            WHERE 1=1
        """
        params = []
        if subject_id:
            query += " AND ar.subject_id = ?"
            params.append(subject_id)
        if session_id:
            query += " AND ar.session_id = ?"
            params.append(session_id)
        if account_status:
            query += " AND s.account_status = ?"
            params.append(account_status)
        if session_status:
            query += " AND ses.status = ?"
            params.append(session_status)
            
        query += " ORDER BY ar.attendance_date DESC, ar.attendance_time DESC"
        
        cursor.execute(query, tuple(params))
        rows = cursor.fetchall()
        
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["ID", "Roll Number", "Student Name", "Email", "Account Status", "Department", "Class", "Division", "Subject Code", "Subject Name", "Session Name", "Session Status", "Date", "Time", "Status", "Confidence (%)", "Liveness"])
        
        for r in rows:
            writer.writerow([
                r["id"],
                r["roll_number"],
                r["student_name"],
                r["student_email"],
                r["student_account_status"],
                r["department"],
                r["class_name"],
                r["division"],
                r["subject_code"],
                r["subject_name"],
                r["session_name"] or "N/A",
                r["session_status"] or "N/A",
                r["attendance_date"],
                r["attendance_time"],
                r["status"],
                r["recognition_confidence"],
                r["liveness_score"]
            ])
            
        output.seek(0)
        filename_prefix = "active_students" if account_status == "active" else "attendance"
        return Response(
            content=output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename_prefix}_report_{date.today().isoformat()}.csv"}
        )
