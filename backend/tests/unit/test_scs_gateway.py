from app.services.scs_gateway import ScsGateway, normalize_change, normalize_doa


def test_normalize_doa_preserves_gateway_relationship_and_display_fields():
    row = normalize_doa(
        {
            "id": "DOA-1",
            "service_uid": "SVC-1",
            "sales_order": "0009",
            "doa_judge": "是",
            "sugon_sn": "SN-1",
            "problem_batch_number": "2",
            "acceptance_time": "2026-09-01 10:00:00",
            "is_5000_company": "true",
        }
    )
    assert row["service_order"] == "SVC-1"
    assert row["sales_order"] == "0009"
    assert row["judgment"] == "是"
    assert row["host_sn"] == "SN-1"
    assert row["repair_count"] == "2"
    assert row["is_5000_company"] is True


def test_normalize_change_parses_string_boolean_values():
    row = normalize_change(
        {"id": "CHANGE-1", "so_code": "SVC-1", "change_type": "换上-up", "is_revoked": "false"}
    )
    assert row["service_order"] == "SVC-1"
    assert row["is_revoked"] is False


async def test_scs_change_enforces_company_scope_when_gateway_stream_does_not():
    class StreamClient:
        async def request_text(self, *_args, **_kwargs):
            return (
                "id\tso_code\tchange_type\tis_5000_company\n"
                "CHANGE-1\tSVC-1\t换上-up\ttrue\n"
                "CHANGE-2\tSVC-2\t换上-up\tfalse\n"
            )

    rows = await ScsGateway(StreamClient()).all("SCS_CHANGE", company5000="true")

    assert [row["id"] for row in rows] == ["CHANGE-1"]


async def test_mfr_gateway_counts_only_active_replacement_events(monkeypatch):
    from app.schemas.mfr import MFRFilters
    from app.services import mfr_service

    async def all_orders(**_filters):
        return [
            {
                "salesOrder": "0001",
                "orderQuantity": 10,
                "raw": {"data": {"VBELN": "0001", "MAKTX_TH": "M1", "WMENG": "10"}},
            }
        ]

    async def all_rows(view_id, **_filters):
        if view_id == "SCS_DOA":
            return [{"service_order": "SVC-1", "sales_order": "0001", "factory_date": "2026-01-01", "warranty_end_date": "2027-01-01"}]
        return [
            {"service_order": "SVC-1", "change_type": "换上", "is_revoked": False, "create_at": "2026-09-03"},
            {"service_order": "SVC-1", "change_type": "换下", "is_revoked": False, "create_at": "2026-09-04"},
            {"service_order": "SVC-1", "change_type": "换上-up", "is_revoked": True, "create_at": "2026-09-05"},
        ]

    monkeypatch.setattr(mfr_service.data_gateway, "all_orders", all_orders)
    monkeypatch.setattr(mfr_service.scs_gateway, "all", all_rows)
    result = await mfr_service.build_mfr_dashboard(
        MFRFilters(dateFrom="2026-09-01", dateTo="2026-09-30")
    )

    assert result.summary.faultCount == 1
    assert result.trend[0].faultCount == 1
