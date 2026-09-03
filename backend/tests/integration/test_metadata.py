"""Metadata table browser API tests."""

import pytest


@pytest.mark.integration
async def test_metadata_table_rejects_unknown_collection(client, make_test_access_token):
    response = await client.get(
        "/api/metadata/tables/not_allowed",
        headers={"Authorization": f"Bearer {make_test_access_token('metadata-user')}"},
    )

    assert response.status_code == 404


@pytest.mark.integration
@pytest.mark.parametrize(
    "table_name",
    [
        "order_bom_postings_sap",
        "serial_bindings_sap",
        "repair_records_sap",
        "station_records_sap",
    ],
)
async def test_metadata_table_rejects_removed_dashboard_collections(
    client, make_test_access_token, table_name
):
    response = await client.get(
        f"/api/metadata/tables/{table_name}",
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
