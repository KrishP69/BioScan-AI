import json
import numpy as np
from typing import List, Dict, Any, Optional
from app.database import get_db

def normalize_vector(v: List[float]) -> np.ndarray:
    arr = np.array(v, dtype=np.float32)
    norm = np.linalg.norm(arr)
    if norm > 1e-6:
        return arr / norm
    return arr

def euclidean_distance(v1: List[float], v2: List[float]) -> float:
    a = normalize_vector(v1)
    b = normalize_vector(v2)
    return float(np.linalg.norm(a - b))

def cosine_similarity(v1: List[float], v2: List[float]) -> float:
    a = normalize_vector(v1)
    b = normalize_vector(v2)
    return float(np.dot(a, b))

def find_matching_student(
    query_embedding: List[float],
    distance_threshold: float = 0.50,
    liveness_score: float = 1.0
) -> Optional[Dict[str, Any]]:
    """
    Matches a 128-d query face embedding against all verified active student face profiles.
    Uses normalized Euclidean distance and Cosine similarity for high-precision biometric matching.
    """
    if not query_embedding or len(query_embedding) < 32:
        return None

    query_norm = normalize_vector(query_embedding)

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
        
        if not profiles:
            return None

        best_match = None
        min_distance = float("inf")
        best_cos_sim = -1.0

        for row in profiles:
            try:
                raw_emb = row["face_embedding"]
                stored_embedding = json.loads(raw_emb) if isinstance(raw_emb, str) else raw_emb
                stored_norm = normalize_vector(stored_embedding)

                # Compute Euclidean distance and Cosine similarity
                dist = float(np.linalg.norm(query_norm - stored_norm))
                cos_sim = float(np.dot(query_norm, stored_norm))

                # Track best candidate by minimum Euclidean distance
                if dist < min_distance:
                    min_distance = dist
                    best_cos_sim = cos_sim
                    best_match = row
            except Exception:
                continue

        # Strictly match if minimum distance is within the distance threshold
        if best_match and min_distance <= distance_threshold:
            confidence = round(
                max(60.0, min(99.9, ((best_cos_sim + 1.0) / 2.0) * 100.0 if best_cos_sim > 0 else (1.0 - (min_distance / 1.414)) * 100.0)),
                1
            )
            return {
                "student_id": best_match["student_id"],
                "name": best_match["name"],
                "roll_number": best_match["roll_number"],
                "department": best_match["department"],
                "class_name": best_match["class_name"],
                "division": best_match["division"],
                "distance": round(min_distance, 4),
                "confidence": confidence,
                "liveness_score": round(liveness_score, 2),
                "is_verified": True
            }
        
        return None
