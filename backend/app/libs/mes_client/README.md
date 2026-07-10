# MES Client

MES 平台数据获取客户端，提供订单、序列号、故障等生产数据的查询与本地缓存。

## 环境依赖

- Python >= 3.10
- `requests`
- `pymongo`
- `pydantic`

## 数据库配置

使用系统统一的 MongoDB（`app.core.config.Settings`），无需单独配置。

默认连接：`mongodb://10.17.154.252:27019`，数据库：`quality_monitoring`

## 基地编码

| ID | 名称 | 代码 |
|----|------|------|
| 1000 | 天津 | TJ |
| 2000 | 盘锦 | PJ |
| 3000 | 昆山 | KS |
| 7000 | 太原 | TY |
| 8000 | 安阳 | AY |
| 9000 | 桐乡 | TX |

## 使用方式

### 1. MES HTTP 客户端

```python
from mes_client import MesClient, BASE_MAP

# 初始化（base_url 为 MES 系统地址）
client = MesClient(
    base_url="http://10.8.101.49:9991",
    username="your_username",
    password="your_password",
)
client.login()

# 查询订单完工率
items = client.get_completion_rate(
    bases=["1000", "3000"],
    issue_time1="2026-07-01 00:00:00",
    issue_time2="2026-07-31 23:59:59",
)

# 采集完整订单数据（含 SN、机型、客户）
data = client.collect_order_data(sale_no="XNC2632780", base="1000")

# 获取故障信息
faults = client.get_fault_info(sn="SN12345678", base="1000")
```

### 2. MongoDB 本地缓存

将 MES 数据缓存到本地 MongoDB，支持去重写入：

```python
from mes_client import MesClient, MongoDBClient, MachineInfo, FaultInfo

# 使用系统 MongoDB（默认配置）
mongo = MongoDBClient()

# 或显式指定连接
mongo = MongoDBClient(mongo_url="mongodb://10.17.154.252:27019")

# 写入机器数据（upsert，去重）
mongo.save_machine(MachineInfo(sn="SN123", sale_no="XNC2602190", ...))
mongo.save_machines([MachineInfo(...), ...])

# 写入故障数据（按 sn + fault_desc 去重）
mongo.save_fault(FaultInfo(sn="SN123", fault_desc="卡纸", ...))

# 查询
machine = mongo.get_machine("SN123")
machines = mongo.get_machines_by_sale_no("XNC2602190")
faults = mongo.get_faults_by_sn("SN123")
machine_with_faults = mongo.get_machine_with_faults("SN123")
```

## API 速查

| 方法 | 说明 |
|------|------|
| `login()` | 登录 MES，保存 Bearer token |
| `is_logged_in` | 属性，检查登录状态 |
| `get_completion_rate()` | 查询订单完工率 |
| `collect_order_data()` | 采集完整订单数据（含 SN、机型、客户） |
| `get_order_sn_details()` | 根据销售订单号获取所有机器明细 |
| `get_serial_numbers()` | 根据订单号获取序列号列表 |
| `get_fault_info()` | 通过 SN 获取故障信息 |
| `get_customer_id()` | 根据销售订单号获取客户 ID |

## 数据模型

```python
CompletionRateItem   # 订单完工率项
SerialNumberItem     # 序列号项
OrderSNDetail        # 订单 SN 明细
QMSFaultItem         # QMS 故障项
OrderDataItem        # 订单采集数据

MachineInfo          # MongoDB 机器信息（写入用）
FaultInfo            # MongoDB 故障信息（写入用）
```