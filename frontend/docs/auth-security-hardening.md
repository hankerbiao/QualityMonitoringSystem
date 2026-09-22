# 本地认证安全说明

QualiBoard 使用本地用户名密码登录，不再依赖外部单点登录回调。

## 认证流程

1. 登录页调用 `POST /api/auth/login`。
2. 后端校验管理员环境变量账号，或校验普通用户的 Argon2id 密码哈希。
3. 后端签发短期 `access_token` 和长期 `refresh_token`，并在 MongoDB `sessions` 集合中保存会话。
4. 前端在请求前自动刷新即将过期的 access token；刷新失败则清理本地令牌并返回登录页。
5. 管理员禁用普通用户时，后端删除该用户的全部 sessions；已有 access token 也会因用户状态校验立即失效。

## 用户与看板权限

- 管理员账号由 `DEFAULT_ADMIN_USERNAME` 和 `DEFAULT_ADMIN_PASSWORD` 初始化，不通过用户管理页面修改或禁用。
- 普通用户由管理员创建，密码只保存为 Argon2id 哈希。
- `/api/auth/me` 返回当前用户的角色、激活状态和看板权限。
- 前端隐藏未授权入口，后端在看板 API 层再次校验权限。
- 用户管理接口统一要求当前用户为管理员。

## Token 约定

| Token | 有效期 | 用途 |
|------|------|------|
| `access_token` | 15 分钟 | API 请求鉴权 |
| `refresh_token` | 30 天 | 换发 access token |

历史外部登录用户和 sessions 通过 `backend/cleanup_oa_users.py` 显式清理，脚本不会在应用启动时自动执行，也不会修改业务数据集合。
