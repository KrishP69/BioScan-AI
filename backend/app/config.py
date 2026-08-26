import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("DATA_DIR", BASE_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = Path(os.environ.get("DB_PATH", DATA_DIR / "attendance_system.db"))
TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL", "")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN", "")

SECRET_KEY = os.environ.get("JWT_SECRET", "super-secret-major-project-ai-face-attendance-key-2026")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

DEFAULT_SIMILARITY_THRESHOLD = 0.50  # Euclidean distance threshold (FaceNet standard <= 0.50)
DEFAULT_LIVENESS_THRESHOLD = 0.50
