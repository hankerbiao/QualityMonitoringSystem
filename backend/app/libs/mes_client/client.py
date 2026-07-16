"""
MES 平台数据获取客户端
"""


import requests

from app.libs.mes_client.const import ALL_BASES
from app.libs.mes_client.models import (
    AssemblyRecordItem,
    CompletionRateItem,
    OrderBomItem,
    OrderDataItem,
    OrderSNDetail,
    OrderSumItem,
    QMSFaultItem,
    SerialNumberItem,
)


class MesClient:
    """MES 平台数据获取客户端"""

    def __init__(self, base_url: str, username: str, password: str):
        """
        初始化客户端

        Args:
            base_url:  MES 服务地址，如 http://10.8.101.49:9991
            username:  登录用户名
            password:  登录密码
        """
        self.base_url = base_url.rstrip("/")
        self._session = requests.Session()
        self._session.trust_env = False
        self._login_payload = {
            "userName": username,
            "password": password,
            "verificationCode": "",
            "UUID": "1e1bfbf5-14d5-4956-beed-784ec253c08f",
        }

    def login(self) -> dict:
        """
        登录 MES 系统并保存认证 token

        Returns:
            登录响应数据，含 userName、token 等
        """
        r = self._session.post(
            f"{self.base_url}/api/user/login",
            json=self._login_payload,
            timeout=10,
        )
        r.raise_for_status()
        data = r.json()
        token_data = data.get("data") if isinstance(data, dict) else None
        if not token_data or not isinstance(token_data, dict):
            raise RuntimeError(f"MES 登录失败：响应中缺少 data.token（响应: {data}）")
        token = token_data.get("token")
        if not token:
            raise RuntimeError(f"MES 登录失败：响应中 token 为空（响应: {data}）")
        self._session.headers["Authorization"] = f"Bearer {token}"
        return data

    @property
    def is_logged_in(self) -> bool:
        """检查是否已登录"""
        return "Authorization" in self._session.headers

    def _request(
        self, path: str, *, method: str = "POST", json=None, data=None, params=None, timeout: int = 60
    ) -> dict:
        """
        底层 HTTP 请求封装

        Args:
            path:    API 路径，如 /api/user/login
            method:  HTTP 方法，默认 POST
            json:    JSON 请求体
            data:    Form-encoded 请求体
            params:  URL 查询参数
            timeout: 请求超时时间（秒）

        Returns:
            解析后的 JSON 响应
        """
        url = f"{self.base_url}{path}"
        r = self._session.request(method, url, json=json, data=data, params=params, timeout=timeout)
        r.raise_for_status()
        return r.json()

    def get_current_user_info(self) -> dict:
        """
        获取当前登录用户信息

        Returns:
            用户信息，含 userTrueName（真实姓名）等
        """
        return self._request("/api/user/GetCurrentUserInfo")

    def get_bases(self) -> list[dict]:
        """
        获取所有基地/工厂列表

        Returns:
            基地列表，每项含基地 ID、名称等
        """
        return self._request("/api/ReportDBTest/getBase")["data"]

    def get_customer_id(self, base: str="1000','2000','3000','7000','8000','9000", sale_no: str="") -> str:
        """
        根据销售订单号获取客户 ID

        Args:
            base:     基地 ID（1000=天津, 2000=盘锦 等）
            sale_no:  销售订单号，如 XNC2602190

        Returns:
            客户 ID（第一条订单的 s_USERFIELD04 字段）
        """
        result = self._request(
            "/api/Order/getOrder",
            params={
                "Base": base,
                "OrderType": "null",
                "OrderStatus": "null",
                "ProcutFamily": "null",
                "keyType": "SaleNo",
                "keyValue": sale_no,
            },
        )
        data = result.get("data") or []
        if not data:
            return ""
        return data[0].get("s_USERFIELD04", "")

    def get_completion_rate(
        self,
        bases: list[str] | None = None,
        key_type: str = "PlanTime",
        issue_time1: str = "",
        issue_time2: str = "",
        order_type_value: str = "k2",
        series_no: str = "",
        model_name: str = "null",
        status_name: str = "all",
    ) -> list[CompletionRateItem]:
        """
        查询订单完工率/生产完成情况

        Args:
            bases:            基地 ID 列表，None 表示全部基地
            key_type:         查询维度，默认 PlanTime（计划时间）
            issue_time1:      开始时间，如 "2026-07-01 00:00:00"
            issue_time2:      结束时间，如 "2026-07-31 23:59:59"
            order_type_value: 订单类型，默认 k2
            series_no:        销售订单号筛选
            model_name:       机型筛选，默认 null（全部）
            status_name:      状态筛选，all=全部, 已达成, 未达成

        Returns:
            订单明细列表
        """
        bases = bases or ALL_BASES
        result = self._request(
            "/api/CompletionRate/getCompletionRate",
            data={
                "Base": ",".join(bases),
                "keyType": key_type,
                "issueTime1": issue_time1,
                "issueTime2": issue_time2,
                "orderTypeValue": order_type_value,
                "seriesNo": series_no,
                "ModelName": model_name,
                "StatusName": status_name,
            },
        )
        print(result)
        return [
            CompletionRateItem(
                sale_no=r["s_SALENO"],
                factory=r["factoryname"],
                mfg_order=r["mfgordername"],
                product_family=r["productfamilyname"],
                qty=int(r["qty"]) if r.get("qty") else None,
                plan_end_time=r.get("s_MES_PLANENDTIME"),
                actual_start_time=r.get("s_ACTUAL_STARTTIME"),
            )
            for r in (result["data"] or [])
        ]

    def get_order_sn_details(
        self,
        sale_no: str,
        base: str = "1000','2000','3000','7000','8000','9000",
        issue_time1: str = "2025-01-01 00:00:00",
        issue_time2: str = "2030-12-31 23:59:59",
    ) -> list[OrderSNDetail]:
        """
        根据销售订单号获取所有机器的详细信息

        流程：客户ID → 生产订单号列表 → 序列号列表

        Args:
            sale_no:     销售订单号，如 XNC2632780
            base:        基地ID，默认 1000
            issue_time1: 开始时间，默认 2025-01-01
            issue_time2: 结束时间，默认 2030-12-31

        Returns:
            每台机器的明细列表
        """
        customer_id = self.get_customer_id(base, sale_no)
        orders = self.get_completion_rate(
            bases=[base],
            series_no=sale_no,
            issue_time1=issue_time1,
            issue_time2=issue_time2,
        )
        results = []
        for order in orders:
            sn_list = self.get_serial_numbers(order.mfg_order, radio="1")
            for sn in sn_list:
                results.append(
                    OrderSNDetail(
                        sale_no=order.sale_no,
                        factory=order.factory,
                        mfg_order=order.mfg_order,
                        product_family=order.product_family,
                        actual_start_time=order.actual_start_time,
                        customer_id=customer_id,
                        sn=sn.sn,
                    )
                )
        return results

    def get_fault_info(self, sn: str, base: str = "1000','2000','3000','7000','8000','9000", key_type: str = "k1") -> list[QMSFaultItem]:
        """
        通过SN码获取故障信息

        Args:
            sn:       主机序列号
            base:     基地ID，默认 1000
            key_type: 查询类型，默认 k1

        Returns:
            故障信息列表
        """
        data = self._request(
            "/api/QMS/getQMSList",
            data={
                "Base": base,
                "keyType": key_type,
                "keyValue": sn,
                "firstappear": "null",
                "secondappear": "null",
                "FromLot": "null",
            },
        ).get("data") or []
        return [
            QMSFaultItem(
                sn=r.get("s_CHASSISNO") or sn,
                sale_no=r.get("s_SALENO"),
                mfg_order=r.get("mfgordername"),
                product_family=r.get("productfamilyname"),
                fault_category=r.get("s_DEFECTCATEGORYNAME"),
                fault_2nd_appear=r.get("s_2NDDEFECTAPPEARNAME"),
                fault_3rd_appear=r.get("s_3RDDEFECTAPPEARNAME"),
                fault_desc=r.get("faulT_DESCRIPTION"),
                repair_person=r.get("r_FULLNAME"),
                repair_time=r.get("r_TXNDATE"),
                repair_effectiveness=r.get("repaiR_EFFECTIVENESS"),
                # 全量字段
                wms_location=r.get("s_WMSLOCATIONNAME"),
                ng_spec_name=r.get("nG_SPECNAME"),
                ng_full_name=r.get("nG_FULLNAME"),
                ng_txn_date=r.get("nG_TXNDATE"),
                d_full_name=r.get("d_FULLNAME"),
                loss_code_name=r.get("s_3RDLOSSCODENAME"),
                twice_defect_flag=r.get("s_TWICEDEFECTFLAGNAME"),
                involved_component=r.get("s_INVOLVEDCOMPONENTNAME"),
                reinsert_lot=r.get("s_REINSERTLOT"),
                slot_no=r.get("s_SLOTNO"),
                s_description=r.get("s_DESCRIPTION"),
                product_name=r.get("productname"),
                component_desc=r.get("description"),
                component_scan_type=r.get("s_COMPONENTSCANTYPE"),
                b_sg=r.get("b_SG"),
                b_material=r.get("b_MATERIAL"),
                a_bg=r.get("a_BG"),
                a_material=r.get("a_MATERIAL"),
                record01_repair=r.get("s_RECORD01REPAIRM"),
                rejudge=r.get("s_ReJudge"),
                rejudge_result=r.get("s_ReJudgeResult"),
                rejudge_problem_desc=r.get("s_ReJudgeProblemDesc"),
                rejudge_note=r.get("s_ReJudgeNote"),
                user_field_03=r.get("s_USERFIELD03"),
                oem_no=r.get("s_OEMNO"),
                oem_desc=r.get("s_OEMDESC"),
                nd_fault_category=r.get("s_NDFAULTCATEGORY"),
                rd_fault_category=r.get("s_RDFAULTCATEGORY"),
                th_fault_category=r.get("s_THFAULTCATEGORY"),
                rma_rejudge=r.get("s_RMAReJudge"),
                rma_rejudge_result=r.get("s_RMAReJudgeResult"),
                slot_info=r.get("slot"),
                ram_filter_flag=r.get("s_RAMFILTERFLAG"),
                chassis_no_cust=r.get("s_CHASSISNOCUST"),
                asset_number_list=r.get("s_ASSETNUMBERLIST"),
            )
            for r in data
        ]

    def collect_order_data(
        self,
        sale_no: str,
        base: str = "1000','2000','3000','7000','8000','9000",
        issue_time1: str = "2025-01-01 00:00:00",
        issue_time2: str = "2030-12-31 23:59:59",
    ) -> list[OrderDataItem]:
        """
        采集销售订单的完整数据

        采集内容包括：
        - SN码
        - 实际开始时间
        - 生产机型
        - 客户ID
        - 生产基地

        Args:
            sale_no:     销售订单号
            base:        基地ID，默认 1000
            issue_time1: 开始时间
            issue_time2: 结束时间

        Returns:
            每台机器的完整数据列表
        """
        customer_id = self.get_customer_id(base, sale_no)
        orders = self.get_completion_rate(
            bases=[base],
            series_no=sale_no,
            issue_time1=issue_time1,
            issue_time2=issue_time2,
        )

        results = []
        processed_sn = set()

        for order in orders:
            sn_list = self.get_serial_numbers(order.mfg_order, radio="1")
            for sn in sn_list:
                if sn.sn in processed_sn:
                    continue
                processed_sn.add(sn.sn)

                results.append(
                    OrderDataItem(
                        sn=sn.sn,
                        sale_no=sale_no,
                        factory=order.factory,
                        mfg_order=order.mfg_order,
                        product_family=order.product_family,
                        actual_start_time=order.actual_start_time,
                        customer_id=customer_id,
                    )
                )
        return results

    def get_serial_numbers(self, order_no: str, radio: str = "1") -> list[SerialNumberItem]:
        """
        根据订单号获取主机序列号列表

        Args:
            order_no: 订单号
            radio:    查询模式
                     "1" = 按生产订单号（如 10348300）
                     "2" = 按销售订单号（如 XNC2602190）
                     "3" = 按机箱号

        Returns:
            序列号列表
        """
        data = self._request(
            "/api/SerialNumber/getSerialNumber",
            params={"radio": radio, "textarea": order_no},
        ).get("data") or []
        return [
            SerialNumberItem(
                mfg_order=r["mfgordername"],
                product_family=r["productfamilyname"],
                sn=r["mfgorderchassislistname"],
                sale_no=r.get("s_SALENO"),
                chassis_no=r.get("s_CHASSISNOCUST"),
                asset_no=r.get("s_ASSETNUMBERLIST"),
            )
            for r in data
        ]

    def get_assembly_records(self, mfg_order: str) -> list[AssemblyRecordItem]:
        """
        根据生产工单号获取装配记录

        Args:
            mfg_order: 生产工单号，如 30231157

        Returns:
            该工单下所有装配记录（每行代表一个组件的装配信息）
        """
        data = self._request(
            "/api/QueryAssemble/getQueryAssemble",
            params={
                "keyType": "MfgOrder",
                "seriesNo": mfg_order,
            },
        ).get("data") or []
        return [
            AssemblyRecordItem(
                mfg_order=r.get("s_MFGORDERNAME", mfg_order),
                chassis_no=r.get("s_CHASSISNO", ""),
                chassis_no_cust=r.get("s_CHASSISNOCUST"),
                product_no=r.get("s_PRODUCTNO", ""),
                product_desc=r.get("s_PRODUCTDESC", ""),
                name=r.get("s_NAME", ""),
                issued_material_name=r.get("s_ISSUEDMATERIALNAME", ""),
                oem_no=r.get("s_OEMNO"),
                oem_desc=r.get("s_OEMDESC"),
                notes=r.get("s_NOTES"),
            )
            for r in data
        ]

    def get_order_sum(self, mfg_order: str) -> list[OrderSumItem]:
        """根据生产工单号获取订单级物料汇总（getOrderSum）

        Args:
            mfg_order: 生产工单号，如 30231157

        Returns:
            该工单的汇总记录（含 qty 等订单级信息）
        """
        data = self._request(
            "/api/OrderBOM/getOrderSum",
            params={"MFGOrderNo": mfg_order},
        ).get("data") or []
        return [OrderSumItem(**r) for r in data]

    def get_order_bom(self, mfg_order: str) -> list[OrderBomItem]:
        """根据生产工单号获取 BOM 物料明细（getOrderBOM）

        Args:
            mfg_order: 生产工单号，如 30231157

        Returns:
            该工单下所有 BOM 行项
        """
        data = self._request(
            "/api/OrderBOM/getOrderBOM",
            params={"MFGOrderNo": mfg_order},
        ).get("data") or []
        return [OrderBomItem(**r) for r in data]