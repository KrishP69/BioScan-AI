from fastapi import APIRouter, HTTPException, status, Request, Depends
from app.models.schemas import (
    StudentRegisterRequest,
    StudentLoginRequest,
    AdminLoginRequest,
    AdminPasswordChangeRequest
)
from app.database import get_db
from app.auth import hash_password, verify_password, create_access_token, get_current_user
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

@router.post("/register")
def register_student(req: StudentRegisterRequest, request: Request):
    """
    Public student registration endpoint.
    ALWAYS assigns role = 'student', account_status = 'active', face_status = 'not_registered'.
    """
    email_clean = req.email.lower().strip()
    roll_clean = req.roll_number.strip()
    name_clean = req.name.strip()
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Check unique email
        cursor.execute("SELECT id FROM users WHERE LOWER(email) = ?", (email_clean,))
        if cursor.fetchone():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="An account with this email address already exists."
            )
            
        # Check unique roll number
        cursor.execute("SELECT id FROM students WHERE roll_number = ?", (roll_clean,))
        if cursor.fetchone():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Roll number '{roll_clean}' is already registered with another student."
            )
            
        # Create user account with role = 'student'
        pwd_hash = hash_password(req.password)
        cursor.execute("""
            INSERT INTO users (email, password_hash, role)
            VALUES (?, ?, 'student')
        """, (email_clean, pwd_hash))
        user_id = cursor.lastrowid
        
        # Create student profile
        cursor.execute("""
            INSERT INTO students (user_id, name, roll_number, department, class_name, division, account_status, face_status)
            VALUES (?, ?, ?, ?, ?, ?, 'active', 'not_registered')
        """, (user_id, name_clean, roll_clean, req.department.strip(), req.class_name.strip(), req.division.strip()))
        student_id = cursor.lastrowid
        
        # Issue JWT access token
        token_payload = {
            "user_id": user_id,
            "role": "student",
            "email": email_clean,
            "student_id": student_id,
            "name": name_clean,
            "roll_number": roll_clean
        }
        token = create_access_token(token_payload)
        
        # Audit log
        client_ip = request.client.host if request.client else None
        log_audit_event("STUDENT_REGISTER", f"Student '{name_clean}' (Roll: {roll_clean}) registered account.", user_id, client_ip, conn=conn)
        
        return {
            "success": True,
            "message": "Account created successfully. You can now access your dashboard.",
            "token": token,
            "user": {
                "id": user_id,
                "email": email_clean,
                "role": "student",
                "student": {
                    "id": student_id,
                    "name": name_clean,
                    "roll_number": roll_clean,
                    "department": req.department,
                    "class_name": req.class_name,
                    "division": req.division,
                    "account_status": "active",
                    "face_status": "not_registered"
                }
            }
        }

@router.post("/login")
def login_student(req: StudentLoginRequest, request: Request):
    """
    Student login endpoint using Email and Password.
    """
    email_clean = req.email.lower().strip()
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT u.id, u.email, u.password_hash, u.role,
                   s.id as student_id, s.name, s.roll_number, s.department, s.class_name, s.division,
                   s.account_status, s.face_status
            FROM users u
            JOIN students s ON u.id = s.user_id
            WHERE LOWER(u.email) = ? AND u.role = 'student'
        """, (email_clean,))
        row = cursor.fetchone()
        
        if not row or not verify_password(req.password, row["password_hash"]):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid student email or password."
            )
            
        if row["account_status"] == "disabled":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your account has been disabled by an administrator. Please contact college admin."
            )
            
        token_payload = {
            "user_id": row["id"],
            "role": "student",
            "email": row["email"],
            "student_id": row["student_id"],
            "name": row["name"],
            "roll_number": row["roll_number"]
        }
        token = create_access_token(token_payload)
        
        client_ip = request.client.host if request.client else None
        log_audit_event("STUDENT_LOGIN", f"Student '{row['name']}' logged in.", row["id"], client_ip, conn=conn)
        
        return {
            "success": True,
            "message": "Login successful.",
            "token": token,
            "user": {
                "id": row["id"],
                "email": row["email"],
                "role": "student",
                "student": {
                    "id": row["student_id"],
                    "name": row["name"],
                    "roll_number": row["roll_number"],
                    "department": row["department"],
                    "class_name": row["class_name"],
                    "division": row["division"],
                    "account_status": row["account_status"],
                    "face_status": row["face_status"]
                }
            }
        }

@router.post("/admin/login")
def login_admin(req: AdminLoginRequest, request: Request):
    """
    Admin login endpoint using Username and Password.
    """
    username_clean = req.username.strip()
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, username, email, password_hash, role
            FROM users
            WHERE (username = ? OR LOWER(email) = ?) AND role = 'admin'
        """, (username_clean, username_clean.lower()))
        row = cursor.fetchone()
        
        if not row or not verify_password(req.password, row["password_hash"]):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid administrator credentials."
            )
            
        # Check if default credentials ('admin' / 'admin') are used
        is_default_password = (req.username == "admin" and req.password == "admin")
        
        token_payload = {
            "user_id": row["id"],
            "role": "admin",
            "username": row["username"] or "admin",
            "email": row["email"]
        }
        token = create_access_token(token_payload)
        
        client_ip = request.client.host if request.client else None
        log_audit_event("ADMIN_LOGIN", f"Admin '{row['username']}' logged in.", row["id"], client_ip, conn=conn)
        
        return {
            "success": True,
            "message": "Admin login successful.",
            "token": token,
            "is_default_password": is_default_password,
            "user": {
                "id": row["id"],
                "username": row["username"],
                "email": row["email"],
                "role": "admin"
            }
        }

@router.get("/me")
def get_current_user_profile(current_user: dict = Depends(get_current_user)):
    """
    Returns verified profile data for current authenticated user.
    """
    return {
        "success": True,
        "user": current_user
    }
