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
    DEFAULT_DASHBOARD_STATUSES,
    DEFAULT_WEEKLY_PRODUCTION_THRESHOLD,
    CycleStatsConfig,
    DashboardStatus,
    EmailAlertConfig,
    ProcessRecordConfig,
    QualitySettingsResponse,
    SettingsResponse,
    SettingsUpdateRequest,
    StationPassRateConfig,
    build_email_alert_trigger_condition,
)
from app.services.alert_mail_support import EMAIL_DEFAULT
from app.services.credential_crypto import encrypt_credential
from app.services.data_gateway_client import data_gateway

CONFIGS = Collections.CONFIGS


class SettingsService:
    """Read and update settings stored as key-value MongoDB documents."""

    def __init__(self, db: Any) -> None:
        self.db = db

    async def read_doc(self, key: str) -> dict[str, Any] | None:
        return cast(dict[str, Any] | None, await self.db[CONFIGS].find_one({"key": key}))

    async def get_source_models(self) -> list[str]:
        """All source models, including L6 and historical orders, without dashboard filters."""
        return await data_gateway.order_models()

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
                "dashboard_statuses",
                "cycle_stats_config",
                "station_pass_rate_config",
            )
        }
        return SettingsResponse(
            processRecords=self.process_records_from_doc(docs["process_record_config"]),
            modelTargets=(docs["model_targets"] or {}).get("targets", {}),
            emailAlert=self.email_from_doc(docs["email_alert_config"]),
            dashboardStatuses=self.dashboard_statuses_from_doc(docs["dashboard_statuses"]),
            cycleStatsConfig=CycleStatsConfig(
                selectedModels=(docs["cycle_stats_config"] or {}).get("selectedModels", [])
            ),
            stationPassRateConfig=StationPassRateConfig(
                selectedStations=(docs["station_pass_rate_config"] or {}).get(
                    "selectedStations", []
                ),
                configured=docs["station_pass_rate_config"] is not None,
            ),
        )

    async def get_quality(self) -> QualitySettingsResponse:
        targets = await self.read_doc("model_targets")
        email = await self.read_doc("email_alert_config")
        stations = await self.read_doc("station_pass_rate_config")
        return QualitySettingsResponse(
            modelTargets=(targets or {}).get("targets", {}),
            emailAlert=self.email_from_doc(email),
            stationPassRateConfig=StationPassRateConfig(
                selectedStations=(stations or {}).get("selectedStations", []),
                configured=stations is not None,
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

        if request.dashboardStatuses is not None:
            updates.append(("dashboard_statuses", {"statuses": request.dashboardStatuses}))

        if request.cycleStatsConfig is not None:
            updates.append(
                ("cycle_stats_config", {"selectedModels": request.cycleStatsConfig.selectedModels})
            )

        if request.stationPassRateConfig is not None:
            updates.append(
                (
                    "station_pass_rate_config",
                    {
                        "selectedStations": request.stationPassRateConfig.selectedStations,
                    },
                )
            )

        for key, data in updates:
            await self.db[CONFIGS].update_one(
                {"key": key},
                {"$set": {**data, "updatedAt": now}},
                upsert=True,
            )
        return await self.get_all()

    async def get_dashboard_statuses(self) -> dict[str, DashboardStatus]:
        return self.dashboard_statuses_from_doc(await self.read_doc("dashboard_statuses"))

    @staticmethod
    def dashboard_statuses_from_doc(
        doc: dict[str, Any] | None,
    ) -> dict[str, DashboardStatus]:
        statuses = (doc or {}).get("statuses", {})
        return {
            **DEFAULT_DASHBOARD_STATUSES,
            **{
                key: value
                for key, value in statuses.items()
                if key in DEFAULT_DASHBOARD_STATUSES and value in ("available", "planned")
            },
        }

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
                triggerCondition=build_email_alert_trigger_condition(
                    DEFAULT_WEEKLY_PRODUCTION_THRESHOLD
                ),
                weeklyProductionThreshold=DEFAULT_WEEKLY_PRODUCTION_THRESHOLD,
            )
        threshold = int(
            doc.get("weeklyProductionThreshold", DEFAULT_WEEKLY_PRODUCTION_THRESHOLD)
        )
        trigger_condition = str(doc.get("triggerCondition") or "").strip()
        return EmailAlertConfig(
            enabled=doc.get("enabled", True),
            emails=doc.get("emails", ""),
            triggerCondition=trigger_condition
            or build_email_alert_trigger_condition(threshold),
            weeklyProductionThreshold=threshold,
        )
