import requests


class MesClient:
    """MES 平台数据获取客户端"""

    def __init__(self, base_url: str, username: str, password: str):
        self.base_url = base_url.rstrip("/")
        self._session = requests.Session()
        self._session.trust_env = False  # 内网地址跳过代理

        self._login_payload = {
            "userName": username,
            "password": password,
            "verificationCode": "",
            "UUID": "1e1bfbf5-14d5-4956-beed-784ec253c08f",
        }

    # ── 认证 ──────────────────────────────────────────────

    def login(self) -> dict:
        """登录并保存 token"""
        r = self._session.post(
            f"{self.base_url}/api/user/login",
            json=self._login_payload,
            timeout=10,
        )
        data = r.json()
        token = data["data"]["token"]
        self._session.headers.update({"Authorization": f"Bearer {token}"})
        return data

    @property
    def is_logged_in(self) -> bool:
        return "Authorization" in self._session.headers

    # ── 底层请求 ──────────────────────────────────────────

    def _post(self, path: str, *, json=None, data=None, params=None, timeout=60) -> dict:
        """底层 POST 请求，自动拼接 base_url 并解析 JSON 响应"""
        url = f"{self.base_url}{path}"
        r = self._session.post(url, json=json, data=data, params=params, timeout=timeout)
        r.raise_for_status()
        return r.json()

    def _get(self, path: str, *, params=None, timeout=60) -> dict:
        """底层 GET 请求"""
        url = f"{self.base_url}{path}"
        r = self._session.get(url, params=params, timeout=timeout)
        r.raise_for_status()
        return r.json()

    # ── 业务接口 ──────────────────────────────────────────

    def get_current_user_info(self) -> dict:
        """获取当前登录用户信息"""
        return self._post("/api/user/GetCurrentUserInfo")

    def get_bases(self) -> list[dict]:
        """获取基地/工厂列表"""
        result = self._post("/api/ReportDBTest/getBase")
        return result["data"]

    def get_order_direct_rate(
        self,
        base: str = "1000",
        order_type: str = "k1",
        series_no: str = "",
        order_qty: str = "",
        order_status: str = "true",
    ) -> list[dict]:
        """获取订单直通率

        :param base: 基地ID（1000=天津, 2000=盘锦, 3000=昆山, 7000=太原, 8000=安阳, 9000=桐乡）
        :param order_type: 订单类型
        :param series_no:  系列号
        :param order_qty:  订单数量
        :param order_status: 订单状态
        """
        result = self._post(
            "/api/OrderDirectRate/getOrderDirectRate",
            data={
                "Base": base,
                "orderTypeValue": order_type,
                "seriesNo": series_no,
                "OrderQty": order_qty,
                "OrderStatus": order_status,
            },
            timeout=60,
        )
        return result["data"]

    # ── 序列号 ────────────────────────────────────────────

    def get_serial_numbers(self, order_no: str, radio: str = "1") -> list[dict]:
        """根据生产订单号获取主机序列号列表

        :param order_no: 生产订单号（如 10348300）
        :param radio:    查询模式（1=按订单号, 2=按销售单号, 3=按机箱号）
        :return: 每个元素含 s_SALENO, mfgordername, productfamilyname,
                 mfgorderchassislistname（主机序列号）, s_CHASSISNOCUST（客户机箱号）,
                 s_ASSETNUMBERLIST（资产编号）, s_OLD_SN（旧SN）
        """
        result = self._post(
            "/api/SerialNumber/getSerialNumber",
            params={"radio": radio, "textarea": order_no},
            timeout=30,
        )
        return result["data"]

if __name__ == "__main__":
    client = MesClient(
        base_url="http://10.8.101.49:9991",
        username="liushy2",
        password="Lsy825516",
    )

    # 登录
    login_resp = client.login()
    print(f"登录成功: {login_resp['data']['userName']}")
    print(f"当前用户: {client.get_current_user_info()['data']['userTrueName']}")
    print()

    # 基地列表
    bases = client.get_bases()
    print("=== 基地列表 ===")
    for b in bases:
        print(f"  {b['factoryid']} - {b['factoryname']} ({b['factorycode']})")
    print()

    # 天津直通率
    rates = client.get_order_direct_rate(base="1000")
    print(f"=== 天津直通率 共 {len(rates)} 条 ===")
    for item in rates[:10]:
        print(f"  {item['s_SALENO']} | {item['mfgordername']:>8} | {item['productfamilyname']:<10} | "
              f"标准:{item['rate_bz']:>5} 实际:{item['rate_real']:>6} 状态:{item['rate_status']}")
    if len(rates) > 10:
        print(f"  ... 还有 {len(rates)-10} 条")
    print()

    done = sum(1 for r in rates if r["rate_status"] == "已达成")
    fail = sum(1 for r in rates if r["rate_status"] == "未达成")
    print(f"  已达成: {done}  未达成: {fail}  总计: {len(rates)}  达成率: {done/len(rates)*100:.1f}%")
    print()

    # 按生产订单号查序列号
    sn_list = client.get_serial_numbers("10348300")
    print(f"=== 订单 10348300 序列号 共 {len(sn_list)} 台 ===")
    for sn in sn_list[:5]:
        print(f"  机箱号: {sn['mfgorderchassislistname']}  "
              f"客户号: {sn['s_CHASSISNOCUST']}  资产号: {sn['s_ASSETNUMBERLIST']}")
    if len(sn_list) > 5:
        print(f"  ... 还有 {len(sn_list)-5} 台")
