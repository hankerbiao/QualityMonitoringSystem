# QualiBoard 质量监控系统

QualiBoard 是面向生产质量团队的一体化监控平台，聚合 MES、SAP、SCS 等业务数据，围绕 RTY、LRR、DOA、MFR 等核心指标提供质量看板、明细追溯、系统配置与邮件预警能力。

## 项目概览

| 方向 | 说明 |
|---|---|
| 前端 | React 19 + Vite 6 + TypeScript + Tailwind CSS v4 |
| 后端 | FastAPI + Motor + Pydantic + Loguru |
| 数据库 | MongoDB `quality_monitoring`，默认端口 `27019` |
| 认证 | 本地账号密码登录，双 Token 自动刷新，Session 存储于 MongoDB |
| 数据采集 | 数据网关负责 SAP/HANA 同步，质量监控保留 MES/SCS 数据 |

## 功能状态

| 模块 | 名称 | 数据来源 | 状态 |
|---|---|---|---|
| RTY | 整机综合直通率 | 2026 SAP 工位投入与维修记录 | 已实现 |
| LRR | 部件故障率 | MES 生产与维修数据 | 开发中 |
| DOA | 开箱报修率 | SAP + SCS | 开发中 |
| MFR | 月化故障率 | SCS 换件记录 | 开发中 |
| Settings | 系统配置 | MongoDB `configs` | 已实现 |
| Alert | 邮件预警 | 邮件代理 + 签名报表链接 | 部分实现 |

## 本地登录配置

开发环境可在 `.env` 中显式配置本地管理员账号。代码不再提供默认密码；生产环境启动会拒绝空值、占位值和弱密码。

后端配置项：

```bash
DEFAULT_ADMIN_USERNAME=<your-admin-name>
DEFAULT_ADMIN_PASSWORD=<strong-password>
```

所有登录用户（包括内置管理员）都可以在「系统配置 → 修改密码」中修改自己的密码，
需要验证当前密码，新密码长度为 8–128 位。修改成功后，原密码、已有访问令牌和刷新令牌
立即失效，需要使用新密码重新登录。环境变量中的管理员密码仅用于首次创建账号；
账号创建后以数据库中的密码哈希为准，重启服务不会恢复初始密码。

## 快速开始

### 源码一键启动

配置好 `backend/.env` 后，可以在项目根目录直接启动前后端开发服务：

```bash
./start.sh
```

脚本会复用已有的 `backend/.venv` 和 `frontend/node_modules`；依赖不存在时分别执行
`uv sync` 和 `npm ci`。服务会以前台方式运行，按 `Ctrl+C` 会同时停止前端和后端。

- 前端：`http://localhost:4000`
- 后端健康检查：`http://localhost:4001/health`

首次使用时，如果还没有后端环境文件：

```bash
cp backend/.env.example backend/.env
# 编辑 backend/.env，至少配置 DATA_GATEWAY_URL
./start.sh
```

可通过环境变量覆盖端口，例如 `BACKEND_PORT=4011 ./start.sh`；已有依赖且不希望脚本检查安装时，使用
`./start.sh --skip-install`。

### Docker Compose（推荐部署方式）

```bash
cp docker/.env.example docker/.env
docker compose -f docker/compose.yaml up -d --build
```

服务启动后访问 `http://localhost:4000`。首次连接全新数据库时，再显式运行默认配置初始化：

```bash
docker compose -f docker/compose.yaml --profile tools run --rm init-config
```

### 数据网关

质量监控后端默认从本机 `http://127.0.0.1:18080` 读取 SAP/HANA 原始数据。先启动网关：

```bash
cd /Users/libiao/Desktop/github/产线故障数据库/backend
go run ./cmd/server
```

生产环境通过质量监控后端的 `DATA_GATEWAY_URL` 指向网关地址；网关只提供原始数据接口，RTY、LRR、DOA、MFR 等指标仍由质量监控后端计算。

生产环境启动前必须修改 `docker/.env` 中的密码和签名密钥。完整说明见
[`docker/README.md`](docker/README.md)。

### 后端

```bash
cd backend
chmod +x deploy.sh
./deploy.sh
```

脚本会创建虚拟环境、安装依赖、生成本地加密密钥、校验显式认证凭据、启动服务并检查 `/health`。首次生产部署前请检查 `backend/.env`，尤其是：`PROCESS_RECORD_CREDENTIAL_KEY` 必须在使用同一 MongoDB 的部署之间保持不变，否则已保存的影像数据源密码密文无法自动恢复。

```bash
DEBUG=false
MONGODB_URL=mongodb://10.17.154.252:27019
JWT_SECRET=
ALERT_TOKEN_SECRET=
DEFAULT_ADMIN_USERNAME=
DEFAULT_ADMIN_PASSWORD=
AUTH_COOKIE_SECURE=true
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
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 4001
```

### 前端

```bash
cd frontend
npm install
npm run dev
```

默认访问地址：

```text
http://localhost:4000
```

前端 Vite 代理会将 `/api/*` 转发到 `http://localhost:4001`。

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
| `POST` | `/api/auth/login` | 本地用户名密码登录 |

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

## MongoDB Collections

数据库名：`quality_monitoring`

| 集合 | 说明 | 关键字段 |
|---|---|---|
| `machine_info` | MES 机器信息 | `sn`, `sale_no`, `mfg_order`, `factory`, `product_family` |
| `fault_info` | 故障明细 | `sn`, `fault_category`, `fault_desc`, `repair_time` |
| `configs` | 系统配置 | `key`: `mes_config`, `model_targets`, `email_alert_config` |
| `sales_orders_sap`（网关） | SAP 双来源销售订单（SG/KK 同步） | `aufnr`, `gstrs_date`, `quantity`, `data.CPXH`, `data.LGORT` |
| `order_bom_postings_sap`（网关） | SAP 订单 BOM 发料与过账明细 | `AUFNR_1`, `VBELN_EX`, `MATNR`, `MENGE`, `BUDAT_MKPF` |
| `serial_bindings_sap`（网关） | SAP 整机与部件序列号绑定关系 | `ZCODE_HEAD`, `ZCODE_ITEM`, `AUFNR_HEAD`, `AUFNR_ITEM` |
| `repair_records_sap`（网关） | SAP/MES 维修与故障处理记录 | `PCODE`, `AUFNR`, `ZJXMC`, `ZNGWD`, `ZWXWD`, `GSTRS`, `ZDATE_WX` |
| `station_records_sap`（网关） | SAP/MES 工位过站记录 | `PCODE`, `AUFNR`, `SPEC`, `OPERATION`, `ACTUAL_START_TIME` |
| `scs_doa_results` | SCS DOA 原始记录及补采结果 | `is_5000`, `scs_enrichment.accepted_date`, `scs_enrichment.sales_order` |
| `users` | 用户资料 | `itcode`, `profile` |
| `sessions` | 登录会话 | `sessionId`, `itcode`, `accessToken`, `refreshToken`, `expiresAt` |
| `usage_events` | 运营使用事件 | `itcode`, `module`, `timestamp` |

RTY 日期筛选使用订单的 `GSTRS`（计划开始时间），故障按所选订单关联。
维修时间 `ZDATE_WX` / `ZTIME` / `repair_time` 已停用，不参与筛选、统计、排序或去重；
历史数据保留原字段，旧接口的 `repairTime` / `ngTime` 返回空值。

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
销售订单（数据网关 `/api/orders`，SAP 双来源由网关负责）
  -> 当前运行时由 FastAPI 通过数据网关读取并完成业务计算
  -> 质量监控数据库中的 SAP/HANA 本地副本已清理，网关为唯一来源

机器 / 故障 / 装配（MES 采集）
  -> machine_info / fault_info
  -> 注：MES 采集链路已于 2026-08-18 下线，现有集合数据仍供 RTY / LRR / 告警报表实时聚合
```

SCS 历史采集和数据修复脚本已归档，不得配置自动调度。归档范围和人工恢复约束见
[`docs/sync-scripts.md`](docs/sync-scripts.md)。

MFR（整机现网月化故障率）通过 `/api/mfr/dashboard` 提供，按自然月返回各机型的
`故障数 / 在保整机数 * 100%`。故障数通过 `scs_change_results` 的“换上”记录，
按服务单号关联 `scs_doa_results` 中的 5000 销售订单；不会向换上换下集合写入
`is_5000` 冗余字段。保有量需要网关 `sales_orders_sap` 接口返回的每个销售订单出厂日期和过保日期，
并按销售订单数量汇总。接口会返回日期覆盖率，缺少生命周期日期的订单不计入分母。

## 关键注意事项

- `ProtectedLayout` 必须等待 `isAuthLoaded=true` 后再判断登录状态，避免刷新后误跳登录页。
- Tailwind v4 使用 CSS-first 配置，入口在 `frontend/src/index.css`。
- MongoDB 默认地址为 `10.17.154.252:27019`，本地或生产环境请以 `.env` 为准。
- 用户权限由管理员在系统配置中维护，可控制账号状态和可访问看板。

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
AUTH_COOKIE_SECURE=true
CORS_ORIGINS=["https://your-frontend.example.com"]
APP_PUBLIC_BASE_URL=https://apps.1oa.com.cn/QualiBoard
```
