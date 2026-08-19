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
            ("similarity_threshold", "0.55"),
            ("liveness_threshold", "0.50"),
            ("college_name", "National Institute of Technology & Engineering"),
            ("academic_year", "2025-2026"),
            ("default_admin_warning_dismissed", "0")
        ]
        for key, val in settings_data:
            cursor.execute("SELECT key FROM system_settings WHERE key = ?", (key,))
            if not cursor.fetchone():
                cursor.execute("INSERT INTO system_settings (key, value) VALUES (?, ?)", (key, val))

        # 4. Seed Demo Students (to showcase all face statuses)
        demo_students = [
            {
                "email": "priya@example.com",
                "name": "Priya Patel",
                "roll": "45",
                "dept": "Computer Engineering",
                "class": "TY-CSE",
                "div": "A",
                "face_status": "verified"
            },
            {
                "email": "rahul@example.com",
                "name": "Rahul Sharma",
                "roll": "23",
                "dept": "Computer Engineering",
                "class": "TY-CSE",
                "div": "A",
                "face_status": "pending"
            },
            {
                "email": "amit@example.com",
                "name": "Amit Verma",
                "roll": "12",
                "dept": "Computer Engineering",
                "class": "TY-CSE",
                "div": "B",
                "face_status": "verified"
            },
            {
                "email": "sneha@example.com",
                "name": "Sneha Gupta",
                "roll": "58",
                "dept": "Computer Engineering",
                "class": "TY-CSE",
                "div": "A",
                "face_status": "not_registered"
            }
        ]

        # Standard synthetic 128-d descriptor vectors for demo testing
        sample_embedding_priya = [(i * 0.007) % 0.1 for i in range(128)]
        sample_embedding_rahul = [((i + 5) * 0.008) % 0.1 for i in range(128)]
        sample_embedding_amit = [((i + 12) * 0.006) % 0.1 for i in range(128)]

        # Sample SVG Data URL for face preview
        demo_face_svg_rahul = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240' viewBox='0 0 240 240'><rect width='240' height='240' fill='%231e293b'/><circle cx='120' cy='95' r='50' fill='%2338bdf8'/><circle cx='105' cy='85' r='6' fill='%230f172a'/><circle cx='135' cy='85' r='6' fill='%230f172a'/><path d='M105 115 Q120 130 135 115' stroke='%230f172a' stroke-width='4' fill='none'/><path d='M60 210 Q120 160 180 210' fill='%2338bdf8'/><text x='120' y='232' font-family='sans-serif' font-size='12' fill='%2394a3b8' text-anchor='middle'>Rahul Sharma (Roll: 23)</text></svg>"
        demo_face_svg_priya = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240' viewBox='0 0 240 240'><rect width='240' height='240' fill='%231e293b'/><circle cx='120' cy='95' r='50' fill='%23f472b6'/><circle cx='105' cy='85' r='6' fill='%230f172a'/><circle cx='135' cy='85' r='6' fill='%230f172a'/><path d='M105 115 Q120 130 135 115' stroke='%230f172a' stroke-width='4' fill='none'/><path d='M60 210 Q120 160 180 210' fill='%23f472b6'/><text x='120' y='232' font-family='sans-serif' font-size='12' fill='%2394a3b8' text-anchor='middle'>Priya Patel (Roll: 45)</text></svg>"

        for st in demo_students:
            cursor.execute("SELECT id FROM users WHERE email = ?", (st["email"],))
            user_row = cursor.fetchone()
            if not user_row:
                pwd_hash = hash_password("student123")
                cursor.execute("""
                    INSERT INTO users (email, password_hash, role)
                    VALUES (?, ?, 'student')
                """, (st["email"], pwd_hash))
                uid = cursor.lastrowid
                
                cursor.execute("""
                    INSERT INTO students (user_id, name, roll_number, department, class_name, division, account_status, face_status)
                    VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
                """, (uid, st["name"], st["roll"], st["dept"], st["class"], st["div"], st["face_status"]))
                student_id = cursor.lastrowid

                # Attach face embeddings / pending entries
                if st["face_status"] == "verified":
                    emb = sample_embedding_priya if st["roll"] == "45" else sample_embedding_amit
                    cursor.execute("""
                        INSERT INTO face_profiles (student_id, face_embedding, model_version)
                        VALUES (?, ?, 'face-api-v1')
                    """, (student_id, json.dumps(emb)))
                elif st["face_status"] == "pending":
                    cursor.execute("""
                        INSERT INTO pending_faces (student_id, face_embedding, preview_reference, status)
                        VALUES (?, ?, ?, 'pending')
                    """, (student_id, json.dumps(sample_embedding_rahul), demo_face_svg_rahul))

        # 5. Seed Attendance Sessions & Records for demonstration analytics
        cursor.execute("SELECT id FROM subjects WHERE code = 'DBMS'")
        dbms_id = cursor.fetchone()["id"]
        cursor.execute("SELECT id FROM subjects WHERE code = 'CN'")
        cn_id = cursor.fetchone()["id"]
        cursor.execute("SELECT id FROM subjects WHERE code = 'OS'")
        os_id = cursor.fetchone()["id"]
        cursor.execute("SELECT id FROM subjects WHERE code = 'JAVA'")
        java_id = cursor.fetchone()["id"]

        today_str = date.today().isoformat()
        
        # Ensure an active session exists today
        cursor.execute("SELECT id FROM attendance_sessions WHERE date = ?", (today_str,))
        if not cursor.fetchone():
            cursor.execute("""
                INSERT INTO attendance_sessions (subject_id, session_name, date, start_time, end_time, class_name, division, status, created_by)
                VALUES (?, 'DBMS Regular Lecture', ?, '10:00', '11:00', 'TY-CSE', 'A', 'active', ?)
            """, (dbms_id, today_str, admin_id))
            active_session_id = cursor.lastrowid
            
            cursor.execute("""
                INSERT INTO attendance_sessions (subject_id, session_name, date, start_time, end_time, class_name, division, status, created_by)
                VALUES (?, 'Computer Networks Lab', ?, '11:15', '13:15', 'TY-CSE', 'A', 'active', ?)
            """, (cn_id, today_str, admin_id))

        # Seed sample historical attendance records for Priya Patel (Roll 45) to show 87.5% analytics
        cursor.execute("SELECT id FROM students WHERE roll_number = '45'")
        priya_row = cursor.fetchone()
        if priya_row:
            priya_id = priya_row["id"]
            cursor.execute("SELECT COUNT(*) as cnt FROM attendance_records WHERE student_id = ?", (priya_id,))
            if cursor.fetchone()["cnt"] == 0:
                # Seed 40 classes total, 35 attended, 5 missed
                subject_map = [
                    (dbms_id, 10, 9),   # 90%
                    (cn_id, 10, 8),     # 80%
                    (os_id, 12, 11),    # 92%
                    (java_id, 8, 7),    # 87.5%
                ]
                
                cur_date = date.today() - timedelta(days=30)
                for subj_id, total_classes, attended in subject_map:
                    for i in range(total_classes):
                        rec_date = (cur_date + timedelta(days=i)).isoformat()
                        if i < attended:
                            cursor.execute("""
                                INSERT OR IGNORE INTO attendance_records 
                                (student_id, subject_id, attendance_date, attendance_time, status, recognition_confidence, liveness_score)
                                VALUES (?, ?, ?, '10:15:00', 'present', 98.4, 0.96)
                            """, (priya_id, subj_id, rec_date))

        print("[OK] Database seeded successfully with initial administration, subjects, demo students and metrics.")
