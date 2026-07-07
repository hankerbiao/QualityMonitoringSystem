# AGENTS.md

## Quick Start

```bash
# 安装依赖
uv sync

# 初始化配置数据 (必选，首次部署前执行)
uv run python init_default_settings.py

# 启动服务 (开发模式)
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Commands

```bash
uv sync                        # 同步依赖
uv add <package>               # 添加依赖
uv run ruff check .            # 代码检查
uv run ruff format .           # 代码格式化
uv run python init_default_settings.py   # 初始化默认配置
uv run python import_mock_data.py         # 导入模拟 RTY 数据
```

## Architecture

```
app/
├── main.py              # FastAPI 入口，lifespan 管理，CORS，路由注册
├── auth_service.py      # OA JWT 验签，Session 创建/验证
├── api/
│   ├── rty.py          # GET /api/rty/list, /{id}/defects, /{id}/inputs, /cycle-stats
│   ├── settings.py     # GET/PUT /api/settings, /mes, /model-targets, /email-alert, /ai
│   ├── ai.py           # POST /api/ai/analyze
│   └── auth.py         # OA callback (GET 302 重定向, POST JSON), /me, /logout
├── core/
│   ├── config.py       # pydantic-settings (MongoDB 27019, OA JWT secret)
│   └── logger.py       # Loguru + audit logger
└── db/
    └── mongodb.py      # Motor 异步连接
```

## Key Conventions

- **MongoDB 端口**: 27019 (非默认 27017)
- **配置存储**: configs 集合，key-value 文档 (mes_config, model_targets, email_alert_config, ai_config)
- **Session**: sessions 集合，TTL 索引 30 天
- **OA 登录**: JWT 验签 → Session 创建 → 302 重定向前端
- **统一响应**: `Response[T]` (success, message, data, error)
- **审计日志**: audit_logger 记录所有写操作 (时间/用户/IP/操作/资源/方法/状态/耗时)

## Gotchas

- DEBUG=false 时关闭 /docs 和 /redoc
- OA JWT secret 必填，从 .env 读取
- MES 密码明文存储 (TODO: 生产环境加密)
- CORS 允许所有来源 (TODO: 生产环境限制域名)

## API Endpoints

| Method | Path | 说明 |
|--------|------|------|
| GET | /api/auth/oa/callback | OA 登录回调，返回双 token (GET 302 重定向) |
| POST | /api/auth/oa/callback | OA 登录回调 (POST JSON) |
| POST | /api/auth/refresh | 用 refresh_token 换发 access_token |
| GET | /api/auth/me | 当前用户信息 (Bearer token) |
| POST | /api/auth/logout | 退出登录 |
| GET | /api/rty/list | RTY 数据列表 (多维度过滤) |
| GET | /api/rty/{id}/defects | 故障明细 |
| GET | /api/rty/{id}/inputs | 投入明细 |
| GET | /api/rty/cycle-stats | 周期统计 |
| GET | /api/settings | 获取全部配置 |
| PUT | /api/settings | 批量更新全部配置 |
| GET | /api/settings/mes | MES 配置 |
| PUT | /api/settings/mes | 更新 MES 配置 |
| GET | /api/settings/model-targets | 机型指标 |
| PUT | /api/settings/model-targets | 批量更新机型指标 |
| GET | /api/settings/email-alert | 邮件预警配置 |
| PUT | /api/settings/email-alert | 更新邮件预警配置 |
| GET | /api/settings/ai | AI 配置 |
| PUT | /api/settings/ai | 更新 AI 配置 |
| POST | /api/ai/analyze | AI 数据分析 |
| GET | /health | 健康检查 |