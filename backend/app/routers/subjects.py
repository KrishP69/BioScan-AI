from fastapi import APIRouter, HTTPException, status, Depends, Request
from typing import Dict, Any, List
from app.models.schemas import SubjectCreateRequest
from app.database import get_db
from app.auth import get_current_user, require_admin
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/api/subjects", tags=["Subjects"])

@router.get("")
def list_subjects(current_user: Dict[str, Any] = Depends(get_current_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, code, name, department, semester, created_at FROM subjects ORDER BY code ASC")
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
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM subjects WHERE code = ?", (code_clean,))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail=f"Subject with code '{code_clean}' already exists.")
            
        cursor.execute("""
            INSERT INTO subjects (code, name, department, semester)
            VALUES (?, ?, ?, ?)
        """, (code_clean, name_clean, req.department.strip(), req.semester))
        subject_id = cursor.lastrowid
        
        client_ip = request.client.host if request.client else None
        log_audit_event("SUBJECT_CREATED", f"Admin created subject '{code_clean} - {name_clean}'.", current_user["id"], client_ip, conn=conn)
        
        return {
            "success": True,
            "message": f"Subject '{name_clean}' ({code_clean}) added successfully.",
            "subject_id": subject_id
        }

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
