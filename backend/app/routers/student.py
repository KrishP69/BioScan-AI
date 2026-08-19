import json
from fastapi import APIRouter, HTTPException, status, Depends, Request
from typing import Dict, Any, List, Optional
from app.models.schemas import FaceRegisterRequest
from app.database import get_db
from app.auth import require_student, hash_password
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/api/student", tags=["Student"])

@router.get("/dashboard")
def get_student_dashboard(current_user: Dict[str, Any] = Depends(require_student)):
    student = current_user.get("student")
    if not student:
        raise HTTPException(status_code=404, detail="Student profile not found.")
    
    student_id = student.get("id") or student.get("student_id")
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        # 1. Fetch live student record to ensure up-to-date face_status
        cursor.execute("""
            SELECT id, name, roll_number, department, class_name, division, account_status, face_status
            FROM students WHERE id = ?
        """, (student_id,))
        fresh_student = dict(cursor.fetchone())
        
        # 2. Check if student has pending face registration with details
        cursor.execute("""
            SELECT id, status, submitted_at, rejection_reason
            FROM pending_faces
            WHERE student_id = ?
            ORDER BY submitted_at DESC LIMIT 1
        """, (student_id,))
        pending_row = cursor.fetchone()
        latest_submission = dict(pending_row) if pending_row else None
        
        # 3. Subject-wise attendance calculation
        # First get all subjects in student's department/curriculum
        cursor.execute("""
            SELECT id, code, name, department, semester FROM subjects ORDER BY name ASC
        """)
        all_subjects = cursor.fetchall()
        
        # Total classes conducted per subject
        subject_stats = []
        total_conducted_all = 0
        total_attended_all = 0
        
        for subj in all_subjects:
            s_id = subj["id"]
            
            # Count total sessions conducted for this subject
            cursor.execute("""
                SELECT COUNT(DISTINCT id) as total_sessions
                FROM attendance_sessions
                WHERE subject_id = ?
            """, (s_id,))
            session_cnt = cursor.fetchone()["total_sessions"]
            
            # Count records attended by this student for this subject
            cursor.execute("""
                SELECT COUNT(*) as attended_cnt
                FROM attendance_records
                WHERE student_id = ? AND subject_id = ? AND status IN ('present', 'late')
            """, (student_id, s_id))
            attended_cnt = cursor.fetchone()["attended_cnt"]
            
            # If total_sessions is 0, base on records if any exists or default to attended_cnt
            effective_total = max(session_cnt, attended_cnt, 10 if attended_cnt > 0 else 0)
            
            if effective_total > 0:
                percentage = round((attended_cnt / effective_total) * 100.0, 1)
            else:
                percentage = 0.0
                
            subject_stats.append({
                "subject_id": s_id,
                "code": subj["code"],
                "name": subj["name"],
                "attended": attended_cnt,
                "total": effective_total,
                "missed": max(0, effective_total - attended_cnt),
                "percentage": percentage
            })
            
            total_conducted_all += effective_total
            total_attended_all += attended_cnt

        total_missed_all = max(0, total_conducted_all - total_attended_all)
        overall_percentage = round((total_attended_all / total_conducted_all * 100.0), 1) if total_conducted_all > 0 else 0.0
        
        # 4. Recent attendance records
        cursor.execute("""
            SELECT ar.id, ar.attendance_date, ar.attendance_time, ar.status, 
                   ar.recognition_confidence, ar.liveness_score,
                   sub.code as subject_code, sub.name as subject_name
            FROM attendance_records ar
            JOIN subjects sub ON ar.subject_id = sub.id
            WHERE ar.student_id = ?
            ORDER BY ar.attendance_date DESC, ar.attendance_time DESC
            LIMIT 10
        """, (student_id,))
        recent_records = [dict(r) for r in cursor.fetchall()]

        return {
            "success": True,
            "student": fresh_student,
            "latest_submission": latest_submission,
            "metrics": {
                "overall_percentage": overall_percentage,
                "classes_attended": total_attended_all,
                "total_classes": total_conducted_all,
                "classes_missed": total_missed_all
            },
            "subject_attendance": subject_stats,
            "recent_records": recent_records
        }

@router.post("/face-register")
def submit_face_registration(
    req: FaceRegisterRequest, 
    request: Request, 
    current_user: Dict[str, Any] = Depends(require_student)
):
    student = current_user.get("student")
    if not student:
        raise HTTPException(status_code=404, detail="Student profile not found.")
        
    student_id = student.get("id") or student.get("student_id")
    
    if len(req.face_embedding) < 16:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid face biometric descriptors provided. Please ensure your face is clearly visible."
        )
        
    if not req.preview_image or len(req.preview_image) < 50:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Face preview image is required."
        )

    with get_db() as conn:
        cursor = conn.cursor()
        
        # Insert pending face request
        embedding_json = json.dumps(req.face_embedding)
        cursor.execute("""
            INSERT INTO pending_faces (student_id, face_embedding, preview_reference, status)
            VALUES (?, ?, ?, 'pending')
        """, (student_id, embedding_json, req.preview_image))
        
        # Update student face status to 'pending'
        cursor.execute("""
            UPDATE students
            SET face_status = 'pending', updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (student_id,))
        
        client_ip = request.client.host if request.client else None
        log_audit_event("FACE_REGISTRATION_SUBMITTED", f"Student '{student['name']}' (Roll: {student['roll_number']}) submitted face capture for approval.", current_user["id"], client_ip, conn=conn)
        
        return {
            "success": True,
            "message": "Face registration submitted successfully! It is now waiting for administrator review and approval.",
            "face_status": "pending"
        }

@router.get("/attendance")
def get_student_attendance_history(
    subject_id: Optional[int] = None,
    current_user: Dict[str, Any] = Depends(require_student)
):
    """
    Returns verified attendance records strictly for the requesting student.
    Prevents unauthorized access to other students' records.
    """
    student_id = current_user["student"]["id"]
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        query = """
            SELECT ar.id, ar.attendance_date, ar.attendance_time, ar.status, 
                   ar.recognition_confidence, ar.liveness_score,
                   sub.code as subject_code, sub.name as subject_name,
                   ses.session_name
            FROM attendance_records ar
            JOIN subjects sub ON ar.subject_id = sub.id
            LEFT JOIN attendance_sessions ses ON ar.session_id = ses.id
            WHERE ar.student_id = ?
        """
        params = [student_id]
        
        if subject_id:
            query += " AND ar.subject_id = ?"
            params.append(subject_id)
            
        query += " ORDER BY ar.attendance_date DESC, ar.attendance_time DESC"
        
        cursor.execute(query, tuple(params))
        records = [dict(r) for r in cursor.fetchall()]
        
        return {
            "success": True,
            "records": records,
            "total": len(records)
        }
