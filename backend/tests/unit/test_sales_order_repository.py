"""
销售订单仓储层单测：日期归一化 + 过滤器构建。

不连库、不连 SAP，直接验证纯函数逻辑。
"""

import pytest

from app.repositories.sales_order_repository import (
    _build_order_filter,
    normalize_gstrs_date,
    normalize_quantity,
)


class TestNormalizeGstrsDate:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            # 斜杠 + 时间（用户给出的真实样例格式，月/日不补零）
            ("2025/7/8 16:58:34", "2025-07-08"),
            ("2025/7/8", "2025-07-08"),
            # 补零形式同样支持
            ("2025/07/08 16:58:34", "2025-07-08"),
            ("2025/07/08", "2025-07-08"),
            # 横杠
            ("2025-07-08 16:58:34", "2025-07-08"),
            ("2025-07-08", "2025-07-08"),
            # 纯数字
            ("20250708", "2025-07-08"),
        ],
    )
    def test_valid_formats(self, raw, expected):
        assert normalize_gstrs_date(raw) == expected

    @pytest.mark.parametrize(
        "raw",
        [
            None,
            "",
            "   ",
            "not-a-date",
            "2025/13/40",  # 非法日期
            "2025-20-01",  # 非法月份
        ],
    )
    def test_invalid_returns_none(self, raw):
        assert normalize_gstrs_date(raw) is None


class TestBuildOrderFilter:
    def test_empty(self):
        assert _build_order_filter() == {}

    def test_single_model(self):
        f = _build_order_filter(cp_xh=["X1"])
        assert f == {"data.MAKTX_TH": "X1"}

    def test_multi_model_uses_in(self):
        f = _build_order_filter(cp_xh=["X1", "X2"])
        assert f == {"data.MAKTX_TH": {"$in": ["X1", "X2"]}}

    def test_base_and_model(self):
        f = _build_order_filter(cp_xh=["X1"], lgort=["BJ"])
        assert f == {"data.MAKTX_TH": "X1", "data.LGORT": "BJ"}

    def test_date_range_valid(self):
        f = _build_order_filter(date_from="2025-07-01", date_to="2025-08-31")
        assert f == {"gstrs_date": {"$gte": "2025-07-01", "$lte": "2025-08-31"}}

    def test_date_from_only(self):
        f = _build_order_filter(date_from="2025-07-01")
        assert f == {"gstrs_date": {"$gte": "2025-07-01"}}

    def test_invalid_date_ignored(self):
        # 非法日期被归一化为 None → 不写入 gstrs_date 条件
        f = _build_order_filter(date_from="not-a-date")
        assert "gstrs_date" not in f

    def test_combined(self):
        f = _build_order_filter(cp_xh=["X1"], lgort=["BJ"], date_from="2025-01-01")
        assert f == {
            "data.MAKTX_TH": "X1",
            "data.LGORT": "BJ",
            "gstrs_date": {"$gte": "2025-01-01"},
        }


class TestNormalizeQuantity:
    @pytest.mark.parametrize(
        "raw, expected",
        [(10, 10.0), (1.5, 1.5), ("2.25", 2.25), ("1,000", 1000.0), ("invalid", 0.0), (None, 0.0)],
    )
    def test_supported_and_invalid_values(self, raw, expected):
        assert normalize_quantity(raw) == expected
