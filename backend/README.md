# QualiBoard Backend

QualiBoard 品质看板后端 API，使用 FastAPI + MongoDB 构建。

## 技术栈

- **Python 3.10+**
- **FastAPI** - Web 框架
- **Motor** - 异步 MongoDB 驱动
- **Loguru** - 日志系统
- **Pydantic** / **pydantic-settings** - 数据验证与配置管理
- **uvicorn** - ASGI 服务器

## 快速开始

### 1. 安装依赖

```bash
# 使用 uv (推荐)
uv sync

# 或使用 pip
pip install -r requirements.txt
```

### 2. 配置环境

```bash
# 复制环境配置示例
cp .env.example .env

# 编辑 .env 文件
nano .env
```

### 3. 初始化数据库

```bash
# 初始化默认配置数据 (MES 账号、机型指标、邮件预警、AI 配置)
uv run python init_default_settings.py

# 导入模拟 RTY 数据 (开发环境)
uv run python import_mock_data.py
```

### 4. 运行服务器

```bash
# 开发模式 (热重载)
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# 生产模式
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 5. 访问 API 文档

- Swagger UI: http://localhost:8000/docs (仅 DEBUG=true 时开启)
- ReDoc: http://localhost:8000/redoc (仅 DEBUG=true 时开启)
- 健康检查: http://localhost:8000/health

## 项目结构

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI 应用入口 (生命周期、CORS、路由注册)
│   ├── auth_service.py      # OA 登录认证服务 (JWT 验证、Session 管理)
│   ├── api/                 # API 路由
│   │   ├── __init__.py
│   │   ├── rty.py          # RTY 数据接口 (列表、明细、周期统计)
│   │   ├── settings.py     # 系统配置接口 (MES/机型指标/邮件/AI)
│   │   ├── ai.py           # AI 分析接口
│   │   └── auth.py         # 认证接口 (OA 回调、登出)
│   ├── core/               # 核心模块
│   │   ├── __init__.py
│   │   ├── config.py       # 配置管理 (pydantic-settings)
│   │   └── logger.py       # 日志系统 (Loguru + 审计日志)
│   ├── db/                 # 数据库
│   │   ├── __init__.py
│   │   └── mongodb.py      # MongoDB 连接 (Motor 异步)
│   ├── models/             # 数据模型
│   │   ├── __init__.py
│   │   └── documents.py    # 集合名称常量
│   ├── schemas/            # Pydantic 模型 (请求/响应)
│   │   ├── __init__.py
│   │   ├── common.py       # 通用响应 (Response[T])
│   │   ├── rty.py          # RTY 数据结构
│   │   ├── settings.py     # 设置结构
│   │   └── ai.py           # AI 结构
│   └── services/           # 业务服务
│       ├── __init__.py
│       └── ai_service.py   # AI 分析服务
├── init_default_settings.py  # 初始化默认配置
├── import_mock_data.py       # 导入模拟数据
├── pyproject.toml            # 项目配置 (uv)
└── .env.example              # 环境变量示例
```

## 数据库

### MongoDB 配置

- **端口**: 27019 (非默认端口)
- **数据库**: quality_monitoring
- **集合**: configs (存储所有配置)

### 配置存储结构

| key | 说明 |
|-----|------|
| `mes_config` | MES 系统接入 (username, password) |
| `model_targets` | 机型指标 (targets: {机型: 目标值}) |
| `email_alert_config` | 邮件预警 (enabled, emails, attachReport) |
| `ai_config` | AI 模型配置 (apiUrl, modelId, apiKey, maxTokens) |

### Session 存储

- **集合**: sessions
- **字段**: sessionId, itcode, accessToken, refreshToken, createdAt, updatedAt, expiresAt
- **TTL 索引**: 30 天过期

## API 接口

### 认证 (Auth)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/auth/oa/callback` | OA 登录回调，返回双 token，重定向到前端 |
| POST | `/api/auth/oa/callback` | OA 登录回调，JSON 响应 |
| POST | `/api/auth/refresh` | 用 refresh_token 换发新 access_token |
| GET | `/api/auth/me` | 获取当前用户信息 (Bearer token) |
| POST | `/api/auth/logout` | 退出登录，删除 Session |

#### 双 Token 认证流程

1. 前端调用 `GET /api/auth/oa/callback?next=http://前端地址`
2. 后端返回 302，重定向到 OA 登录页
3. 用户在 OA 完成登录
4. OA 回调 `GET /api/auth/oa/callback?status=success&payload=JWT&next=前端地址`
5. 后端验证 JWT，签发双 token，存储 refresh_token 到 MongoDB，返回 302 重定向到 `前端地址/login?status=success&access_token=xxx&refresh_token=xxx&expires_in=900`
6. 前端存储双 token，后续 API 请求携带 `Authorization: Bearer <access_token>`
7. access_token 临近过期 (60s) 或 401 时，前端自动调用 `POST /api/auth/refresh` 换发新令牌
8. refresh_token 过期或登出时，需重新 OA 登录

#### Token 配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `ACCESS_TOKEN_EXPIRE_MINUTES` | access_token 有效期 | 15 分钟 |
| `REFRESH_TOKEN_EXPIRE_DAYS` | refresh_token 有效期 | 30 天 |
| `JWT_SECRET` | Token 签名密钥 | (必填) |

### RTY 数据 (RTY)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/rty/list` | 获取 RTY 数据列表 (支持多维度过滤) |
| GET | `/api/rty/{id}/defects` | 获取故障明细列表 |
| GET | `/api/rty/{id}/inputs` | 获取投入明细列表 |
| GET | `/api/rty/cycle-stats` | 获取周期统计数据 |

#### 过滤参数 (GET /api/rty/list)

| 参数 | 类型 | 说明 |
|------|------|------|
| stat_method | string | 统计方式: 整体直通率 / 过站直通率 |
| date_from | string | 开始日期 YYYY-MM-DD |
| date_to | string | 结束日期 YYYY-MM-DD |
| model | string | 计算方法: 普通机型 / 复合机型 |
| product_model | string | 生产机型 |
| customer | string | 客户名称 |
| base | string | 基地 |
| sales_order | string | 销售订单号 |
| production_order | string | 生产订单号 |
| serial_number | string | 整机序列号 |

### 系统配置 (Settings)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/settings` | 获取全部配置 |
| PUT | `/api/settings` | 批量更新全部配置 |
| GET | `/api/settings/mes` | 获取 MES 配置 |
| PUT | `/api/settings/mes` | 更新 MES 配置 |
| GET | `/api/settings/model-targets` | 获取机型指标 |
| PUT | `/api/settings/model-targets` | 批量更新机型指标 |
| POST | `/api/settings/model-targets/{model}` | 添加/更新单个机型指标 |
| DELETE | `/api/settings/model-targets/{model}` | 删除机型指标 |
| GET | `/api/settings/email-alert` | 获取邮件预警配置 |
| PUT | `/api/settings/email-alert` | 更新邮件预警配置 |
| GET | `/api/settings/feature-flags` | 获取功能开关 |
| PUT | `/api/settings/feature-flags` | 更新功能开关 |
| GET | `/api/settings/ai` | 获取 AI 配置 |
| PUT | `/api/settings/ai` | 更新 AI 配置 |

### AI 分析 (AI)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/ai/analyze` | 数据分析 |

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `APP_NAME` | 应用名称 | QualiBoard |
| `DEBUG` | 调试模式 | true |
| `MONGODB_URL` | MongoDB 连接地址 | mongodb://10.17.154.252:27019 |
| `MONGODB_DB_NAME` | 数据库名称 | quality_monitoring |
| `OA_JWT_SECRET` | OA JWT 验签密钥 | (必填) |
| `OA_LOGIN_URL` | OA 回调地址 | http://10.2.48.65/auth/oa/callback |
| `OA_APP_NAME` | OA 应用名 | qualiboard |
| `OA_LOGIN_BASE_URL` | OA 登录页地址 | http://tl.cooacloud.com/springboard_v3/login_proxy |
| `SESSION_EXPIRE_DAYS` | Session 过期天数 | 30 |
| `LOG_DIR` | 日志目录 | logs |
| `LOG_LEVEL` | 日志级别 | INFO |
| `LOG_ROTATION` | 日志轮转大小 | 500 MB |
| `LOG_RETENTION` | 日志保留时间 | 30 days |

## 日志系统

日志文件位于 `logs/` 目录:

- `app_YYYY-MM-DD.log` - 应用日志
- `error_YYYY-MM-DD.log` - 错误日志
- `audit_YYYY-MM-DD.log` - 审计日志

审计日志格式:
```
时间 | 用户ID | 用户名 | 客户端IP | 操作 | 资源 | 方法 | 状态 | 耗时 | 详情
```

## 常用命令

```bash
# 依赖管理
uv sync                 # 同步依赖
uv add <package>        # 添加依赖
uv remove <package>     # 移除依赖

# 代码检查
uv run ruff check .     # Ruff 代码检查
uv run ruff format .    # 代码格式化

# 数据库初始化
uv run python init_default_settings.py   # 初始化默认配置
uv run python import_mock_data.py         # 导入模拟数据
```

## Docker 部署

```bash
# 构建镜像
docker build -t qualiboard-backend .

# 运行容器
docker run -d -p 8000:8000 --env-file .env qualiboard-backend
```

## License

MIT