import json
import numpy as np
from typing import List, Dict, Any, Optional, Tuple
from app.database import get_db

def euclidean_distance(v1: List[float], v2: List[float]) -> float:
    a = np.array(v1, dtype=np.float32)
    b = np.array(v2, dtype=np.float32)
    return float(np.linalg.norm(a - b))

def cosine_similarity(v1: List[float], v2: List[float]) -> float:
    a = np.array(v1, dtype=np.float32)
    b = np.array(v2, dtype=np.float32)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))

def find_matching_student(
    query_embedding: List[float],
    distance_threshold: float = 0.55,
    liveness_score: float = 1.0
) -> Optional[Dict[str, Any]]:
    """
    Matches a query embedding against all verified student face profiles.
    Returns student match dictionary if distance < distance_threshold, else None.
    """
    if not query_embedding or len(query_embedding) < 32:
        return None

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT fp.student_id, fp.face_embedding, s.name, s.roll_number, s.department, 
                   s.class_name, s.division, s.account_status, s.face_status
            FROM face_profiles fp
            JOIN students s ON fp.student_id = s.id
            WHERE s.face_status = 'verified' AND s.account_status = 'active'
        """)
        profiles = cursor.fetchall()
        
        best_match = None
        min_distance = float("inf")

        for row in profiles:
            try:
                stored_embedding = json.loads(row["face_embedding"])
                dist = euclidean_distance(query_embedding, stored_embedding)
                if dist < min_distance:
                    min_distance = dist
                    best_match = row
            except Exception:
                continue

        if best_match and min_distance <= distance_threshold:
            # Convert Euclidean distance to confidence percentage (0 to 100%)
            confidence = max(0.0, min(100.0, (1.0 - (min_distance / distance_threshold)) * 100.0))
            return {
                "student_id": best_match["student_id"],
                "name": best_match["name"],
                "roll_number": best_match["roll_number"],
                "department": best_match["department"],
                "class_name": best_match["class_name"],
                "division": best_match["division"],
                "distance": round(min_distance, 4),
                "confidence": round(confidence, 2),
                "liveness_score": round(liveness_score, 2),
                "is_verified": True
            }
        
        return None
