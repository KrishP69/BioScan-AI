from fastapi import APIRouter, HTTPException, status, Depends, Request
from typing import Dict, Any, List, Optional
from app.models.schemas import SubjectCreateRequest
from app.database import get_db
from app.auth import get_current_user, require_admin
from app.services.audit_service import log_audit_event
from app.config import normalize_branch

router = APIRouter(prefix="/api/subjects", tags=["Subjects"])

@router.get("")
def list_subjects(
    department: Optional[str] = None,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    with get_db() as conn:
        cursor = conn.cursor()
        
        # If student and no department passed, default to student's department
        if current_user.get("role") == "student" and not department:
            student = current_user.get("student") or {}
            department = student.get("department")
            
        if department and department.strip().lower() not in ("all", "all branches"):
            norm_dept = normalize_branch(department)
            cursor.execute("""
                SELECT id, code, name, department, semester, created_at 
                FROM subjects 
                WHERE department = ? OR LOWER(TRIM(department)) = LOWER(TRIM(?)) 
                ORDER BY code ASC
            """, (norm_dept, department.strip()))
        else:
            cursor.execute("SELECT id, code, name, department, semester, created_at FROM subjects ORDER BY department ASC, code ASC")
            
        subjects = [dict(r) for r in cursor.fetchall()]
        return {"success": True, "subjects": subjects}

@router.post("")
def create_subject(
    req: SubjectCreateRequest,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_admin)
):
    code_clean = req.code.upper().strip()
    name_clean = req.name.strip()
    dept_clean = normalize_branch(req.department)
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM subjects WHERE code = ?", (code_clean,))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail=f"Subject with code '{code_clean}' already exists.")
            
        cursor.execute("""
            INSERT INTO subjects (code, name, department, semester)
            VALUES (?, ?, ?, ?)
        """, (code_clean, name_clean, dept_clean, req.semester))
        subject_id = cursor.lastrowid
        
        client_ip = request.client.host if request.client else None
        log_audit_event("SUBJECT_CREATED", f"Admin created subject '{code_clean} - {name_clean}' (Branch: {dept_clean}).", current_user["id"], client_ip, conn=conn)
        
        return {
            "success": True,
            "message": f"Subject '{name_clean}' ({code_clean}) added successfully for {dept_clean}.",
            "subject_id": subject_id
        }

@router.put("/{subject_id}")
def update_subject(
    subject_id: int,
    req: SubjectCreateRequest,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_admin)
):
    code_clean = req.code.upper().strip()
    name_clean = req.name.strip()
    dept_clean = req.department.strip()
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, code, name FROM subjects WHERE id = ?", (subject_id,))
        existing = cursor.fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Subject not found.")
            
        cursor.execute("SELECT id FROM subjects WHERE code = ? AND id != ?", (code_clean, subject_id))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail=f"Another subject with code '{code_clean}' already exists.")
            
        cursor.execute("""
            UPDATE subjects 
            SET code = ?, name = ?, department = ?, semester = ?
            WHERE id = ?
        """, (code_clean, name_clean, dept_clean, req.semester, subject_id))
        
        client_ip = request.client.host if request.client else None
        log_audit_event("SUBJECT_UPDATED", f"Admin updated subject '{code_clean} - {name_clean}' (Branch: {dept_clean}).", current_user["id"], client_ip, conn=conn)
        
        return {"success": True, "message": f"Subject '{name_clean}' ({code_clean}) updated successfully."}

@router.delete("/{subject_id}")
def delete_subject(
    subject_id: int,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_admin)
):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT code, name FROM subjects WHERE id = ?", (subject_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Subject not found.")
            
        cursor.execute("DELETE FROM subjects WHERE id = ?", (subject_id,))
        
        client_ip = request.client.host if request.client else None
        log_audit_event("SUBJECT_DELETED", f"Admin removed subject '{row['code']} - {row['name']}'.", current_user["id"], client_ip, conn=conn)
        
        return {"success": True, "message": f"Subject {row['code']} deleted."}
