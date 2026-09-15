import sqlite3
import json
from datetime import datetime
from contextlib import contextmanager
from app.config import DB_PATH, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN

class RowDict(dict):
    """Dictionary that also supports integer indexing like sqlite3.Row."""
    def __init__(self, columns, values):
        super().__init__(zip(columns, values))
        self._values = tuple(values)

    def __getitem__(self, key):
        if isinstance(key, int):
            return self._values[key]
        return super().__getitem__(key)

class LibsqlCursorWrapper:
    def __init__(self, cursor):
        self._cursor = cursor

    def __getattr__(self, name):
        return getattr(self._cursor, name)

    def _wrap_row(self, row):
        if row is None:
            return None
        if isinstance(row, (dict, sqlite3.Row)):
            return row
        if hasattr(self._cursor, "description") and self._cursor.description:
            cols = [d[0] for d in self._cursor.description]
            return RowDict(cols, row)
        return row

    def fetchone(self):
        row = self._cursor.fetchone()
        return self._wrap_row(row)

    def fetchall(self):
        rows = self._cursor.fetchall()
        if not rows:
            return []
        if hasattr(self._cursor, "description") and self._cursor.description:
            cols = [d[0] for d in self._cursor.description]
            return [RowDict(cols, r) if not isinstance(r, (dict, sqlite3.Row)) else r for r in rows]
        return rows

    def execute(self, *args, **kwargs):
        self._cursor.execute(*args, **kwargs)
        return self

class LibsqlConnectionWrapper:
    def __init__(self, conn):
        self._conn = conn

    def __getattr__(self, name):
        return getattr(self._conn, name)

    def cursor(self):
        return LibsqlCursorWrapper(self._conn.cursor())

    def execute(self, *args, **kwargs):
        cur = self.cursor()
        cur.execute(*args, **kwargs)
        return cur

def get_db_connection():
    if TURSO_DATABASE_URL and TURSO_AUTH_TOKEN:
        try:
            try:
                import libsql
                raw_conn = libsql.connect(TURSO_DATABASE_URL, auth_token=TURSO_AUTH_TOKEN)
            except ImportError:
                import libsql_experimental as libsql
                raw_conn = libsql.connect(TURSO_DATABASE_URL, auth_token=TURSO_AUTH_TOKEN)

            if hasattr(raw_conn, "row_factory"):
                raw_conn.row_factory = sqlite3.Row
                return raw_conn
            return LibsqlConnectionWrapper(raw_conn)
        except Exception as e:
            print(f"[Warning] Turso connection failed, falling back to local SQLite: {e}")
            
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False, timeout=20.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 20000")
    return conn

@contextmanager
def get_db():
    conn = get_db_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def init_db():
    with get_db() as conn:
        cursor = conn.cursor()
        
        # 1. Users table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE,
            username TEXT UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('student', 'admin')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)

        # 2. Students table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            name TEXT NOT NULL,
            roll_number TEXT NOT NULL UNIQUE,
            department TEXT NOT NULL,
            class_name TEXT NOT NULL,
            division TEXT NOT NULL,
            account_status TEXT NOT NULL DEFAULT 'active' CHECK(account_status IN ('active', 'disabled')),
            face_status TEXT NOT NULL DEFAULT 'not_registered' CHECK(face_status IN ('not_registered', 'pending', 'verified', 'rejected')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
        """)

        # 3. Face Profiles table (active verified embeddings)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS face_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL UNIQUE,
            face_embedding TEXT NOT NULL, -- JSON array of floats (128-d or 512-d)
            model_version TEXT DEFAULT 'face-api-v1',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE
        )
        """)

        # 4. Pending Faces table (webcam face capture submission queue)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS pending_faces (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            face_embedding TEXT NOT NULL, -- JSON array of floats
            preview_reference TEXT NOT NULL, -- Base64 data URL or storage path
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
            submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            reviewed_by INTEGER,
            reviewed_at TIMESTAMP,
            rejection_reason TEXT,
            FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE,
            FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL
        )
        """)

        # 5. Subjects table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS subjects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            department TEXT NOT NULL,
            semester INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)

        # 6. Attendance Sessions table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS attendance_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subject_id INTEGER NOT NULL,
            session_name TEXT NOT NULL,
            date TEXT NOT NULL, -- YYYY-MM-DD
            start_time TEXT NOT NULL, -- HH:MM
            end_time TEXT NOT NULL, -- HH:MM
            class_name TEXT NOT NULL,
            division TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'closed')),
            created_by INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (subject_id) REFERENCES subjects (id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
        )
        """)

        # 7. Attendance Records table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS attendance_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            subject_id INTEGER NOT NULL,
            session_id INTEGER,
            attendance_date TEXT NOT NULL, -- YYYY-MM-DD
            attendance_time TEXT NOT NULL, -- HH:MM:SS
            status TEXT NOT NULL DEFAULT 'present' CHECK(status IN ('present', 'late', 'absent')),
            recognition_confidence REAL DEFAULT 0.0,
            liveness_score REAL DEFAULT 1.0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE,
            FOREIGN KEY (subject_id) REFERENCES subjects (id) ON DELETE CASCADE,
            FOREIGN KEY (session_id) REFERENCES attendance_sessions (id) ON DELETE SET NULL,
            UNIQUE(student_id, session_id, attendance_date)
        )
        """)

        # 8. Audit Logs table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT NOT NULL,
            details TEXT,
            ip_address TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
        )
        """)

        # 9. System Settings table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS system_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)

        # Create helpful indexes
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_students_roll ON students(roll_number)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_pending_faces_status ON pending_faces(status)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_attendance_records_date ON attendance_records(attendance_date)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_attendance_student_subject ON attendance_records(student_id, subject_id)")
