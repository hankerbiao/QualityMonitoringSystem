"""Configuration persistence and response sanitization.

The HTTP layer should not need to know MongoDB keys or which credentials are
safe to expose.  This service keeps those rules in one place while preserving
the existing ``configs`` collection shape.
"""

from datetime import datetime, timezone
from typing import Any, cast

from fastapi import HTTPException

from app.models.documents import Collections
from app.schemas.settings import (
    AIConfigSchema,
    CycleStatsConfig,
    EmailAlertConfig,
    FeatureFlags,
    ProcessRecordConfig,
    SettingsResponse,
    SettingsUpdateRequest,
)
from app.services.alert_mail_support import EMAIL_DEFAULT
from app.services.credential_crypto import encrypt_credential

CONFIGS = Collections.CONFIGS
class SettingsService:
    """Read and update settings stored as key-value MongoDB documents."""

    def __init__(self, db: Any) -> None:
        self.db = db

    async def read_doc(self, key: str) -> dict[str, Any] | None:
        return cast(dict[str, Any] | None, await self.db[CONFIGS].find_one({"key": key}))

    async def save_section(self, key: str, update: Any) -> dict[str, Any] | None:
        data = update.model_dump(exclude_none=True)
        if not data:
            raise HTTPException(status_code=400, detail="No fields to update")
        data["updatedAt"] = datetime.now(timezone.utc)
        await self.db[CONFIGS].update_one({"key": key}, {"$set": data}, upsert=True)
        return await self.read_doc(key)

    async def get_all(self) -> SettingsResponse:
        docs = {
            key: await self.read_doc(key)
            for key in (
                "process_record_config",
                "model_targets",
                "email_alert_config",
                "feature_flags",
                "ai_config",
                "cycle_stats_config",
            )
        }
        return SettingsResponse(
            processRecords=self.process_records_from_doc(docs["process_record_config"]),
            modelTargets=(docs["model_targets"] or {}).get("targets", {}),
            emailAlert=self.email_from_doc(docs["email_alert_config"]),
            featureFlags=FeatureFlags(
                voiceInputEnabled=(docs["feature_flags"] or {}).get("voiceInputEnabled", False)
            ),
            ai=self.ai_from_doc(docs["ai_config"]),
            cycleStatsConfig=CycleStatsConfig(
                selectedModels=(docs["cycle_stats_config"] or {}).get("selectedModels", [])
            ),
        )

    async def update_all(self, request: SettingsUpdateRequest) -> SettingsResponse:
        now = datetime.now(timezone.utc)
        updates: list[tuple[str, dict[str, Any]]] = []

        if request.processRecords is not None:
            data = request.processRecords.model_dump(exclude_none=True)
            password = data.pop("password", None)
            if password:
                data["passwordCiphertext"] = encrypt_credential(password)
            if data:
                updates.append(("process_record_config", data))

        if request.modelTargets is not None:
            updates.append(("model_targets", {"targets": request.modelTargets}))

        if request.emailAlert is not None:
            data = request.emailAlert.model_dump(exclude_none=True)
            if data:
                updates.append(("email_alert_config", data))

        if request.featureFlags is not None:
            data = request.featureFlags.model_dump(exclude_none=True)
            if data:
                updates.append(("feature_flags", data))

        if request.ai is not None:
            data = request.ai.model_dump(exclude_none=True)
            if not data.get("apiKey"):
                data.pop("apiKey", None)
            if data:
                updates.append(("ai_config", data))

        if request.cycleStatsConfig is not None:
            updates.append(("cycle_stats_config", {"selectedModels": request.cycleStatsConfig.selectedModels}))

        for key, data in updates:
            await self.db[CONFIGS].update_one(
                {"key": key},
                {"$set": {**data, "updatedAt": now}},
                upsert=True,
            )
        return await self.get_all()

    @staticmethod
    def process_records_from_doc(doc: dict[str, Any] | None) -> ProcessRecordConfig:
        if not doc:
            return ProcessRecordConfig()
        return ProcessRecordConfig(
            username=doc.get("username", ""),
            hasPassword=bool(doc.get("passwordCiphertext")),
        )

    @staticmethod
    def email_from_doc(doc: dict[str, Any] | None) -> EmailAlertConfig:
        if not doc:
            return EmailAlertConfig(
                enabled=True,
                emails=EMAIL_DEFAULT,
                triggerCondition="",
                weeklyProductionThreshold=50,
            )
        return EmailAlertConfig(
            enabled=doc.get("enabled", True),
            emails=doc.get("emails", ""),
            triggerCondition=doc.get("triggerCondition", ""),
            weeklyProductionThreshold=doc.get("weeklyProductionThreshold", 50),
        )

    @staticmethod
    def ai_from_doc(doc: dict[str, Any] | None) -> AIConfigSchema:
        if not doc:
            return AIConfigSchema(
                apiUrl="", modelId="", apiKey="", hasApiKey=False, maxTokens=4096
            )
        return AIConfigSchema(
            apiUrl=doc.get("apiUrl", ""),
            modelId=doc.get("modelId", ""),
            apiKey="",
            hasApiKey=bool(doc.get("apiKey")),
            maxTokens=doc.get("maxTokens", 4096),
        )
