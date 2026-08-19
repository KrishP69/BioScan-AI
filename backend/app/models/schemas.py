from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Optional, List, Dict, Any

class StudentRegisterRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    roll_number: str = Field(..., min_length=1, max_length=50)
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=128)
    confirm_password: str = Field(..., min_length=6, max_length=128)
    department: str = Field(..., min_length=2, max_length=100)
    class_name: str = Field(..., min_length=1, max_length=50)
    division: str = Field(..., min_length=1, max_length=20)

    @field_validator("confirm_password")
    @classmethod
    def passwords_match(cls, v, values):
        if "password" in values.data and v != values.data["password"]:
            raise ValueError("Password and confirmation password do not match.")
        return v

class StudentLoginRequest(BaseModel):
    email: EmailStr
    password: str

class AdminLoginRequest(BaseModel):
    username: str
    password: str

class AdminPasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=6)
    confirm_password: str = Field(..., min_length=6)

    @field_validator("confirm_password")
    @classmethod
    def passwords_match(cls, v, values):
        if "new_password" in values.data and v != values.data["new_password"]:
            raise ValueError("New password and confirmation password do not match.")
        return v

class FaceRegisterRequest(BaseModel):
    face_embedding: List[float]
    preview_image: str  # Data URL / Base64 string

class FaceReviewRequest(BaseModel):
    rejection_reason: Optional[str] = None

class SessionCreateRequest(BaseModel):
    subject_id: int
    session_name: str
    date: str
    start_time: str
    end_time: str
    class_name: str
    division: str

class LiveAttendanceMarkRequest(BaseModel):
    session_id: int
    face_embedding: List[float]
    liveness_score: Optional[float] = 1.0

class StudentStatusUpdateRequest(BaseModel):
    account_status: str  # "active" or "disabled"

class SubjectCreateRequest(BaseModel):
    code: str
    name: str
    department: str
    semester: int = 1

class SettingsUpdateRequest(BaseModel):
    similarity_threshold: Optional[float] = None
    liveness_threshold: Optional[float] = None
    college_name: Optional[str] = None
    academic_year: Optional[str] = None
