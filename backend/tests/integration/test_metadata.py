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


@pytest.mark.integration
async def test_scs_metadata_uses_nested_raw_and_enrichment_fields(
    client, db_clean, make_test_access_token
):
    await db_clean["scs_doa_results"].insert_one(
        {
            "data": {
                "服务单号": "SVC-001",
                "客户全称": "客户A",
                "产品/备件名称": "整机X1",
                "受理时间": "2026-08-01 10:00",
                "判定结果": "是",
            },
            "scs_enrichment": {
                "sales_order": "SO-001",
                "factory_date": "2026-07-01",
                "warranty_end_date": "2029-07-01",
                "status": "success",
            },
        }
    )

    response = await client.get(
        "/api/metadata/tables/scs_doa_results?page=1&page_size=10",
        headers={"Authorization": f"Bearer {make_test_access_token('metadata-user')}"},
    )

    assert response.status_code == 200
    body = response.json()
    row = body["rows"][0]
    assert row["data"]["服务单号"] == "SVC-001"
    assert row["data"]["客户全称"] == "客户A"
    assert row["scs_enrichment"]["sales_order"] == "SO-001"
    assert {column["key"] for column in body["columns"]} >= {
        "data.客户全称",
        "data.产品/备件名称",
        "scs_enrichment.sales_order",
    }


@pytest.mark.integration
@pytest.mark.parametrize(
    ("table_name", "document", "query"),
    [
        (
            "order_bom_postings_sap",
            {"AUFNR_1": "PO-001", "VBELN_EX": "SO-001"},
            "productionOrder=PO-001&salesOrder=SO-001",
        ),
        (
            "station_records_sap",
            {"AUFNR": "PO-002", "MAKTX_TH": "Model-X"},
            "productionOrder=PO-002&productModel=Model-X",
        ),
        (
            "repair_records_sap",
            {"AUFNR": "PO-003", "VBELN": "SO-003", "ZJXMC": "Model-Y"},
            "productionOrder=PO-003&salesOrder=SO-003&productModel=Model-Y",
        ),
        (
            "scs_doa_results",
            {"scs_enrichment": {"sales_order": "SO-004"}},
            "salesOrder=SO-004",
        ),
    ],
)
async def test_metadata_table_applies_configured_filters(
    client, db_clean, make_test_access_token, table_name, document, query
):
    await db_clean[table_name].insert_many([document, {"unrelated": "record"}])

    response = await client.get(
        f"/api/metadata/tables/{table_name}?page=1&page_size=10&{query}",
        headers={"Authorization": f"Bearer {make_test_access_token('metadata-user')}"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["filters"]
