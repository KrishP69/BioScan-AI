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

        # 2. Canonical branch normalization for existing subjects & students
        cursor.execute("UPDATE subjects SET department = 'CMPN' WHERE department IN ('Computer Engineering', 'CSE', 'Computer')")
        cursor.execute("UPDATE subjects SET department = 'INFT' WHERE department IN ('Information Technology', 'IT')")
        cursor.execute("UPDATE subjects SET department = 'EXTC' WHERE department IN ('Electronics & Telecommunication', 'Electronics & Telecom', 'EXTC')")
        cursor.execute("UPDATE subjects SET department = 'EXCS' WHERE department IN ('Electronics & Computer Science', 'EXCS')")

        cursor.execute("UPDATE students SET department = 'CMPN' WHERE department IN ('Computer Engineering', 'CSE', 'Computer')")
        cursor.execute("UPDATE students SET department = 'INFT' WHERE department IN ('Information Technology', 'IT')")
        cursor.execute("UPDATE students SET department = 'EXTC' WHERE department IN ('Electronics & Telecommunication', 'Electronics & Telecom', 'EXTC')")
        cursor.execute("UPDATE students SET department = 'EXCS' WHERE department IN ('Electronics & Computer Science', 'EXCS')")

        # 3. Initial Default Curriculum Subjects across all 4 branches:
        # CMPN: Computer Engineering
        # INFT: Information Technology
        # EXTC: Electronics & Telecommunication
        # EXCS: Electronics & Computer Science
        subjects_data = [
            # CMPN - Computer Engineering
            ("DBMS", "Database Management Systems", "CMPN", 5),
            ("CN", "Computer Networks", "CMPN", 5),
            ("OS", "Operating Systems", "CMPN", 5),
            ("TCS", "Theoretical Computer Science", "CMPN", 5),
            ("SE", "Software Engineering", "CMPN", 5),
            
            # INFT - Information Technology
            ("CNS", "Cryptography & Network Security", "INFT", 5),
            ("IP", "Internet Programming", "INFT", 5),
            ("ADMT", "Advanced Database Management", "INFT", 5),
            ("EEB", "E-Commerce & E-Business", "INFT", 5),
            ("AIDS", "Artificial Intelligence & Data Science", "INFT", 5),
            
            # EXTC - Electronics & Telecommunication
            ("DC", "Digital Communication", "EXTC", 5),
            ("DSP", "Discrete-Time Signal Processing", "EXTC", 5),
            ("EME", "Electromagnetic Engineering", "EXTC", 5),
            ("VLSID", "VLSI Design", "EXTC", 5),
            ("CS", "Control Systems", "EXTC", 5),
            
            # EXCS - Electronics & Computer Science
            ("COA", "Computer Organization & Architecture", "EXCS", 5),
            ("ESD", "Embedded Systems Design", "EXCS", 5),
            ("DCN", "Data Communication & Networks", "EXCS", 5),
            ("WT", "Web Technologies", "EXCS", 5),
            ("ML", "Machine Learning Fundamentals", "EXCS", 5),
        ]
        
        for code, name, dept, sem in subjects_data:
            cursor.execute("SELECT id FROM subjects WHERE code = ?", (code,))
            row = cursor.fetchone()
            if not row:
                cursor.execute("""
                    INSERT INTO subjects (code, name, department, semester)
                    VALUES (?, ?, ?, ?)
                """, (code, name, dept, sem))
            else:
                cursor.execute("UPDATE subjects SET department = ?, name = ? WHERE code = ?", (dept, name, code))
        
        # 4. Reset Krish's student data as requested
        cursor.execute("""
            SELECT s.id as student_id, s.user_id 
            FROM students s
            JOIN users u ON s.user_id = u.id
            WHERE s.name LIKE '%Krish%' OR s.roll_number = '24101B0025' OR LOWER(u.email) LIKE '%krish%'
        """)
        krish_rows = cursor.fetchall()
        for kr in krish_rows:
            sid = kr["student_id"]
            uid = kr["user_id"]
            cursor.execute("DELETE FROM attendance_records WHERE student_id = ?", (sid,))
            cursor.execute("DELETE FROM pending_faces WHERE student_id = ?", (sid,))
            cursor.execute("DELETE FROM face_profiles WHERE student_id = ?", (sid,))
            cursor.execute("DELETE FROM students WHERE id = ?", (sid,))
            cursor.execute("DELETE FROM users WHERE id = ?", (uid,))
            print(f"[OK] Krish Patil data completely reset (student_id={sid}, user_id={uid}).")

        # Also purge any leftover user accounts matching krish
        cursor.execute("DELETE FROM users WHERE LOWER(email) LIKE '%krish%' OR LOWER(username) LIKE '%krish%'")

        # 5. Clean up old test sessions (TY-CSE / CSK / All Branches)
        cursor.execute("DELETE FROM attendance_records WHERE session_id IN (SELECT id FROM attendance_sessions WHERE class_name LIKE '%CSE%' OR session_name LIKE '%CSK%' OR division NOT IN ('A', 'B', 'C'))")
        cursor.execute("DELETE FROM attendance_sessions WHERE class_name LIKE '%CSE%' OR session_name LIKE '%CSK%' OR division NOT IN ('A', 'B', 'C')")

        # 6. Seed Default System Settings
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

        print("[OK] Database verified: Admin account, 4 branches (CMPN, INFT, EXTC, EXCS) subjects, and settings ready.")

