"""Metadata browser integration tests for gateway-owned raw data."""

import pytest

from app.services.data_gateway_client import DataGatewayError


@pytest.mark.integration
async def test_metadata_table_rejects_unknown_table(client, make_test_access_token):
    response = await client.get(
        "/api/metadata/tables/not_allowed",
        headers={"Authorization": f"Bearer {make_test_access_token('metadata-user')}"},
    )

    assert response.status_code == 404


@pytest.mark.integration
async def test_scs_metadata_reads_gateway_rows(client, make_test_access_token, monkeypatch):
    from app.api import metadata

    async def page(view_id, **_kwargs):
        assert view_id == "SCS_DOA"
        return {
            "items": [
                {
                    "id": "DOA-1",
                    "service_uid": "SVC-1",
                    "sales_order": "SO-1",
                    "customer_uid": "客户A",
                    "acceptance_time": "2026-09-01",
                    "is_5000_company": "true",
                }
            ],
            "total": 1,
            "page": 1,
            "pageSize": 10,
        }

    monkeypatch.setattr(metadata.scs_gateway, "page", page)
    response = await client.get(
        "/api/metadata/tables/scs_doa?page=1&page_size=10",
        headers={"Authorization": f"Bearer {make_test_access_token('metadata-user')}"},
    )

    assert response.status_code == 200
    row = response.json()["rows"][0]
    assert row["data"]["服务单号"] == "SVC-1"
    assert row["data"]["销售订单号"] == "SO-1"
    assert row["source"] == "data_gateway"


@pytest.mark.integration
async def test_scs_metadata_translates_gateway_errors_to_bad_gateway(
    client, make_test_access_token, monkeypatch
):
    from app.api import metadata

    async def page(*_args, **_kwargs):
        raise DataGatewayError("gateway unavailable")

    monkeypatch.setattr(metadata.scs_gateway, "page", page)
    response = await client.get(
        "/api/metadata/tables/scs_doa",
        headers={"Authorization": f"Bearer {make_test_access_token('metadata-user')}"},
    )

    assert response.status_code == 502
    assert response.json()["detail"] == "gateway unavailable"
