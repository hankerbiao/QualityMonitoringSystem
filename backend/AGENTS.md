# AGENTS.md

## Quick Start

```bash
uv sync
uv run python init_default_settings.py  # 首次必执行
uv run uvicorn app.main:app --reload --port 4001
```

## Commands

```bash
uv sync                        # 同步依赖
uv add <package>               # 添加依赖
uv run ruff check .            # 代码检查
uv run ruff format .           # 代码格式化
uv run python init_default_settings.py   # 初始化默认配置
```

## Architecture

```
app/
├── main.py              # FastAPI 入口，lifespan 管理，CORS，路由注册
├── auth_service.py      # 本地密码认证、Session 创建/验证，双 token 管理
├── api/
│   ├── rty.py          # RTY 列表、工位投入与维修故障明细接口
│   ├── settings.py     # 设置、影像数据源、机型指标和邮件预警接口
│   └── auth.py         # 本地登录、/me、/logout、/refresh
├── core/
│   ├── config.py       # pydantic-settings (MongoDB 27019, JWT secret)
│   └── logger.py       # Loguru + audit logger
└── db/
    └── mongodb.py      # Motor 异步连接
```

## Key Conventions

- **MongoDB 端口**: 27019 (非默认 27017)
- **配置存储**: configs 集合，key-value 文档 (mes_config, model_targets, email_alert_config)
- **Session**: sessions 集合，TTL 索引 30 天
- **本地登录**: Argon2id 密码校验 → Session 创建 → 双 token
- **统一响应**: `Response[T]` (success, message, data, error)
- **审计日志**: audit_logger 记录所有写操作
- **RTY 口径**: 2026 年 SAP 工位记录中的去重 `PCODE` 为投入，维修记录中同 SN 的 2026 数据计为故障；客户字段不属于 RTY 列表契约

## Auth Flow (Critical)

- access_token: 15 分钟有效
- refresh_token: 30 天有效，**刷新时不换发**（保持稳定）
- 两者均存在 sessions 集合，refresh 时仅更新 accessToken 字段

## Gotchas

- DEBUG=false 时关闭 /docs 和 /redoc
- JWT secret 必填，从 .env 读取
- MES 密码明文存储
- CORS 允许所有来源

## API Endpoints

| Method | Path | 说明 |
|--------|------|------|
| POST | /api/auth/refresh | 用 refresh_token 换发 access_token (**不换发 refresh_token**) |
| GET | /api/auth/me | 当前用户信息 |
| POST | /api/auth/logout | 退出登录 |
| GET | /api/rty/list | 2026 SAP 工位投入 RTY 数据列表 |
| GET | /api/rty/defects/by-filters | 按工位筛选返回维修故障明细 |
| GET | /api/rty/defects | 按 SN 返回维修故障明细 |
| GET | /api/rty/{id}/defects | 故障明细 |
| GET | /api/rty/{id}/inputs | 投入明细 |
| GET | /api/rty/cycle-stats | 周期统计 |
| GET/PUT | /api/settings | 获取/更新全部配置 |
| GET | /health | 健康检查 |
