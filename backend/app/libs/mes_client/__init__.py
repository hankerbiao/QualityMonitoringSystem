"""
MES 平台数据获取客户端

用法:
    from mes_client import MesClient, BASE_MAP

    client = MesClient(base_url="http://10.8.101.49:9991", username="xxx", password="xxx")
    client.login()
"""

from .client import MesClient
from .const import ALL_BASES, BASE_ID_TO_CODE, BASE_ID_TO_NAME, BASE_MAP
from .models import (
    CompletionRateItem,
    OrderDataItem,
    OrderSNDetail,
    QMSFaultItem,
    SerialNumberItem,
)
from .mongo import FaultInfo, MachineInfo, MongoDBClient

__all__ = [
    "MesClient",
    "MongoDBClient",
    "BASE_MAP",
    "ALL_BASES",
    "BASE_ID_TO_CODE",
    "BASE_ID_TO_NAME",
    "CompletionRateItem",
    "SerialNumberItem",
    "OrderSNDetail",
    "QMSFaultItem",
    "OrderDataItem",
    "MachineInfo",
    "FaultInfo",
]

__version__ = "0.1.0"

