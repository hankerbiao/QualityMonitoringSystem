from __future__ import annotations

import pytest

from app.services import lrr_gateway
from app.services.data_gateway_client import DataGatewayClient, DataGatewayError


def test_lrr_normalizers_ignore_non_sap_alias_fields():
    bom = lrr_gateway.normalize_bom(
        {
            "AUFNR": "legacy-order",
            "materialDescription": "legacy-description",
            "plannedStartDate": "2026-08-01",
        }
    )
    fault = lrr_gateway.normalize_fault(
        {
            "productionOrder": "legacy-order",
            "serialNumber": "legacy-sn",
            "errorCode": "legacy-code",
        }
    )

    assert bom["AUFNR_1"] == ""
    assert bom["MAKTX"] == ""
    assert bom["GSTRS"] == ""
    assert fault["AUFNR"] == ""
    assert fault["PCODE"] == ""
    assert fault["ZNGWD"] == ""
    assert fault["GSTRS"] == ""


def test_lrr_fault_material_falls_back_to_record01repairm_when_matnr_is_empty():
    fault = lrr_gateway.normalize_fault(
        {
            "AUFNR": "000000000001",
            "MATNR": "   ",
            "RECORD01REPAIRM": "PN-FALLBACK",
        }
    )

    assert fault["MATNR"] == "PN-FALLBACK"


def test_lrr_fault_material_prefers_matnr_over_record01repairm():
    fault = lrr_gateway.normalize_fault({"MATNR": "PN-PRIMARY", "RECORD01REPAIRM": "PN-FALLBACK"})

    assert fault["MATNR"] == "PN-PRIMARY"


@pytest.mark.asyncio
async def test_load_bom_normalizes_gateway_rows_and_applies_exact_filters(monkeypatch):
    calls: list[dict[str, str]] = []

    async def all_bom_rows(**filters: str):
        calls.append(filters)
        return [
            {
                "id": "bom-1",
                "AUFNR_1": "000000000001",
                "VBELN_EX": "0000000009",
                "MENGE_A": "3",
                "MATNR": "MAT-1",
                "LGORT": "BASE-A",
                "GSTRS": "20260805",
                "BUDAT_MKPF": "20260831",
            },
            {
                "id": "bom-2",
                "AUFNR_1": "000000000002",
                "VBELN_EX": "0000000010",
                "MENGE_A": "4",
                "MATNR": "MAT-2",
                "LGORT": "BASE-B",
                "GSTRS": "20260805",
                "BUDAT_MKPF": "20260831",
            },
        ]

    async def all_orders(**_filters: str):
        return []

    monkeypatch.setattr(lrr_gateway.data_gateway, "all_bom_rows", all_bom_rows)
    monkeypatch.setattr(lrr_gateway.data_gateway, "all_orders", all_orders)

    rows = await lrr_gateway.load_bom(
        production_order="1",
        date_from="2026-08-01",
        date_to="2026-08-31",
        month="2026-08",
    )

    assert [row["AUFNR_1"] for row in rows] == ["000000000001"]
    assert rows[0]["MENGE_A"] == "3"
    assert calls == [
        {
            "dateFrom": "2026-08-01",
            "dateTo": "2026-08-31",
            "timeField": "planned",
            "materialCode": "",
            "keyword": "1",
        }
    ]


@pytest.mark.asyncio
async def test_load_bom_splits_year_range_into_monthly_gateway_reads(monkeypatch):
    calls: list[dict[str, str]] = []

    async def all_bom_rows(**filters: str):
        calls.append(filters)
        return [
            {
                "id": filters["dateFrom"],
                "AUFNR_1": filters["dateFrom"],
                "MATNR": "PN-1",
                "MENGE_A": "1",
                "GSTRS": filters["dateFrom"],
            }
        ]

    monkeypatch.setattr(lrr_gateway.data_gateway, "all_bom_rows", all_bom_rows)

    rows = await lrr_gateway.load_bom(
        planned_date_from="2025-01-01",
        planned_date_to="2025-12-31",
    )

    assert len(calls) == 12
    assert calls[0]["dateFrom"] == "2025-01-01"
    assert calls[-1]["dateTo"] == "2025-12-31"
    assert len(rows) == 12


@pytest.mark.asyncio
async def test_load_bom_filters_by_production_model_from_order_metadata(monkeypatch):
    async def all_bom_rows(**_filters: str):
        return [
            {
                "id": "bom-m1",
                "AUFNR_1": "000000000001",
                "MATNR": "PN-M1",
                "MENGE_A": "1",
                "GSTRS": "20260805",
            },
            {
                "id": "bom-m2",
                "AUFNR_1": "000000000002",
                "MATNR": "PN-M2",
                "MENGE_A": "1",
                "GSTRS": "20260805",
            },
        ]

    async def all_orders(**_filters: str):
        return [
            {"aufnr": "1", "productionModel": "MODEL-1"},
            {"aufnr": "2", "productionModel": "MODEL-2"},
        ]

    monkeypatch.setattr(lrr_gateway.data_gateway, "all_bom_rows", all_bom_rows)
    monkeypatch.setattr(lrr_gateway.data_gateway, "all_orders", all_orders)

    rows = await lrr_gateway.load_bom(product_model="MODEL-1")

    assert [row["MATNR"] for row in rows] == ["PN-M1"]
    assert rows[0]["_product_model"] == "MODEL-1"


@pytest.mark.asyncio
async def test_load_bom_filters_by_multiple_customers(monkeypatch):
    async def all_bom_rows(**_filters: str):
        return [
            {"id": "bom-c1", "AUFNR_1": "000000000001", "MATNR": "PN-C1", "MENGE_A": "1"},
            {"id": "bom-c2", "AUFNR_1": "000000000002", "MATNR": "PN-C2", "MENGE_A": "1"},
            {"id": "bom-c3", "AUFNR_1": "000000000003", "MATNR": "PN-C3", "MENGE_A": "1"},
        ]

    async def all_orders(**_filters: str):
        return [
            {"aufnr": "1", "customerId": "C-1"},
            {"aufnr": "2", "customerId": "C-2"},
            {"aufnr": "3", "customerId": "C-3"},
        ]

    monkeypatch.setattr(lrr_gateway.data_gateway, "all_bom_rows", all_bom_rows)
    monkeypatch.setattr(lrr_gateway.data_gateway, "all_orders", all_orders)

    rows = await lrr_gateway.load_bom(customer_ids=("C-1", "C-3"))

    assert [row["MATNR"] for row in rows] == ["PN-C1", "PN-C3"]


@pytest.mark.asyncio
async def test_load_bom_month_filters_by_gstrs_without_using_budat_bounds(monkeypatch):
    captured: dict[str, str] = {}

    async def all_bom_rows(**filters: str):
        captured.update(filters)
        return [
            {
                "id": "bom-jan",
                "AUFNR_1": "000000000001",
                "MATNR": "PN-1",
                "GSTRS": "2026-02-05",
                "BUDAT_MKPF": "20260131",
                "MENGE_A": "1",
            },
            {
                "id": "bom-feb",
                "AUFNR_1": "000000000002",
                "MATNR": "PN-2",
                "GSTRS": "2026-03-05",
                "BUDAT_MKPF": "20260228",
                "MENGE_A": "1",
            },
        ]

    async def all_orders(**_filters: str):
        return []

    monkeypatch.setattr(lrr_gateway.data_gateway, "all_bom_rows", all_bom_rows)
    monkeypatch.setattr(lrr_gateway.data_gateway, "all_orders", all_orders)
    rows = await lrr_gateway.load_bom(month="2026-02")
    assert [row["MATNR"] for row in rows] == ["PN-1"]
    assert captured["dateFrom"] == ""
    assert captured["dateTo"] == ""


@pytest.mark.asyncio
async def test_load_bom_filters_by_planned_start_date(monkeypatch):
    captured: dict[str, str] = {}

    async def all_bom_rows(**filters: str):
        captured.update(filters)
        return [
            {"id": "bom-before", "MATNR": "PN-1", "GSTRS": "2026-02-01", "MENGE_A": "1"},
            {"id": "bom-in-range", "MATNR": "PN-2", "GSTRS": "2026-02-15", "MENGE_A": "2"},
            {"id": "bom-after", "MATNR": "PN-3", "GSTRS": "2026-03-01", "MENGE_A": "3"},
        ]

    async def all_orders(**_filters: str):
        return []

    monkeypatch.setattr(lrr_gateway.data_gateway, "all_bom_rows", all_bom_rows)
    monkeypatch.setattr(lrr_gateway.data_gateway, "all_orders", all_orders)
    rows = await lrr_gateway.load_bom(planned_date_from="2026-02-10", planned_date_to="2026-02-20")

    assert [row["MATNR"] for row in rows] == ["PN-2"]
    assert captured["dateFrom"] == "2026-02-10"
    assert captured["dateTo"] == "2026-02-20"


@pytest.mark.asyncio
async def test_load_bom_splits_short_material_ranges_by_day(monkeypatch):
    calls: list[dict[str, str]] = []

    async def all_bom_rows(**filters: str):
        calls.append(filters)
        return []

    monkeypatch.setattr(lrr_gateway.data_gateway, "all_bom_rows", all_bom_rows)

    await lrr_gateway.load_bom(
        material_number="03002413",
        planned_date_from="2026-09-01",
        planned_date_to="2026-09-03",
    )

    assert [(item["dateFrom"], item["dateTo"]) for item in calls] == [
        ("2026-09-01", "2026-09-01"),
        ("2026-09-02", "2026-09-02"),
        ("2026-09-03", "2026-09-03"),
    ]


@pytest.mark.asyncio
async def test_load_bom_expands_numeric_display_pn_to_sap_material_number(monkeypatch):
    captured: dict[str, str] = {}

    async def all_bom_rows(**filters: str):
        captured.update(filters)
        return []

    monkeypatch.setattr(lrr_gateway.data_gateway, "all_bom_rows", all_bom_rows)

    assert await lrr_gateway.load_bom(material_number="24002393") == []
    assert captured["materialCode"] == "000000000024002393"


@pytest.mark.asyncio
async def test_load_bom_preserves_full_and_non_numeric_material_numbers(monkeypatch):
    calls: list[dict[str, str]] = []

    async def all_bom_rows(**filters: str):
        calls.append(filters)
        return []

    monkeypatch.setattr(lrr_gateway.data_gateway, "all_bom_rows", all_bom_rows)

    await lrr_gateway.load_bom(material_number="000000000024002393")
    await lrr_gateway.load_bom(material_number="PN-123")

    assert [call["materialCode"] for call in calls] == ["000000000024002393", "PN-123"]


@pytest.mark.asyncio
async def test_load_bom_attaches_description_when_stream_omits_it(monkeypatch):
    async def all_bom_rows(**_filters: str):
        return [
            {
                "id": "bom-1",
                "AUFNR_1": "000000000001",
                "MATNR": "PN-1",
                "MENGE_A": "1",
                "BUDAT_MKPF": "20260201",
                "GSTRS": "20260205",
            }
        ]

    requested: list[list[str]] = []

    async def descriptions(materials: list[str]) -> dict[str, str]:
        requested.append(materials)
        return {"PN-1": "Component description"}

    async def all_orders(**_filters: str):
        return []

    monkeypatch.setattr(lrr_gateway.data_gateway, "all_bom_rows", all_bom_rows)
    monkeypatch.setattr(lrr_gateway, "material_descriptions", descriptions)
    monkeypatch.setattr(lrr_gateway.data_gateway, "all_orders", all_orders)

    rows = await lrr_gateway.load_bom(material_number="PN-1", month="2026-02")

    assert requested == [["PN-1"]]
    assert rows[0]["MAKTX"] == "Component description"
    assert rows[0]["_match_description"] == ""


@pytest.mark.asyncio
async def test_material_descriptions_reads_one_stream_chunk(monkeypatch):
    calls: list[dict[str, str]] = []

    async def all_bom_rows(**filters: str):
        calls.append(filters)
        return [
            {"MATNR": part, "MAKTX": f"desc {part}"} for part in filters["materialCode"].split(",")
        ]

    monkeypatch.setattr(lrr_gateway.data_gateway, "all_bom_rows", all_bom_rows)

    assert await lrr_gateway.material_descriptions(["PN-1", "PN-1", " PN-2 "]) == {
        "PN-1": "desc PN-1",
        "PN-2": "desc PN-2",
    }
    assert calls == [{"materialCode": "PN-1,PN-2"}]


@pytest.mark.asyncio
async def test_material_descriptions_retries_pn_omitted_by_chunk_limit(monkeypatch):
    calls: list[str] = []

    async def all_bom_rows(**filters: str):
        calls.append(filters["materialCode"])
        if filters["materialCode"] == "PN-1,PN-2":
            return [{"MATNR": "PN-1", "MAKTX": "one"}]
        return [{"MATNR": filters["materialCode"], "MAKTX": "two"}]

    monkeypatch.setattr(lrr_gateway.data_gateway, "all_bom_rows", all_bom_rows)

    assert await lrr_gateway.material_descriptions(["PN-1", "PN-2"]) == {
        "PN-1": "one",
        "PN-2": "two",
    }
    assert calls == ["PN-1,PN-2", "PN-2"]


@pytest.mark.asyncio
async def test_material_descriptions_stops_when_old_stream_has_no_maktx(monkeypatch):
    pages: list[int] = []

    async def all_bom_rows(**_filters: str):
        return [{"MATNR": "PN-1", "MENGE_A": "1"}]

    async def view(_view_id: str, **kwargs: object):
        pages.append(int(kwargs["page"]))
        if kwargs["materialCode"] == "PN-1" and kwargs["page"] == 1:
            return {"items": [{"MATNR": "PN-1", "MAKTX": "paged"}]}
        return {"items": [{"MATNR": "OTHER", "MAKTX": "unrelated"}]}

    monkeypatch.setattr(lrr_gateway.data_gateway, "all_bom_rows", all_bom_rows)
    monkeypatch.setattr(lrr_gateway.data_gateway, "view", view)

    assert await lrr_gateway.material_descriptions(["PN-1", "PN-2"]) == {"PN-1": "paged"}
    assert pages == [1, 1]


@pytest.mark.asyncio
async def test_material_descriptions_returns_partial_result_when_gateway_fails(monkeypatch):
    async def all_bom_rows(**_filters: str):
        raise DataGatewayError("down")

    monkeypatch.setattr(lrr_gateway.data_gateway, "all_bom_rows", all_bom_rows)

    assert await lrr_gateway.material_descriptions(["PN-1"]) == {}


@pytest.mark.asyncio
async def test_load_faults_accepts_omitted_sales_orders(monkeypatch):
    captured: dict[str, str] = {}

    async def fault_lookup(**filters: str):
        captured.update(filters)
        captured["productionOrders"] = ",".join(filters.get("production_orders", []))
        return []

    monkeypatch.setattr(lrr_gateway.data_gateway, "fault_lookup", fault_lookup)
    assert await lrr_gateway.load_faults(production_orders={"000000000001"}) == []
    assert captured["productionOrders"] == "000000000001,1"


@pytest.mark.asyncio
async def test_load_faults_avoids_oversized_batch_filter(monkeypatch):
    captured: dict[str, str] = {}

    async def fault_lookup(**filters: str):
        captured.update(filters)
        return []

    monkeypatch.setattr(lrr_gateway.data_gateway, "fault_lookup", fault_lookup)
    await lrr_gateway.load_faults(
        production_orders={str(index) for index in range(201)},
        date_from="2026-08-01",
        date_to="2026-08-31",
    )
    assert captured["date_from"] == "2026-08-01"


@pytest.mark.asyncio
async def test_load_faults_uses_month_bounds(monkeypatch):
    captured: dict[str, str] = {}

    async def fault_lookup(**filters: str):
        captured.update(filters)
        return []

    monkeypatch.setattr(lrr_gateway.data_gateway, "fault_lookup", fault_lookup)
    await lrr_gateway.load_faults(production_orders={"1"}, month="2026-02")
    assert captured["date_from"] == "2026-02-01"
    assert captured["date_to"] == "2026-02-28"


@pytest.mark.asyncio
async def test_load_faults_resolves_lookup_links_to_full_fault_details(monkeypatch):
    async def fault_lookup(**_filters: str):
        return [
            {
                "productionOrder": "000000000001",
                "serialNumber": "SN-1",
            }
        ]

    async def fault_rows_by_sns(sns: list[str], **_filters: str):
        assert sns == ["SN-1"]
        return [
            {
                "AUFNR": "1",
                "VBELN": "0009",
                "PCODE": "SN-1",
                "ZDATE_WX": "20260202",
                "ZTIME": "113419",
                "ZNGGZ": "OP205",
                "ZWXWD": "Power-on failure",
            },
            {
                "AUFNR": "000000000001",
                "VBELN": "9",
                "PCODE": "SN-1",
                "ZDATE_WX": "20260202",
                "ZTIME": "113419",
                "ZNGGZ": "OP205",
                "ZWXWD": "Power-on failure",
            },
        ]

    monkeypatch.setattr(lrr_gateway.data_gateway, "fault_lookup", fault_lookup)
    monkeypatch.setattr(lrr_gateway.data_gateway, "fault_rows_by_sns", fault_rows_by_sns)

    rows = await lrr_gateway.load_faults(production_orders={"1"})

    assert len(rows) == 2
    assert rows[0]["ZNGGZ"] == "OP205"
    assert rows[0]["ZWXWD"] == "Power-on failure"
    assert rows[0]["ZDATE_WX"] == "20260202"


@pytest.mark.asyncio
async def test_load_faults_enriches_missing_display_fields_from_full_fault_rows(monkeypatch):
    async def fault_lookup(**_filters: str):
        return [{"productionOrder": "1", "serialNumber": "SN-1"}]

    async def fault_rows_by_sns(sns: list[str], **_filters: str):
        assert sns == ["SN-1"]
        return [
            {
                "_source_key": "source-1",
                "AUFNR": "1",
                "PCODE": "SN-1",
                "ZDATE_WX": "20260805",
            }
        ]

    async def fault_rows_by_host_barcodes(host_barcodes: list[str], **_filters: str):
        assert host_barcodes == ["SN-1"]
        return [
            {
                "id": "source-1",
                "raw": {
                    "_source_key": "source-1",
                    "AUFNR": "1",
                    "PCODE": "SN-1",
                    "ZDATE_WX": "20260805",
                    "ZNGWD": "NG type",
                    "ZWXWD": "Repair description",
                },
            }
        ]

    monkeypatch.setattr(lrr_gateway.data_gateway, "fault_lookup", fault_lookup)
    monkeypatch.setattr(lrr_gateway.data_gateway, "fault_rows_by_sns", fault_rows_by_sns)
    monkeypatch.setattr(
        lrr_gateway.data_gateway,
        "fault_rows_by_host_barcodes",
        fault_rows_by_host_barcodes,
    )

    rows = await lrr_gateway.load_faults(production_orders={"1"})

    assert rows[0]["ZNGWD"] == "NG type"
    assert rows[0]["ZWXWD"] == "Repair description"


@pytest.mark.asyncio
async def test_load_faults_skips_display_enrichment_when_not_requested(monkeypatch):
    async def fault_lookup(**_filters: str):
        return [{"productionOrder": "1", "serialNumber": "SN-1"}]

    async def fault_rows_by_sns(_sns: list[str], **_filters: str):
        return [{"_source_key": "source-1", "AUFNR": "1", "PCODE": "SN-1"}]

    async def fault_rows_by_host_barcodes(*_args: object, **_kwargs: object):
        raise AssertionError("list aggregation must not fetch display-only fault fields")

    monkeypatch.setattr(lrr_gateway.data_gateway, "fault_lookup", fault_lookup)
    monkeypatch.setattr(lrr_gateway.data_gateway, "fault_rows_by_sns", fault_rows_by_sns)
    monkeypatch.setattr(
        lrr_gateway.data_gateway,
        "fault_rows_by_host_barcodes",
        fault_rows_by_host_barcodes,
    )

    rows = await lrr_gateway.load_faults(production_orders={"1"}, include_details=False)

    assert len(rows) == 1


@pytest.mark.asyncio
async def test_load_faults_combines_production_and_normalized_sales_order_links(monkeypatch):
    calls: list[dict[str, object]] = []

    async def fault_lookup(**filters: object):
        calls.append(filters)
        if filters.get("sales_orders"):
            return [
                {
                    "salesOrder": "9",
                    "serialNumber": "SN-9",
                    "raw": {"VBELN": "9", "PCODE": "SN-9"},
                }
            ]
        return []

    async def fault_rows_by_sns(sns: list[str], **_filters: str):
        assert sns == ["SN-9"]
        return [{"VBELN": "9", "PCODE": "SN-9", "ZDATE_WX": "20260501"}]

    monkeypatch.setattr(lrr_gateway.data_gateway, "fault_lookup", fault_lookup)
    monkeypatch.setattr(lrr_gateway.data_gateway, "fault_rows_by_sns", fault_rows_by_sns)

    rows = await lrr_gateway.load_faults(production_orders={"1"}, sales_orders={"0009"})

    assert len(rows) == 1
    assert rows[0]["PCODE"] == "SN-9"
    assert any(call.get("sales_orders") == ["9"] for call in calls)
    assert any(call.get("sales_orders") == ["0009"] for call in calls)


@pytest.mark.asyncio
async def test_options_uses_orders_without_loading_entire_bom(monkeypatch):
    async def order_options(**_filters: str):
        return {
            "productionOrders": ["1"],
            "salesOrders": ["0009"],
            "materialNumbers": ["MAT-1"],
            "productModels": ["MODEL-1"],
            "bases": ["BASE-A"],
            "customerIds": ["C-1"],
        }

    async def fail_all_view(*_args, **_kwargs):
        raise AssertionError("options must not load the full BOM view")

    monkeypatch.setattr(lrr_gateway.data_gateway, "order_options", order_options)
    monkeypatch.setattr(lrr_gateway.data_gateway, "all_view", fail_all_view)
    result = await lrr_gateway.options()
    assert result["productionOrders"] == ["000000000001"]
    assert result["salesOrders"] == ["9"]
    assert result["bases"] == ["BASE-A"]
    assert result["customerIds"] == ["C-1"]
    assert result["materialNumbers"] == ["MAT-1"]
    assert result["productModels"] == ["MODEL-1"]


@pytest.mark.asyncio
async def test_all_pages_rejects_result_larger_than_processing_limit():
    client = DataGatewayClient("http://gateway.test")

    async def request_json(*_args, **_kwargs):
        return {"items": [], "total": 101}

    client.request_json = request_json  # type: ignore[method-assign]
    with pytest.raises(DataGatewayError, match="超过本系统单次处理上限"):
        await client.all_pages("GET", "/api/views/ZSGV_ZSD124", max_rows=100)
