# QualityMonitoringSystem 质量监控系统

整机品质监控系统 —— 基于 FastAPI + MongoDB 的后端 API 与 React + Vite 前端，覆盖 RTY 直通率、故障明细、装配记录、物料用量等质量数据采集与展示。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React + Vite + TypeScript + Tailwind v4 |
| 后端 | FastAPI + Motor（异步 MongoDB 驱动）+ Pydantic + Loguru |
| 数据库 | MongoDB（`quality_monitoring`，端口 27019） |
| 数据采集 | SSH 隧道连接 hana + MES HTTP 接口 |

## 目录结构

```
QualityMonitoringSystem/
├── frontend/                 # React + Vite + TypeScript + Tailwind v4
├── backend/                  # FastAPI（RTY + Settings + OA 登录 + AI + MES 采集）
├── scripts/                  # ETL 脚本（销售订单同步 / 数据导入）
└── docker/                   # 预留
```

## 快速开始

**后端**
```bash
cd backend
uv sync
uv run python init_default_settings.py        # 首次必执行：初始化默认配置
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**前端**
```bash
cd frontend
npm install
npm run dev                                   # http://localhost:3000
```

**数据采集**（从 CSV 读取订单并导入）
```bash
cd backend
# 全流程：同步 → 导入 MES 机器/故障 → 采集装配记录
uv run python ../scripts/import_all_orders.py --order-file ../scripts/production_orders_integrated.csv

# 仅采集装配记录
uv run python ../scripts/import_all_orders.py --only-assembly

# 增量更新（不清除旧数据，仅追加新机器/故障）
uv run python ../scripts/import_all_orders.py --order-file ../scripts/production_orders_integrated.csv --update-existing
```

---

## 数据库表结构（MongoDB Collections）

数据库名：**`quality_monitoring`**。以下为全部集合（表），含中文名称、概要说明与关键字段。

### 总览

| 集合名（Collection） | 中文名称 | 概要 |
|---|---|---|
| `rty_data` | RTY 直通率数据 | 各机型每日直通率（RTY）统计与达成状态 |
| `machine_info` | 机器信息 | MES 录入的整机明细（按 SN 唯一） |
| `fault_info` | 故障明细 | 机器故障明细（故障唯一真源） |
| `configs` | 系统配置 | 统一配置集合，按 `key` 区分多类配置 |
| `sales_orders` | 销售订单（采集调度） | 数据采集管线调度表，记录每单处理进度 |
| `no_data_orders` | 无数据订单 | MES 查无数据的销售订单（按 sale_no 去重） |
| `assembly_records` | 装配记录 | 无装配扫号的装配/发料记录（按工单+机箱去重） |
| `users` | 用户 | 系统用户（OA itcode 关联） |
| `sessions` | 登录会话 | 用户登录会话，TTL 30 天自动过期 |

---

### 1. `rty_data` — RTY 直通率数据

各机型每日直通率（RTY）统计，含投入/故障数量、目标值与达成状态。

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | str | 文档 ID |
| `time` | str | 统计日期（YYYY-MM-DD） |
| `model` | str | 机型分类（普通/复合/一拖多） |
| `productModel` | str | 具体机型型号，如 `6210 C21 BOX` |
| `base` | str | 基地（天津/昆山/桐乡/大同） |
| `customer` | str | 客户（MES 无此字段，留空） |
| `defectCount` | int | 故障数量 |
| `inputCount` | int | 投入数量 |
| `rtyRate` | float | 直通率（0-100） |
| `targetRate` | float | 目标直通率（0-100） |
| `salesOrder` | str | 销售单号 |
| `productionOrder` | str | 生产订单号 |
| `productLine` | str | 产线名称 |
| `status` | str | 达成状态：已达成/未达成 |

**索引**：`time`(倒序)、`productModel`、`customer`、`base`、`model` 及复合索引。

---

### 2. `machine_info` — 机器信息

MES 录入的整机明细，按 `sn`（序列号）唯一。

| 字段 | 类型 | 说明 |
|---|---|---|
| `sn` | str | 序列号（唯一） |
| `sale_no` | str | 销售订单号 |
| `factory` | str | 生产基地 |
| `mfg_order` | str | 生产订单号 |
| `product_family` | str | 生产机型 |
| `actual_start_time` | str? | 实际开始时间 |
| `customer_id` | str? | 客户 ID |

**索引**：`sn`(唯一)、`sale_no`、`mfg_order`、`customer_id`。

---

### 3. `fault_info` — 故障明细

机器故障明细，**故障数据的唯一真源**。

| 字段 | 类型 | 说明 |
|---|---|---|
| `sn` | str | 关联机器序列号 |
| `fault_category` | str? | 故障分类 |
| `fault_desc` | str? | 故障描述 |
| `repair_person` | str? | 维修人员 |
| `repair_time` | str? | 维修时间 |
| `repair_effectiveness` | str? | 维修有效性 |
| … | — | 其余为 MES 故障接口全量字段（`ng_spec_name`、`loss_code_name`、`component_scan_type`、`oem_no` 等约 40 个，详见 `FaultInfo` 模型） |

**说明**：按 `sn` 关联机器；按 `sn + fault_desc` 去重 upsert。

**索引**：`sn`、`fault_category`。

---

### 4. `configs` — 系统配置

统一配置集合，单集合多文档，通过 `key` 字段区分配置类型。

| key | 中文名称 | 内容 |
|---|---|---|
| `mes_config` | MES 凭据 | `username`、`password`（GET 接口不返回明文） |
| `model_targets` | 机型指标 | `{机型名: 目标直通率}`，RTY 目标达成率单一数据源 |
| `email_alert_config` | 邮件预警配置 | `enabled`、`emails`（分号分隔） |
| `feature_flags` | 功能开关 | `voiceInputEnabled`（语音输入开关） |
| `ai_config` | AI 配置 | `apiUrl`、`model`、`apiKey`、`maxTokens` |

**索引**：无（按 `key` 查询，文档少）。

---

### 5. `sales_orders` — 销售订单（采集调度）

数据采集管线**调度中心**，串联「同步 → 导入 → 装配」三阶段，记录每单处理进度。

| 字段 | 类型 | 说明 |
|---|---|---|
| `sales_order_sn` | str | 销售订单号（唯一） |
| `import_status` | str | 阶段二状态：`pending`/`done`/`no_data`/`error` |
| `assembly_status` | str | 阶段三状态：`pending`/`done`/`no_data`/`error` |
| `machine_count` | int | 该单机器数量 |
| `fault_count` | int | 该单故障数量 |
| `checked_at` | datetime | 阶段二检查时间 |
| `assembly_checked_at` | datetime | 阶段三检查时间 |

**索引**：`sales_order_sn`(唯一)、`import_status`(稀疏)。

---

### 6. `no_data_orders` — 无数据订单

MES 查询后确认无机器数据的销售订单，按 `sale_no` 去重。

| 字段 | 类型 | 说明 |
|---|---|---|
| `sale_no` | str | 销售订单号（唯一） |

**索引**：`sale_no`(唯一)。

---

### 7. `assembly_records` — 装配记录

无装配扫号场景下的装配/发料记录，按 `mfg_order + chassis_no` 去重。

| 字段 | 类型 | 说明 |
|---|---|---|
| `mfg_order` | str | 生产工单号 |
| `chassis_no` | str | 机箱序列号 |
| `chassis_no_cust` | str? | 客户机箱号 |
| `product_no` | str | 产品编号 |
| `product_desc` | str | 产品描述 |
| `name` | str | 条码/标签号 |
| `issued_material_name` | str? | 发料物料名称 |
| `oem_no` / `oem_desc` | str? | OEM 编号/描述 |
| `notes` | str? | 备注 |
| `imported_at` | datetime | 导入时间 |

**索引**：`(mfg_order, chassis_no)`(唯一)、`chassis_no`。

---

### 8. `users` — 用户

系统用户，与 OA `itcode` 关联。

| 字段 | 类型 | 说明 |
|---|---|---|
| `itcode` | str | OA 工号（唯一） |
| 其他 | — | 用户名、邮箱、角色等（详见用户模型） |

**索引**：`itcode`(唯一)。

---

### 9. `sessions` — 登录会话

用户登录会话，双 Token 自动刷新，TTL 30 天自动过期。

| 字段 | 类型 | 说明 |
|---|---|---|
| `sessionId` | str | 会话 ID（唯一） |
| `itcode` | str | 关联用户工号 |
| `accessToken` / `refreshToken` | str | 访问/刷新令牌 |
| `expiresAt` | datetime | 过期时间（TTL 索引） |

**索引**：`sessionId`(唯一)、`expiresAt`(TTL)。

---

## 数据采集管线

```
阶段一：同步销售订单号 (sync)   ──>  sales_orders (import_status=pending)
阶段二：导入 MES 机器/故障 (import) ──> machine_info / fault_info (sales_orders 状态更新)
阶段三：采集装配记录 (assembly)  ──>  assembly_records (sales_orders 状态更新)
```
`--update-existing` 模式不清除旧数据，仅把已完成订单重置为 `pending`，重新拉取时按 SN 跳过已有记录、只追加新数据。
