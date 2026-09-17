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

        # 2. Seed Default Subjects for All Engineering Branches
        subjects_data = [
            # Computer Engineering (CSE)
            ("DBMS", "Database Management Systems", "Computer Engineering", 5),
            ("CN", "Computer Networks", "Computer Engineering", 5),
            ("OS", "Operating Systems", "Computer Engineering", 5),
            ("JAVA", "Java Programming", "Computer Engineering", 5),
            ("AI", "Artificial Intelligence & ML", "Computer Engineering", 5),

            # Information Technology (IT)
            ("WAD", "Web Application Development", "Information Technology", 5),
            ("CNS", "Cryptography & Network Security", "Information Technology", 5),
            ("CC", "Cloud Computing & DevOps", "Information Technology", 5),
            ("BDA", "Big Data Analytics", "Information Technology", 5),
            ("SE", "Software Engineering & Agile", "Information Technology", 5),

            # Electronics & Telecom (ENTC)
            ("DSP", "Digital Signal Processing", "Electronics & Telecom", 5),
            ("VLSI", "CMOS VLSI Design", "Electronics & Telecom", 5),
            ("EMFT", "Electromagnetic Fields & Antennas", "Electronics & Telecom", 5),
            ("MC", "Microcontrollers & Embedded Systems", "Electronics & Telecom", 5),
            ("CS", "Control Systems Engineering", "Electronics & Telecom", 5),

            # Mechanical Engineering (MECH)
            ("TOM", "Theory of Machines", "Mechanical Engineering", 5),
            ("HT", "Heat & Mass Transfer", "Mechanical Engineering", 5),
            ("DME", "Design of Machine Elements", "Mechanical Engineering", 5),
            ("MFG", "Advanced Manufacturing Technology", "Mechanical Engineering", 5),
            ("CAD", "CAD/CAM & Finite Element Analysis", "Mechanical Engineering", 5),

            # All Branches / Common Curriculum
            ("PEHV", "Professional Ethics & Human Values", "All Branches", 1),
            ("CSK", "Communication & Soft Skills", "All Branches", 1),
        ]
        
        for code, name, dept, sem in subjects_data:
            cursor.execute("SELECT id FROM subjects WHERE code = ?", (code,))
            if not cursor.fetchone():
                cursor.execute("""
                    INSERT INTO subjects (code, name, department, semester)
                    VALUES (?, ?, ?, ?)
                """, (code, name, dept, sem))
            else:
                # Update department to ensure branch assignment is accurate
                cursor.execute("""
                    UPDATE subjects SET department = ?, name = ?, semester = ? WHERE code = ?
                """, (dept, name, sem, code))
        
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

