# QualiBoard Backend

QualiBoard 品质看板后端 API，使用 FastAPI + MongoDB 构建。

## 技术栈

- **Python 3.10+**
- **FastAPI** - Web 框架
- **Motor** - 异步 MongoDB 驱动
- **Loguru** - 日志系统
- **Pydantic** - 数据验证

## 快速开始

### 1. 安装 uv (如果没有)

```bash
# macOS
brew install uv

# 或使用 pip
pip install uv
```

### 2. 安装依赖

```bash
# 创建虚拟环境并安装依赖
uv sync

# 安装开发依赖
uv sync --extra dev
```

### 3. 配置环境

```bash
# 复制环境配置示例
cp .env.example .env

# 编辑 .env 文件
nano .env
```

### 4. 运行开发服务器

```bash
# 方式一: 使用 uv run
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# 方式二: 使用 python 脚本
uv run python -m app.main
```

### 5. 访问 API 文档

- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## 常用命令

```bash
# 依赖管理
uv sync                 # 同步依赖
uv add <package>        # 添加依赖
uv add --dev <package>  # 添加开发依赖
uv remove <package>     # 移除依赖
uv lock                 # 锁定依赖版本

# 代码检查
uv run ruff check .     # Ruff 代码检查
uv run ruff format .    # 代码格式化
uv run mypy app/        # 类型检查

# 测试
uv run pytest           # 运行测试
uv run pytest --cov     # 运行测试并生成覆盖率报告

# 构建
uv build                # 构建包
uv publish              # 发布到 PyPI
```

## 项目结构

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI 应用入口
│   ├── api/                 # API 路由
│   │   ├── __init__.py
│   │   ├── rty.py          # RTY 数据接口
│   │   ├── settings.py     # 配置接口
│   │   └── ai.py           # AI 接口
│   ├── core/               # 核心模块
│   │   ├── __init__.py
│   │   ├── config.py       # 配置管理
│   │   └── logger.py       # 日志系统
│   ├── db/                 # 数据库
│   │   ├── __init__.py
│   │   └── mongodb.py      # MongoDB 连接
│   ├── models/             # 数据模型
│   │   ├── __init__.py
│   │   └── documents.py    # 文档定义
│   ├── schemas/            # Pydantic 模型
│   │   ├── __init__.py
│   │   ├── common.py       # 通用响应
│   │   ├── rty.py          # RTY 数据结构
│   │   └── settings.py     # 设置结构
│   └── services/           # 业务服务
├── pyproject.toml          # 项目配置
├── .env.example            # 环境变量示例
└── .gitignore              # Git 忽略文件
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `APP_NAME` | 应用名称 | QualiBoard |
| `DEBUG` | 调试模式 | true |
| `MONGODB_URL` | MongoDB 连接地址 | mongodb://10.17.154.252:27017 |
| `MONGODB_DB_NAME` | 数据库名称 | quality_monitoring |
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

## Docker 部署

```bash
# 构建镜像
docker build -t qualiboard-backend .

# 运行容器
docker run -d -p 8000:8000 --env-file .env qualiboard-backend
```

或使用 docker-compose:

```bash
docker-compose up -d
```

## License

MIT