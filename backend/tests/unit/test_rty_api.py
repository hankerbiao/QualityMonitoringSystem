from unittest.mock import AsyncMock

import pytest

from app.api import rty
from app.services import rty_gateway


@pytest.mark.asyncio
async def test_defect_details_uses_gateway_sn_lookup(monkeypatch):
    fault_rows_by_sns = AsyncMock(
        return_value=[
            {
                "_id": "fault-1",
                "PCODE": "SN-1",
                "AUFNR": "000000000001",
                "VBELN": "SO-1",
                "ZDATE_WX": "20260503",
                "ZNGWD": "F-01",
                "ZWXWD": "故障描述",
            }
        ]
    )
    monkeypatch.setattr(rty_gateway, "_faults_for_sns", fault_rows_by_sns)

    response = await rty.get_defect_details(" SN-1，SN-1 ,SN-2 ")

    fault_rows_by_sns.assert_awaited_once_with(
        {"SN-1", "SN-2"},
        date_from=rty.YEAR_START,
        date_to=rty.YEAR_END,
    )
    assert response.success
    assert len(response.data) == 1
    assert response.data[0].sn == "SN-1"
    assert response.data[0].defectCode == "F-01"
