import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

DB_PATH = DATA_DIR / "attendance_system.db"
SECRET_KEY = os.environ.get("JWT_SECRET", "super-secret-major-project-ai-face-attendance-key-2026")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

DEFAULT_SIMILARITY_THRESHOLD = 0.60  # Cosine/Euclidean distance threshold
DEFAULT_LIVENESS_THRESHOLD = 0.50
