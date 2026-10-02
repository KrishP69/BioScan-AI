import time
import re
from typing import Dict, Tuple, Optional
from collections import defaultdict

# In-memory sliding window rate limiter & brute force guard
# tracks: key -> list of failed attempt timestamps
_failed_attempts: Dict[str, list] = defaultdict(list)
_lockout_until: Dict[str, float] = {}

# Security parameters
MAX_FAILED_ATTEMPTS = 5         # Max failed attempts before lockout
LOCKOUT_DURATION_SECONDS = 300  # 5 minutes lockout
ATTEMPT_WINDOW_SECONDS = 900    # 15 minutes failure window

def check_login_rate_limit(identifier: str) -> Tuple[bool, Optional[str], int]:
    """
    Checks if an IP or username/email is currently locked out due to brute force attempts.
    Returns: (is_allowed, error_message, remaining_lockout_seconds)
    """
    now = time.time()
    
    # Check if currently locked out
    if identifier in _lockout_until:
        lockout_end = _lockout_until[identifier]
        if now < lockout_end:
            remaining = int(lockout_end - now)
            return (
                False, 
                f"Account temporarily locked due to {MAX_FAILED_ATTEMPTS} consecutive failed attempts. "
                f"Security cooldown active. Please retry in {remaining} seconds.",
                remaining
            )
        else:
            # Lockout expired, clear history
            del _lockout_until[identifier]
            _failed_attempts[identifier] = []
            
    # Purge old attempts outside the window
    attempts = [t for t in _failed_attempts[identifier] if now - t < ATTEMPT_WINDOW_SECONDS]
    _failed_attempts[identifier] = attempts
    
    return (True, None, 0)

def record_failed_login(identifier: str) -> Tuple[bool, int]:
    """
    Records a failed login attempt. If threshold exceeded, triggers lockout.
    Returns: (is_locked_now, remaining_attempts)
    """
    now = time.time()
    attempts = [t for t in _failed_attempts[identifier] if now - t < ATTEMPT_WINDOW_SECONDS]
    attempts.append(now)
    _failed_attempts[identifier] = attempts
    
    if len(attempts) >= MAX_FAILED_ATTEMPTS:
        _lockout_until[identifier] = now + LOCKOUT_DURATION_SECONDS
        return (True, 0)
        
    remaining = MAX_FAILED_ATTEMPTS - len(attempts)
    return (False, remaining)

def record_successful_login(identifier: str):
    """Resets failed attempt counters upon successful authentication."""
    if identifier in _failed_attempts:
        del _failed_attempts[identifier]
    if identifier in _lockout_until:
        del _lockout_until[identifier]

def validate_password_complexity(password: str) -> Tuple[bool, Optional[str]]:
    """
    Enforces cybersecurity password policy:
    - Minimum 8 characters
    - Must contain at least one digit
    - Must contain at least one letter
    """
    if not password or len(password) < 8:
        return (False, "Password must be at least 8 characters long.")
    if not re.search(r"\d", password):
        return (False, "Password must contain at least one numerical digit (0-9).")
    if not re.search(r"[a-zA-Z]", password):
        return (False, "Password must contain at least one alphabetic character.")
    return (True, None)
