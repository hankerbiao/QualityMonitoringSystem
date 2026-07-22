"""Encryption helpers for credentials persisted in MongoDB."""

from cryptography.fernet import Fernet, InvalidToken

from app.core import config as config_module


class CredentialEncryptionError(RuntimeError):
    pass


def _cipher() -> Fernet:
    key = config_module.get_settings().PROCESS_RECORD_CREDENTIAL_KEY.strip()
    if not key:
        raise CredentialEncryptionError("PROCESS_RECORD_CREDENTIAL_KEY is not configured")
    try:
        return Fernet(key.encode("ascii"))
    except (ValueError, UnicodeEncodeError) as exc:
        raise CredentialEncryptionError("PROCESS_RECORD_CREDENTIAL_KEY is invalid") from exc


def encrypt_credential(value: str) -> str:
    return _cipher().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_credential(value: str) -> str:
    try:
        return _cipher().decrypt(value.encode("ascii")).decode("utf-8")
    except (InvalidToken, UnicodeError) as exc:
        raise CredentialEncryptionError("Stored credential cannot be decrypted") from exc
