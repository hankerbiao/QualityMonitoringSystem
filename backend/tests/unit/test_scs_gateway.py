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
