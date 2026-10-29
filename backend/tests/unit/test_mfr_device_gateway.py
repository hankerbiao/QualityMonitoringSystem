import pytest

from app.services.data_gateway_client import DataGatewayError
from app.services.scs_gateway import ScsGateway


class DeviceClient:
    def __init__(self, pages):
        self.pages = pages
        self.calls = []

    async def request_json(self, method, path, *, params):
        self.calls.append((method, path, params))
        return self.pages[params["page"] - 1]


def page(number, items, total, more, size=2):
    return {
        "items": items,
        "page": number,
        "pageSize": size,
        "total": total,
        "hasMore": more,
        "scope": "all",
    }


async def test_reads_all_devices_with_company_scope():
    client = DeviceClient(
        [
            page(1, [{"deviceKey": "a"}, {"deviceKey": "b"}], 3, True),
            page(2, [{"deviceKey": "c"}], 3, False),
        ]
    )
    rows = await ScsGateway(client).doa_devices(page_size=2)
    assert [item["deviceKey"] for item in rows] == ["a", "b", "c"]
    assert "company5000" not in client.calls[0][2]


@pytest.mark.parametrize(
    "pages",
    [
        [page(1, [{"deviceKey": "a"}], 2, True)],
        [
            page(1, [{"deviceKey": "a"}, {"deviceKey": "b"}], 3, True),
            page(2, [{"deviceKey": "b"}], 3, False),
        ],
        [
            page(1, [{"deviceKey": "a"}, {"deviceKey": "b"}], 3, True),
            page(2, [{"deviceKey": "c"}], 4, True),
        ],
        [{**page(1, [], 0, False), "scope": "other"}],
    ],
)
async def test_rejects_incomplete_or_untrusted_pagination(pages):
    with pytest.raises(DataGatewayError):
        await ScsGateway(DeviceClient(pages)).doa_devices(page_size=2)
