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
        raise CredentialEncryptionError(
            "影像数据源密码无法解密，请联系管理员核对服务端加密配置；"
            "如原加密密钥无法恢复，请在系统配置管理中重新保存数据源密码"
        ) from exc


def validate_credential_update(
    stored: dict, username: str | None, password: str | None, allow_reset: bool
) -> None:
    ciphertext = stored.get("passwordCiphertext")
    changes_username = username is not None and username != stored.get("username", "")
    if not ciphertext or not (password or changes_username):
        return
    try:
        decrypt_credential(ciphertext)
    except CredentialEncryptionError as exc:
        if allow_reset and password:
            return
        raise CredentialEncryptionError(
            "当前服务加密密钥与已保存密码不匹配，请先统一服务密钥；"
            "若原密钥无法恢复，可输入密码并选择重置无法解密的凭据"
        ) from exc
