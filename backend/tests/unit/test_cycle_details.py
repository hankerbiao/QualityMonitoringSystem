from unittest.mock import AsyncMock

import pytest

from app.services import cycle_details


@pytest.mark.asyncio
async def test_cycle_details_projects_orders_and_attributes_fault_matches(monkeypatch):
    load_sources = AsyncMock(
        return_value=(
            [
                {
                    "VBELN": "SO-1",
                    "AUFNR": "PO-1",
                    "MAKTX_TH": "Model A",
                    "WMENG": "10",
                    "packagingQuantity": 8,
                }
            ],
            [
                (
                    {"AUFNR": "CHILD-1", "PCODE": "CHILD-SN", "U_FIX": "repairer"},
                    {("Model A", "HEAD-1"), ("Model A", "HEAD-2")},
                )
            ],
        )
    )
    monkeypatch.setattr(cycle_details.rty_export, "_load_sources", load_sources)

    result = await cycle_details.build_cycle_details(
        {"dateFrom": "2026-09-01", "dateTo": "2026-09-30", "orderScope": "l6"},
        product_models=["Model A"],
        bases=["B"],
        customers=["C"],
    )

    load_sources.assert_awaited_once_with(
        {"dateFrom": "2026-09-01", "dateTo": "2026-09-30", "orderScope": "l6"},
        product_models=["Model A"],
        bases=["B"],
        customers=["C"],
    )
    assert result.orders == [
        {
            "VBELN": "SO-1",
            "POSNR": None,
            "AUFNR": "PO-1",
            "MAKTX_TH": "Model A",
            "CPXH": None,
            "IF_L6": None,
            "ZSTAT": None,
            "KID": None,
            "GAMNG": None,
            "WMENG": "10",
            "GSTRS": None,
            "ZDATE_STARTED": None,
            "AUART": None,
            "WERKS": None,
            "LGORT": None,
            "MATNR": None,
            "MAKTX": None,
            "NAME1_ZU": None,
        }
    ]
    assert result.faults == [
        {
            "AUFNR": "CHILD-1",
            "PCODE": "CHILD-SN",
            "U_FIX": "repairer",
            "matchedModel": "Model A",
            "countedSN": "HEAD-1",
        },
        {
            "AUFNR": "CHILD-1",
            "PCODE": "CHILD-SN",
            "U_FIX": "repairer",
            "matchedModel": "Model A",
            "countedSN": "HEAD-2",
        },
    ]
