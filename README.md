# QualiBoard 质量监控系统

QualiBoard 是面向生产质量团队的一体化监控平台，聚合 MES、SAP、SCS 等业务数据，围绕 RTY、LRR、DOA、MFR 等核心指标提供质量看板、明细追溯、系统配置、邮件预警与 AI 分析能力。

## 项目概览

| 方向 | 说明 |
|---|---|
| 前端 | React 19 + Vite 6 + TypeScript + Tailwind CSS v4 |
| 后端 | FastAPI + Motor + Pydantic + Loguru |
| 数据库 | MongoDB `quality_monitoring`，默认端口 `27019` |
| 认证 | 本地账号密码登录，双 Token 自动刷新，Session 存储于 MongoDB |
| 数据采集 | MES HTTP 接口、HANA/订单同步、装配记录采集 |

## 功能状态

| 模块 | 名称 | 数据来源 | 状态 |
|---|---|---|---|
| RTY | 整机综合直通率 | 2026 SAP 工位投入与维修记录 | 已实现 |
| LRR | 部件故障率 | MES 生产与维修数据 | 开发中 |
| DOA | 开箱报修率 | SAP + SCS | 开发中 |
| MFR | 月化故障率 | SCS 换件记录 | 开发中 |
| Settings | 系统配置 | MongoDB `configs` | 已实现 |
| AI | 智能分析助手 | 配置化 LLM 接口 | 已实现 |
| Alert | 邮件预警 | 邮件代理 + 签名报表链接 | 部分实现 |

## 默认登录

开发环境默认账号如下，生产部署前请通过环境变量覆盖。

| 字段 | 默认值 |
|---|---|
| 用户名 | `admin` |
| 密码 | `admin123` |

后端配置项：

```bash
DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=admin123
```

## 快速开始

### Docker Compose（推荐部署方式）

```bash
cp docker/.env.example docker/.env
docker compose -f docker/compose.yaml up -d --build
```

服务启动后访问 `http://localhost:3000`。首次连接全新数据库时，再显式运行默认配置初始化：

```bash
docker compose -f docker/compose.yaml --profile tools run --rm init-config
```

生产环境启动前必须修改 `docker/.env` 中的密码和签名密钥。完整说明见
[`docker/README.md`](docker/README.md)。

### 后端

```bash
cd backend
chmod +x deploy.sh
./deploy.sh
```

脚本会创建虚拟环境、安装依赖、生成必要密钥、启动服务并检查 `/health`。首次生产部署前请检查 `backend/.env`，尤其是：

```bash
DEBUG=false
MONGODB_URL=mongodb://10.17.154.252:27019
JWT_SECRET=
ALERT_TOKEN_SECRET=
DEFAULT_ADMIN_USERNAME=
DEFAULT_ADMIN_PASSWORD=
```

如需初始化默认配置：

```bash
cd backend
./deploy.sh init-config
```

也可以手动启动开发服务：

```bash
cd backend
uv sync
uv run python init_default_settings.py
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 前端

```bash
cd frontend
npm install
npm run dev
```

默认访问地址：

```text
http://localhost:3000
```

前端 Vite 代理会将 `/api/*` 转发到 `http://localhost:8000`。

## 常用命令

| 目录 | 命令 | 说明 |
|---|---|---|
| `frontend` | `npm run dev` | 启动 Vite 开发服务 |
| `frontend` | `npm run lint` | TypeScript 类型检查 |
| `frontend` | `npm run build` | 生产构建 |
| `backend` | `uv run ruff check .` | Python 代码检查 |
| `backend` | `uv run ruff format .` | Python 格式化 |
| `backend` | `uv run pytest` | 运行后端测试 |
| `backend` | `./deploy.sh status` | 查看服务状态 |
| `backend` | `./deploy.sh logs` | 查看后端日志 |
| `backend` | `./deploy.sh restart` | 重启后端服务 |

## 目录结构

```text
QualityMonitoringSystem/
├── frontend/                  # React + Vite + TypeScript + Tailwind v4
│   ├── src/
│   │   ├── api/               # API 请求层
│   │   ├── components/        # 通用组件与业务组件
│   │   ├── context/           # Auth、Settings、ModelTargets 等上下文
│   │   ├── pages/             # 登录页、首页、RTY/LRR 等页面
│   │   └── types/             # TypeScript 类型
│   └── vite.config.ts         # Vite 代理与路径别名
├── backend/                   # FastAPI 服务
│   ├── app/
│   │   ├── api/               # 路由层
│   │   ├── core/              # 配置、日志、上下文
│   │   ├── db/                # MongoDB 连接
│   │   ├── schemas/           # Pydantic 请求/响应模型
│   │   └── services/          # 业务服务
│   ├── tests/                 # 单元测试与集成测试
│   └── deploy.sh              # 后端部署脚本
├── scripts/                   # 数据导入与采集脚本
└── docker/                    # 预留
```

## 认证流程

1. 访问受保护页面时，前端检查本地 access token。
2. 未登录则跳转到 `/login`。
3. 用户输入账号密码，前端调用 `POST /api/auth/login`。
4. 后端校验本地账号，创建用户资料与登录 Session。
5. 后端签发 `access_token` 与 `refresh_token`。
6. 前端保存 token，后续请求自动携带 `Authorization: Bearer <access_token>`。
7. access token 临近过期或接口返回 401 时，前端调用 `POST /api/auth/refresh` 续期。
8. 登出时调用 `POST /api/auth/logout` 并清理本地 token。

## API 摘要

### Auth

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/auth/login` | 本地账号密码登录 |
| `POST` | `/api/auth/refresh` | 使用 refresh token 换发 access token |
| `GET` | `/api/auth/me` | 获取当前用户 |
| `POST` | `/api/auth/logout` | 退出登录并删除 Session |
| `GET/POST` | `/api/auth/oa/callback` | 兼容旧 OA 回调 |

### RTY

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/rty/list` | 查询 RTY 列表，支持多维过滤 |
| `GET` | `/api/rty/{id}/defects` | 查询故障明细 |
| `GET` | `/api/rty/{id}/inputs` | 查询投入明细 |
| `GET` | `/api/rty/cycle-stats` | 查询周期统计 |
| `GET` | `/api/mfr/dashboard` | 查询整机现网月化故障率 |

### Settings

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/settings` | 获取全部配置 |
| `PUT` | `/api/settings` | 批量更新配置 |
| `GET/PUT` | `/api/settings/mes` | MES 接入配置 |
| `GET/PUT` | `/api/settings/model-targets` | 机型目标配置 |
| `GET/PUT` | `/api/settings/email-alert` | 邮件预警配置 |
| `GET/PUT` | `/api/settings/feature-flags` | 功能开关 |
| `GET/PUT` | `/api/settings/ai` | AI 配置 |

## MongoDB Collections

数据库名：`quality_monitoring`

| 集合 | 说明 | 关键字段 |
|---|---|---|
| `machine_info` | MES 机器信息 | `sn`, `sale_no`, `mfg_order`, `factory`, `product_family` |
| `fault_info` | 故障明细 | `sn`, `fault_category`, `fault_desc`, `repair_time` |
| `configs` | 系统配置 | `key`: `mes_config`, `model_targets`, `email_alert_config`, `ai_config` |
| `sales_orders_sap` | SAP 双来源销售订单（SG/KK 同步） | `aufnr`, `gstrs_date`, `quantity`, `data.CPXH`, `data.LGORT` |
| `order_bom_postings_sap` | SAP 订单 BOM 发料与过账明细 | `AUFNR_1`, `VBELN_EX`, `MATNR`, `MENGE`, `BUDAT_MKPF` |
| `serial_bindings_sap` | SAP 整机与部件序列号绑定关系 | `ZCODE_HEAD`, `ZCODE_ITEM`, `AUFNR_HEAD`, `AUFNR_ITEM` |
| `repair_records_sap` | SAP/MES 维修与故障处理记录 | `PCODE`, `AUFNR`, `ZJXMC`, `ZNGWD`, `ZWXWD`, `ZDATE_WX` |
| `station_records_sap` | SAP/MES 工位过站记录 | `PCODE`, `AUFNR`, `SPEC`, `OPERATION`, `ACTUAL_START_TIME` |
| `scs_doa_results` | SCS DOA 原始记录及补采结果 | `is_5000`, `scs_enrichment.accepted_date`, `scs_enrichment.sales_order` |
| `assembly_records` | 装配与发料记录 | `mfg_order`, `chassis_no`, `product_no`, `issued_material_name` |
| `users` | 用户资料 | `itcode`, `profile` |
| `sessions` | 登录会话 | `sessionId`, `itcode`, `accessToken`, `refreshToken`, `expiresAt` |
| `usage_events` | 运营使用事件 | `itcode`, `module`, `timestamp` |

### 字段映射

| RTY 字段 | MongoDB 字段 |
|---|---|
| `serialNumber` | `sn` |
| `salesOrder` | `sale_no` |
| `productionOrder` | `mfg_order` |
| `base` | `factory` |
| `productModel` | `product_family` |
| `productLine` | `s_MFGLINENAME` |

## 数据来源

```text
销售订单（SAP 双来源 SG/KK 同步）
  -> sales_orders_sap（按 aufnr 去重，data.GSTRS 归一化为 gstrs_date，data.GAMNG 归一化为 quantity）
  -> 脚本: scripts/sync_sales_orders_range.py 或 POST /api/sales-orders/sync

机器 / 故障 / 装配（MES 采集）
  -> machine_info / fault_info / assembly_records
  -> 注：MES 采集链路已于 2026-08-18 下线，集合数据保留，供 RTY / LRR / 告警报表实时聚合
```

SCS DOA 采集统一使用 `scripts/sync_scs_incremental.py`：首次运行提供
`--start-date`，后续运行从 `scs_doa_incremental_progress` 的水位线继续，并可使用
`--lookback-days` 回看边界日期。脚本写入 `scs_doa_results` 时同步维护
`scs_enrichment.accepted_date`（`YYYY-MM-DD`）；原始 `data.受理时间` 继续保留用于展示。
详细的首次同步、定时增量、失败重试和一次性迁移说明见
[`docs/sync-scripts.md`](docs/sync-scripts.md)。

MFR（整机现网月化故障率）通过 `/api/mfr/dashboard` 提供，按自然月返回各机型的
`故障数 / 在保整机数 * 100%`。故障数通过 `scs_change_results` 的“换上”记录，
按服务单号关联 `scs_doa_results` 中的 5000 销售订单；不会向换上换下集合写入
`is_5000` 冗余字段。保有量需要 `sales_orders_sap` 中每个销售订单的出厂日期和过保日期，
并按销售订单数量汇总。接口会返回日期覆盖率，缺少生命周期日期的订单不计入分母。

## 关键注意事项

- `ProtectedLayout` 必须等待 `isAuthLoaded=true` 后再判断登录状态，避免刷新后误跳登录页。
- AI 配置中的 `apiKey` 存储在后端，不返回前端；前端只使用 `hasApiKey` 判断配置状态。
- Tailwind v4 使用 CSS-first 配置，入口在 `frontend/src/index.css`。
- MongoDB 默认地址为 `10.17.154.252:27019`，本地或生产环境请以 `.env` 为准。
- OA 回调接口仍保留兼容旧流程，但当前前端登录页使用本地账号密码登录。

## 部署提示

后端一键部署：

```bash
cd backend
./deploy.sh
```

常见操作：

```bash
./deploy.sh status
./deploy.sh logs
./deploy.sh restart
./deploy.sh stop
PORT=8010 ./deploy.sh deploy
```

生产环境建议至少覆盖以下变量：

```bash
DEBUG=false
JWT_SECRET=<strong-random-secret>
ALERT_TOKEN_SECRET=<strong-random-secret>
DEFAULT_ADMIN_USERNAME=<your-admin-user>
DEFAULT_ADMIN_PASSWORD=<strong-password>
CORS_ORIGINS=["https://your-frontend.example.com"]
APP_PUBLIC_BASE_URL=https://your-frontend.example.com
```
