import pytest
from cryptography.fernet import Fernet

from app.core import config as config_module
from app.services.credential_crypto import CredentialEncryptionError, decrypt_credential
from app.services.process_record_service import ProcessRecordGateway


def test_password_encrypted_with_another_key_reports_configuration_issue(
    monkeypatch, mock_settings
):
    monkeypatch.setattr(config_module, "get_settings", lambda: mock_settings)
    ciphertext = Fernet(Fernet.generate_key()).encrypt(b"private-source-password").decode("ascii")

    with pytest.raises(CredentialEncryptionError) as failure:
        decrypt_credential(ciphertext)

    message = str(failure.value)
    assert "无法解密" in message
    assert "管理员" in message
    assert ciphertext not in message
    assert "private-source-password" not in message
    assert mock_settings.PROCESS_RECORD_CREDENTIAL_KEY not in message


@pytest.mark.asyncio
async def test_gateway_reports_unreadable_password_without_modifying_saved_credentials(db_clean):
    ciphertext = Fernet(Fernet.generate_key()).encrypt(b"private-source-password").decode("ascii")
    await db_clean.configs.insert_one(
        {
            "key": "process_record_config",
            "username": "source-user",
            "passwordCiphertext": ciphertext,
        }
    )
    gateway = ProcessRecordGateway()
    try:
        result = await gateway.query("all", 1, 30, "")
    finally:
        await gateway.close()

    assert result.rows == []
    assert all(
        not source.online and "无法解密" in source.error for source in result.sources.values()
    )
    stored = await db_clean.configs.find_one({"key": "process_record_config"})
    assert stored["passwordCiphertext"] == ciphertext
