import json
from datetime import datetime, date, timedelta
from app.database import get_db
from app.auth import hash_password

def seed_database():
    with get_db() as conn:
        cursor = conn.cursor()
        
        # 1. Ensure Admin Account
        cursor.execute("SELECT id FROM users WHERE username = 'admin' OR role = 'admin'")
        admin_user = cursor.fetchone()
        
        admin_id = None
        if not admin_user:
            admin_pwd_hash = hash_password("admin")
            cursor.execute("""
                INSERT INTO users (username, email, password_hash, role)
                VALUES (?, ?, ?, ?)
            """, ("admin", "admin@college.edu", admin_pwd_hash, "admin"))
            admin_id = cursor.lastrowid
            print("[OK] Default Admin account created: username='admin', password='admin'")
        else:
            admin_id = admin_user["id"]

        # 2. Seed Default Subjects
        subjects_data = [
            ("DBMS", "Database Management Systems", "Computer Engineering", 5),
            ("CN", "Computer Networks", "Computer Engineering", 5),
            ("OS", "Operating Systems", "Computer Engineering", 5),
            ("JAVA", "Java Programming", "Computer Engineering", 5),
            ("AI", "Artificial Intelligence & ML", "Computer Engineering", 5),
        ]
        
        for code, name, dept, sem in subjects_data:
            cursor.execute("SELECT id FROM subjects WHERE code = ?", (code,))
            if not cursor.fetchone():
                cursor.execute("""
                    INSERT INTO subjects (code, name, department, semester)
                    VALUES (?, ?, ?, ?)
                """, (code, name, dept, sem))
        
        # 3. Seed Default System Settings
        settings_data = [
            ("similarity_threshold", "0.50"),
            ("liveness_threshold", "0.50"),
            ("college_name", "National Institute of Technology & Engineering"),
            ("academic_year", "2025-2026"),
            ("default_admin_warning_dismissed", "0")
        ]
        for key, val in settings_data:
            cursor.execute("SELECT key FROM system_settings WHERE key = ?", (key,))
            if not cursor.fetchone():
                cursor.execute("INSERT INTO system_settings (key, value) VALUES (?, ?)", (key, val))

        # 4. No demo students or demo sessions - keep clean for user's own data
        print("[OK] Database verified: Admin account, subjects, and settings ready.")

