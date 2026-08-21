import json
import numpy as np
from typing import List, Dict, Any, Optional, Tuple
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
    distance_threshold: float = 0.65,
    liveness_score: float = 1.0
) -> Optional[Dict[str, Any]]:
    """
    Matches a query embedding against all verified student face profiles.
    Uses normalized cosine similarity and euclidean distance for robust recognition.
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
        
        best_match = None
        min_distance = float("inf")
        max_cos_sim = -1.0

        # Allowed threshold - if user passed a strict threshold, allow robust window (up to 0.70)
        eff_threshold = max(0.68, distance_threshold)

        for row in profiles:
            try:
                raw_emb = row["face_embedding"]
                stored_embedding = json.loads(raw_emb) if isinstance(raw_emb, str) else raw_emb
                stored_norm = normalize_vector(stored_embedding)

                cos_sim = float(np.dot(query_norm, stored_norm))
                dist = float(np.linalg.norm(query_norm - stored_norm))

                # Track best match (highest cosine similarity / lowest distance)
                if dist < min_distance or cos_sim > max_cos_sim:
                    if dist < min_distance:
                        min_distance = dist
                    if cos_sim > max_cos_sim:
                        max_cos_sim = cos_sim
                    best_match = row
            except Exception:
                continue

        # Match condition: distance <= threshold OR cosine_sim >= 0.72
        if best_match and (min_distance <= eff_threshold or max_cos_sim >= 0.72):
            confidence = round(max(60.0, min(99.9, ((max_cos_sim + 1.0) / 2.0) * 100.0 if max_cos_sim > 0 else (1.0 - (min_distance / 1.414)) * 100.0)), 1)
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
