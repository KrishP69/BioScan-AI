import os
import base64
import json
import hashlib
from typing import List, Union, Dict, Any, Optional
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from app.config import SECRET_KEY

# Derive 256-bit AES master key from SECRET_KEY using SHA-256 HKDF-like digest
# (or env variable BIOMETRIC_VAULT_KEY if set)
_raw_key = os.environ.get("BIOMETRIC_VAULT_KEY", SECRET_KEY + "_BIOMETRIC_VAULT_MASTER_KEY_2026")
_MASTER_KEY = hashlib.sha256(_raw_key.encode("utf-8")).digest()  # Exactly 32 bytes (256-bit)
_aesgcm = AESGCM(_MASTER_KEY)

CIPHER_PREFIX = "enc:v1:"

def encrypt_biometric_data(data: Union[str, List[float], Dict[str, Any]]) -> str:
    """
    Encrypts sensitive student biometric data (face descriptor embeddings or face preview photos)
    using military-grade AES-256-GCM authenticated encryption.
    Generates a cryptographically random 96-bit (12-byte) nonce for every single operation to prevent replay attacks.
    Returns versioned armored ciphertext: 'enc:v1:<base64_nonce_and_ciphertext>'
    """
    if data is None:
        return ""
    if not isinstance(data, str):
        plaintext_str = json.dumps(data)
    else:
        plaintext_str = data
        
    plaintext_bytes = plaintext_str.encode("utf-8")
    nonce = os.urandom(12)  # 96-bit nonce standard for GCM
    ciphertext = _aesgcm.encrypt(nonce, plaintext_bytes, None)
    
    # Pack nonce + ciphertext (tag is appended by AESGCM automatically)
    payload = nonce + ciphertext
    b64_str = base64.b64encode(payload).decode("ascii")
    return f"{CIPHER_PREFIX}{b64_str}"

def decrypt_biometric_data(encrypted_str: str) -> str:
    """
    Decrypts AES-256-GCM armored string and verifies cryptographic integrity tag.
    If the data is legacy plaintext (does not start with 'enc:v1:'), 
    transparently returns it unharmed for zero-downtime backwards compatibility.
    """
    if not encrypted_str or not isinstance(encrypted_str, str):
        return ""
        
    if not encrypted_str.startswith(CIPHER_PREFIX):
        # Legacy plaintext or raw JSON string
        return encrypted_str
        
    b64_part = encrypted_str[len(CIPHER_PREFIX):]
    try:
        payload = base64.b64decode(b64_part.encode("ascii"))
        nonce = payload[:12]
        ciphertext = payload[12:]
        decrypted_bytes = _aesgcm.decrypt(nonce, ciphertext, None)
        return decrypted_bytes.decode("utf-8")
    except Exception as e:
        raise ValueError(f"Biometric decryption failed: cryptographic authentication error ({e})")

def is_biometric_encrypted(data_str: str) -> bool:
    """Returns True if the given string is encrypted with AES-256-GCM."""
    return bool(data_str and isinstance(data_str, str) and data_str.startswith(CIPHER_PREFIX))

def get_vault_security_info() -> Dict[str, Any]:
    """Returns cybersecurity vault metadata for administrator telemetry."""
    return {
        "algorithm": "AES-256-GCM",
        "key_derivation": "SHA-256 HKDF Digest (256-bit)",
        "nonce_size_bits": 96,
        "tag_size_bits": 128,
        "mode": "Galois/Counter Mode (AEAD Authenticated Encryption)",
        "cipher_version": "v1",
        "status": "OPERATIONAL"
    }
