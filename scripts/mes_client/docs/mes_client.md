# MES 平台数据获取客户端 — MesClient

> 基于 `requests` 封装的 Python 客户端，用于对接 MES 系统 REST API。
> 统一管理登录鉴权、会话保持、请求超时，提供简洁的业务接口。

---

## 快速开始

```python
from mes_client import MesClient

client = MesClient(
    base_url="http://10.8.101.49:9991",
    username="liushy2",
    password="Lsy825516",
)

# 第一步：登录（自动保存 token）
client.login()

# 第二步：调用各类查询接口
bases = client.get_bases()
rates = client.get_order_direct_rate(base="1000")
sns   = client.get_serial_numbers("10348300")
```

---

## 类说明

### `MesClient(base_url, username, password)`

| 参数 | 类型 | 说明 |
|---|---|---|
| `base_url` | `str` | MES 系统根地址，如 `http://10.8.101.49:9991` |
| `username` | `str` | 登录用户名 |
| `password` | `str` | 登录密码 |

**构造函数做的事：**
- 创建 `requests.Session`，池化 TCP 连接
- 设置 `trust_env = False`，绕过系统代理（内网直连）
- 保存登录凭证，待 `login()` 时使用

---

## 方法详解

### 1. 认证

#### `login() -> dict`

登录接口，成功后自动在后续请求的 Header 中携带 `Authorization: Bearer <token>`。

**请求：**
```
POST /api/user/login
Body: {"userName":"liushy2","password":"Lsy825516","verificationCode":"","UUID":"1e1bfbf5-14d5-4956-beed-784ec253c08f"}
```

**响应示例：**
```json
{
  "status": true,
  "code": "310",
  "message": "登陆成功",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "userName": "刘圣艳",
    "img": null
  }
}
```

#### `is_logged_in` (属性)

`bool` 类型，判断当前 session 是否已携带 token。

---

### 2. 用户信息

#### `get_current_user_info() -> dict`

获取当前登录用户的详细信息。

**请求：** `POST /api/user/GetCurrentUserInfo`（无 body）

**响应示例：**
```json
{
  "status": true,
  "data": {
    "userName": "liushy2",
    "userTrueName": "刘圣艳",
    "address": "Y",
    "phoneNo": null,
    "email": null,
    "remark": "Lsy825516",
    "gender": 0,
    "roleName": "品管部",
    "headImageUrl": null,
    "createDate": "2022-09-02 15:57:19"
  }
}
```

---

### 3. 基地列表

#### `get_bases() -> list[dict]`

获取所有生产基地。

**请求：** `POST /api/ReportDBTest/getBase`（无 body）

**响应数据字段：**

| 字段 | 示例 | 说明 |
|---|---|---|
| `factoryid` | `"1000"` | 基地 ID |
| `factoryname` | `"天津"` | 基地名称 |
| `factorycode` | `"TJ"` | 基地缩写 |

**可用基地一览：**

| ID | 名称 | 缩写 |
|----|------|------|
| 1000 | 天津 | TJ |
| 2000 | 盘锦 | PJ |
| 3000 | 昆山 | KS |
| 7000 | 太原 | TY |
| 8000 | 安阳 | AY |
| 9000 | 桐乡 | TX |

---

### 4. 订单直通率

#### `get_order_direct_rate(base="1000", order_type="k1", series_no="", order_qty="", order_status="true") -> list[dict]`

获取指定基地的订单直通率数据。

**请求：** `POST /api/OrderDirectRate/getOrderDirectRate`

**注意：** 该接口使用 `application/x-www-form-urlencoded` 格式传参，**不是** JSON body，也不是 GET 请求。

**参数说明：**

| 参数 | 默认值 | 说明 |
|---|---|---|
| `base` | `"1000"` | 基地 ID，见上表 |
| `order_type` | `"k1"` | 订单类型 |
| `series_no` | `""` | 系列号筛选 |
| `order_qty` | `""` | 数量筛选 |
| `order_status` | `"true"` | 订单状态 |

**响应数据字段（每个元素）：**

| 字段 | 示例 | 说明 |
|---|---|---|
| `factoryname` | `"天津"` | 基地名称 |
| `s_SALENO` | `"40003990"` | 销售单号 |
| `mfgordername` | `"10348300"` | 生产订单号 |
| `s_MFGLINENAME` | `"TJ-M-TX"` | 产线名称 |
| `productfamilyname` | `"6615 X23"` | 产品族 |
| `ordertypename` | `"HD01"` | 订单类型名称 |
| `plannedstartdate` | `"2026-05-14"` | 计划开始日期 |
| `s_Mes_Planendtime` | `"2026-05-27 22:21:31"` | 计划结束时间 |
| `qty` | `"20"` | 订单数量 |
| `s_NGCNT` | `"17"` | 不良数 |
| `rate_bz` | `"75%"` | **标准直通率**（目标值） |
| `rate_real` | `"15%"` | **实际直通率** |
| `rate_status` | `"未达成"` | **达成状态**（"已达成" / "未达成"） |

---

### 5. 主机序列号查询

#### `get_serial_numbers(order_no, radio="1") -> list[dict]`

根据生产订单号查询该订单下所有主机的序列号。

**请求：** `POST /api/SerialNumber/getSerialNumber?radio=1&textarea={order_no}`

**参数说明：**

| 参数 | 默认值 | 说明 |
|---|---|---|
| `order_no` | — | 查询关键词（生产订单号/销售单号/机箱号，取决于 radio） |
| `radio` | `"1"` | 查询模式：`1`=按生产订单号, `2`=按销售单号, `3`=按机箱号 |

**响应数据字段（每个元素）：**

| 字段 | 示例 | 说明 |
|---|---|---|
| `s_SALENO` | `"40003990_10"` | 销售单号 |
| `mfgordername` | `"10348300"` | 生产订单号 |
| `productfamilyname` | `"6615 X23"` | 产品族 |
| `mfgorderchassislistname` | `"6102268504327644"` | **主机序列号（机箱号）** |
| `s_CHASSISNOCUST` | `"KS265141001AJ"` | 客户机箱号 |
| `s_ASSETNUMBERLIST` | `"TYSV26040651C"` | 资产编号 |
| `s_OLD_SN` | `null` | 旧序列号 |

---

## 注意事项

### 代理问题

本项目部署在内网 `10.8.101.49`，如果本地配置了 HTTP 代理，`requests` 默认会走代理导致超时。客户端通过 `session.trust_env = False` 已自动跳过代理，无需额外配置。

### 请求超时

- 登录 / 用户信息接口：10s
- 序列号查询：30s
- 直通率查询：60s（该接口数据量大时响应较慢）

可在方法调用的 `timeout` 参数中调整，或修改 `_post()` / `_get()` 默认值。

### Token 有效期

JWT Token 从登录返回时开始计算，有效期约 **2 小时**。超时后需重新调用 `login()`。可通过 `is_logged_in` 属性判断当前是否持有 token（仅判断 header 是否存在，不保证有效性）。

### 接口传参格式

| 接口 | 请求方式 | 传参格式 |
|---|---|---|
| `/api/user/login` | POST | JSON body |
| `/api/user/GetCurrentUserInfo` | POST | 无 body |
| `/api/ReportDBTest/getBase` | POST | 无 body |
| `/api/OrderDirectRate/getOrderDirectRate` | POST | **form-data**（`data=dict`） |
| `/api/SerialNumber/getSerialNumber` | POST | 参数拼接在 URL query 中 |

> 特别注意：`getOrderDirectRate` 不是 JSON 传参，也不是 GET 请求。`requests.post(url, data=dict)` 会自动编码为 `application/x-www-form-urlencoded`。

---

## 完整示例

```python
from mes_client import MesClient

client = MesClient(
    base_url="http://10.8.101.49:9991",
    username="liushy2",
    password="Lsy825516",
)

# 登录
client.login()
print(f"已登录: {client.is_logged_in}")

# 用户信息
print(client.get_current_user_info()["data"]["userTrueName"])

# 查基地
for b in client.get_bases():
    print(b["factoryname"])

# 查直通率 — 天津
rates = client.get_order_direct_rate(base="1000")
done = sum(1 for r in rates if r["rate_status"] == "已达成")
print(f"天津: {done}/{len(rates)} 达成")

# 查序列号
sns = client.get_serial_numbers("10348300")
print(f"订单 10348300 共有 {len(sns)} 台主机")
```
