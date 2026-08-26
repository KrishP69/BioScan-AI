import json
from datetime import datetime, date, timedelta
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, HTTPException, status, Depends, Request
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
        
        # 1. Fetch live student record to ensure up-to-date face_status & class details
        cursor.execute("""
            SELECT id, name, roll_number, department, class_name, division, account_status, face_status
            FROM students WHERE id = ?
        """, (student_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Student record not found.")
        fresh_student = dict(row)
        
        student_class = (fresh_student.get("class_name") or "").strip()
        student_div = (fresh_student.get("division") or "").strip()
        
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
        cursor.execute("""
            SELECT id, code, name, department, semester FROM subjects ORDER BY name ASC
        """)
        all_subjects = cursor.fetchall()
        
        subject_stats = []
        total_conducted_all = 0
        total_attended_all = 0
        
        for subj in all_subjects:
            s_id = subj["id"]
            
            # Count total sessions conducted for this subject matching student's class & division, OR attended by this student
            cursor.execute("""
                SELECT COUNT(DISTINCT id) as total_sessions
                FROM attendance_sessions
                WHERE subject_id = ?
                  AND (
                    (
                      (LOWER(TRIM(class_name)) = LOWER(?) OR LOWER(TRIM(class_name)) LIKE '%' || LOWER(?) || '%')
                      AND (LOWER(TRIM(division)) = LOWER(?) OR LOWER(TRIM(division)) = 'all' OR TRIM(division) = '')
                    )
                    OR id IN (SELECT session_id FROM attendance_records WHERE student_id = ? AND subject_id = ?)
                  )
            """, (s_id, student_class, student_class, student_div, student_id, s_id))
            session_cnt = cursor.fetchone()["total_sessions"] or 0
            
            # Count records attended by this student for this subject
            cursor.execute("""
                SELECT COUNT(*) as attended_cnt
                FROM attendance_records
                WHERE student_id = ? AND subject_id = ? AND status IN ('present', 'late')
            """, (student_id, s_id))
            attended_cnt = cursor.fetchone()["attended_cnt"] or 0
            
            # Actual total classes conducted for this subject for this student
            effective_total = max(session_cnt, attended_cnt)
            
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
        overall_percentage = round((total_attended_all / total_conducted_all * 100.0), 1) if total_conducted_all > 0 else (100.0 if total_attended_all > 0 else 0.0)
        
        # 4. Fetch all relevant sessions for this student (matching class/division OR attended)
        cursor.execute("""
            SELECT ses.id as session_id, ses.session_name, ses.date, ses.start_time, ses.end_time,
                   ses.class_name, ses.division, ses.status as session_status,
                   ses.subject_id, sub.code as subject_code, sub.name as subject_name,
                   ar.id as record_id, ar.attendance_date, ar.attendance_time, ar.status as attendance_status,
                   ar.recognition_confidence, ar.liveness_score
            FROM attendance_sessions ses
            JOIN subjects sub ON ses.subject_id = sub.id
            LEFT JOIN attendance_records ar ON ar.session_id = ses.id AND ar.student_id = ?
            WHERE (
              (
                (LOWER(TRIM(ses.class_name)) = LOWER(?) OR LOWER(TRIM(ses.class_name)) LIKE '%' || LOWER(?) || '%')
                AND (LOWER(TRIM(ses.division)) = LOWER(?) OR LOWER(TRIM(ses.division)) = 'all' OR TRIM(ses.division) = '')
              )
              OR ar.id IS NOT NULL
            )
            ORDER BY ses.date DESC, ses.start_time DESC
        """, (student_id, student_class, student_class, student_div))
        session_rows = [dict(r) for r in cursor.fetchall()]

        # 4A. Day-wise Breakdown
        days_map = {}
        for r in session_rows:
            d_str = r["date"]
            if d_str not in days_map:
                try:
                    dt = datetime.strptime(d_str, "%Y-%m-%d")
                    day_name = dt.strftime("%A")
                    formatted_date = dt.strftime("%d %b %Y")
                except Exception:
                    day_name = "Day"
                    formatted_date = d_str
                days_map[d_str] = {
                    "date": d_str,
                    "day_name": day_name,
                    "formatted_date": formatted_date,
                    "total_lectures": 0,
                    "attended_lectures": 0,
                    "lectures": []
                }
            
            is_attended = bool(r["record_id"] and r["attendance_status"] in ("present", "late"))
            days_map[d_str]["total_lectures"] += 1
            if is_attended:
                days_map[d_str]["attended_lectures"] += 1
                
            days_map[d_str]["lectures"].append({
                "session_id": r["session_id"],
                "subject_code": r["subject_code"],
                "subject_name": r["subject_name"],
                "session_name": r["session_name"],
                "start_time": r["start_time"],
                "end_time": r["end_time"],
                "class_name": r["class_name"],
                "division": r["division"],
                "session_status": r["session_status"],
                "status": "present" if is_attended else ("in_progress" if r["session_status"] == "active" else "absent"),
                "attendance_time": r["attendance_time"],
                "confidence": r["recognition_confidence"],
                "liveness_score": r["liveness_score"]
            })
            
        day_wise_list = []
        for d_str, d_val in sorted(days_map.items(), key=lambda x: x[0], reverse=True):
            tot = d_val["total_lectures"]
            att = d_val["attended_lectures"]
            d_val["day_percentage"] = round((att / tot * 100.0), 1) if tot > 0 else 0.0
            day_wise_list.append(d_val)

        # 4B. Week-wise Breakdown (Grouped by ISO calendar week)
        weeks_map = {}
        for r in session_rows:
            d_str = r["date"]
            try:
                dt = datetime.strptime(d_str, "%Y-%m-%d")
                year, week_num, _ = dt.isocalendar()
                week_key = f"{year}-W{week_num:02d}"
                start_of_week = dt - timedelta(days=dt.weekday())
                end_of_week = start_of_week + timedelta(days=6)
                week_label = f"Week {week_num} ({start_of_week.strftime('%d %b')} - {end_of_week.strftime('%d %b %Y')})"
            except Exception:
                week_key = "current"
                week_label = "Current Week"

            if week_key not in weeks_map:
                weeks_map[week_key] = {
                    "week_key": week_key,
                    "week_label": week_label,
                    "total_lectures": 0,
                    "attended_lectures": 0,
                    "missed_lectures": 0,
                    "subjects": {}
                }

            is_attended = bool(r["record_id"] and r["attendance_status"] in ("present", "late"))
            weeks_map[week_key]["total_lectures"] += 1
            if is_attended:
                weeks_map[week_key]["attended_lectures"] += 1
            else:
                weeks_map[week_key]["missed_lectures"] += 1

            s_code = r["subject_code"]
            if s_code not in weeks_map[week_key]["subjects"]:
                weeks_map[week_key]["subjects"][s_code] = {
                    "code": s_code,
                    "name": r["subject_name"],
                    "total": 0,
                    "attended": 0
                }
            weeks_map[week_key]["subjects"][s_code]["total"] += 1
            if is_attended:
                weeks_map[week_key]["subjects"][s_code]["attended"] += 1

        week_wise_list = []
        for w_key, w_val in sorted(weeks_map.items(), key=lambda x: x[0], reverse=True):
            tot = w_val["total_lectures"]
            att = w_val["attended_lectures"]
            w_val["percentage"] = round((att / tot * 100.0), 1) if tot > 0 else 0.0
            w_val["subjects_list"] = list(w_val["subjects"].values())
            week_wise_list.append(w_val)

        # 4C. Month-wise Breakdown (Grouped by YYYY-MM)
        months_map = {}
        for r in session_rows:
            d_str = r["date"]
            try:
                dt = datetime.strptime(d_str, "%Y-%m-%d")
                month_key = dt.strftime("%Y-%m")
                month_label = dt.strftime("%B %Y")
            except Exception:
                month_key = "current"
                month_label = "Current Month"

            if month_key not in months_map:
                months_map[month_key] = {
                    "month_key": month_key,
                    "month_label": month_label,
                    "total_lectures": 0,
                    "attended_lectures": 0,
                    "missed_lectures": 0,
                    "subjects": {}
                }

            is_attended = bool(r["record_id"] and r["attendance_status"] in ("present", "late"))
            months_map[month_key]["total_lectures"] += 1
            if is_attended:
                months_map[month_key]["attended_lectures"] += 1
            else:
                months_map[month_key]["missed_lectures"] += 1

            s_code = r["subject_code"]
            if s_code not in months_map[month_key]["subjects"]:
                months_map[month_key]["subjects"][s_code] = {
                    "code": s_code,
                    "name": r["subject_name"],
                    "total": 0,
                    "attended": 0
                }
            months_map[month_key]["subjects"][s_code]["total"] += 1
            if is_attended:
                months_map[month_key]["subjects"][s_code]["attended"] += 1

        month_wise_list = []
        for m_key, m_val in sorted(months_map.items(), key=lambda x: x[0], reverse=True):
            tot = m_val["total_lectures"]
            att = m_val["attended_lectures"]
            m_val["percentage"] = round((att / tot * 100.0), 1) if tot > 0 else 0.0
            m_val["subjects_list"] = list(m_val["subjects"].values())
            month_wise_list.append(m_val)

        # 5. Recent attendance records
        cursor.execute("""
            SELECT ar.id, ar.attendance_date, ar.attendance_time, ar.status, 
                   ar.recognition_confidence, ar.liveness_score,
                   sub.code as subject_code, sub.name as subject_name,
                   ses.session_name
            FROM attendance_records ar
            JOIN subjects sub ON ar.subject_id = sub.id
            LEFT JOIN attendance_sessions ses ON ar.session_id = ses.id
            WHERE ar.student_id = ?
            ORDER BY ar.attendance_date DESC, ar.attendance_time DESC
            LIMIT 15
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
            "day_wise_attendance": day_wise_list,
            "week_wise_attendance": week_wise_list,
            "month_wise_attendance": month_wise_list,
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
    timeframe: Optional[str] = None,  # 'all', 'week', 'month'
    week: Optional[str] = None,       # '2026-W34'
    month: Optional[str] = None,      # '2026-08'
    current_user: Dict[str, Any] = Depends(require_student)
):
    """
    Returns verified attendance records strictly for the requesting student.
    Supports timeframe, week, and month filtering.
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
            
        if month:
            query += " AND ar.attendance_date LIKE ?"
            params.append(f"{month}%")
            
        query += " ORDER BY ar.attendance_date DESC, ar.attendance_time DESC"
        
        cursor.execute(query, tuple(params))
        all_records = [dict(r) for r in cursor.fetchall()]
        
        # If filtered by week in python
        if week:
            filtered = []
            for r in all_records:
                try:
                    dt = datetime.strptime(r["attendance_date"], "%Y-%m-%d")
                    y, w, _ = dt.isocalendar()
                    if f"{y}-W{w:02d}" == week:
                        filtered.append(r)
                except Exception:
                    filtered.append(r)
            all_records = filtered
        
        return {
            "success": True,
            "records": all_records,
            "total": len(all_records)
        }
