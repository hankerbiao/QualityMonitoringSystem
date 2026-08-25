"""Metadata table browser API tests."""

import pytest
from bson import Decimal128


@pytest.mark.integration
async def test_metadata_table_returns_paginated_rows(client, db_clean, make_test_access_token):
    await db_clean["serial_bindings_sap"].insert_many(
        [
            {
                "ZCODE_HEAD": "SN-001",
                "ZCODE_ITEM": "PART-001",
                "AUFNR_HEAD": "WO-001",
                "quantity": Decimal128("1.25"),
            },
            {"ZCODE_HEAD": "SN-002", "ZCODE_ITEM": "PART-002", "AUFNR_HEAD": "WO-002"},
        ]
    )

    response = await client.get(
        "/api/metadata/tables/serial_bindings_sap?page=1&page_size=10&search=SN-001",
        headers={"Authorization": f"Bearer {make_test_access_token('metadata-user')}"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["key"] == "serial_bindings_sap"
    assert body["total"] == 1
    assert body["has_more"] is False
    assert body["rows"][0]["ZCODE_HEAD"] == "SN-001"
    assert body["rows"][0]["quantity"] == "1.25"
    assert {column["key"] for column in body["columns"]} >= {"ZCODE_HEAD", "AUFNR_HEAD"}


@pytest.mark.integration
async def test_metadata_table_rejects_unknown_collection(client, make_test_access_token):
    response = await client.get(
        "/api/metadata/tables/not_allowed",
        headers={"Authorization": f"Bearer {make_test_access_token('metadata-user')}"},
    )

    assert response.status_code == 404
