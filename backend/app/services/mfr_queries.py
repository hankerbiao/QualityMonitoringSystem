"""MongoDB projections and filters used by the MFR dashboard."""

from datetime import date


def sales_order_projection() -> dict[str, int]:
    return {
        "data.VBELN": 1,
        "data.MAKTX_TH": 1,
        "data.CPXH": 1,
        "data.MAKTX": 1,
        "data.WMENG": 1,
        "data.GAMNG": 1,
        "data.出厂日期": 1,
        "data.生产日期": 1,
        "data.FACTORY_DATE": 1,
        "data.保修结束日期": 1,
        "data.质保到期日": 1,
        "data.WARRANTY_END_DATE": 1,
        "quantity": 1,
        "factory_date": 1,
        "warranty_end_date": 1,
    }


def doa_link_query() -> dict[str, list[dict[str, dict[str, bool]]]]:
    return {
        "$or": [
            {"scs_enrichment.sales_order": {"$exists": True}},
            {"data.销售订单号": {"$exists": True}},
        ]
    }


def doa_link_projection() -> dict[str, int]:
    return {
        "data.服务单号": 1,
        "data.销售订单号": 1,
        "data.出厂日期": 1,
        "data.生产日期": 1,
        "data.保修结束日期": 1,
        "data.质保到期日": 1,
        "scs_enrichment.sales_order": 1,
        "scs_enrichment.factory_date": 1,
        "scs_enrichment.warranty_end_date": 1,
    }


def change_query(service_numbers: set[str], start: date, end: date) -> dict[str, object]:
    return {
        "data.服务单号": {"$in": list(service_numbers)},
        "data.操作类型": {"$in": ["换上", "换上-up"]},
        "data.操作时间": {
            "$gte": f"{start.isoformat()} 00:00:00",
            "$lte": f"{end.isoformat()} 23:59:59",
        },
    }


def change_projection() -> dict[str, int]:
    return {
        "_id": 1,
        "data.是否撤销": 1,
        "data.服务单号": 1,
        "data.操作时间": 1,
        "data.报修设备": 1,
    }
