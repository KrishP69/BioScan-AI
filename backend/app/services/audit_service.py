import sqlite3
from typing import Optional
from app.database import get_db

def log_audit_event(
    action: str,
    details: str,
    user_id: Optional[int] = None,
    ip_address: Optional[str] = None,
    conn: Optional[sqlite3.Connection] = None
):
    try:
        if conn is not None:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO audit_logs (user_id, action, details, ip_address)
                VALUES (?, ?, ?, ?)
            """, (user_id, action, details, ip_address))
        else:
            with get_db() as new_conn:
                cursor = new_conn.cursor()
                cursor.execute("""
                    INSERT INTO audit_logs (user_id, action, details, ip_address)
                    VALUES (?, ?, ?, ?)
                """, (user_id, action, details, ip_address))
    except Exception as e:
        print(f"Error writing audit log: {e}")
