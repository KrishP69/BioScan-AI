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
                   (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id = ses.id) as attendance_count
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
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    current_user: Dict[str, Any] = Depends(require_admin)
):
    with get_db() as conn:
        cursor = conn.cursor()
        
        query = """
            SELECT ar.id, ar.attendance_date, ar.attendance_time, ar.status, 
                   ar.recognition_confidence, ar.liveness_score, ar.created_at,
                   s.name as student_name, s.roll_number, s.department, s.class_name, s.division,
                   sub.code as subject_code, sub.name as subject_name,
                   ses.session_name
            FROM attendance_records ar
            JOIN students s ON ar.student_id = s.id
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
    current_user: Dict[str, Any] = Depends(require_admin)
):
    with get_db() as conn:
        cursor = conn.cursor()
        query = """
            SELECT ar.id, ar.attendance_date, ar.attendance_time, ar.status, 
                   ar.recognition_confidence, ar.liveness_score,
                   s.name as student_name, s.roll_number, s.department, s.class_name, s.division,
                   sub.code as subject_code, sub.name as subject_name,
                   ses.session_name
            FROM attendance_records ar
            JOIN students s ON ar.student_id = s.id
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
        query += " ORDER BY ar.attendance_date DESC, ar.attendance_time DESC"
        
        cursor.execute(query, tuple(params))
        rows = cursor.fetchall()
        
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["ID", "Roll Number", "Student Name", "Department", "Class", "Division", "Subject Code", "Subject Name", "Session", "Date", "Time", "Status", "Confidence (%)", "Liveness"])
        
        for r in rows:
            writer.writerow([
                r["id"],
                r["roll_number"],
                r["student_name"],
                r["department"],
                r["class_name"],
                r["division"],
                r["subject_code"],
                r["subject_name"],
                r["session_name"] or "N/A",
                r["attendance_date"],
                r["attendance_time"],
                r["status"],
                r["recognition_confidence"],
                r["liveness_score"]
            ])
            
        output.seek(0)
        return Response(
            content=output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=attendance_report_{date.today().isoformat()}.csv"}
        )
