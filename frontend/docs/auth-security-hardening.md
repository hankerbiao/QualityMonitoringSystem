# 认证安全加固改造方案（前后端对齐版）

> 适用范围：QualiBoard 前端（React + Vite）与认证后端（Spring，`tl.cooacloud.com` 统一登录代理 + `localhost:4001` 业务网关）。
> 关联问题：代码评审中的 **P1 安全问题**（Token 暴露在 URL query、明文存 localStorage、无过期机制）。
> 目标：在不降低可用性的前提下，消除会话令牌的泄露面，并建立过期/刷新机制。

---

## 1. 背景与现状

### 1.1 当前认证链路

```
LoginPage 按钮 → window.location.href = getOALoginUrl()
  → 跳 OA 代理 (springboard_v3/login_proxy)
  → 回跳 /login?status=success&token=<明文>&next=<path>
AuthContext(useEffect) 解析 query → setSessionToken(token) 存入 localStorage
  → getCurrentUser(GET /api/auth/me，带 X-Session-Token 头) → navigate('/')
```

### 1.2 当前前后端契约

| 环节 | 现状 |
|------|------|
| OA 回跳 | `GET /login?status=success&token=<jwt>&next=<path>`（令牌在 URL） |
| 令牌存储 | 前端 `localStorage`，key=`qualiboard-session-token` |
| 请求鉴权 | 自定义头 `X-Session-Token: <jwt>` |
| 用户信息 | `GET /api/auth/me` → `{ sessionId, itcode, user }` |
| 登出 | 前端清 localStorage + `navigate('/login')`（**不通知后端**） |
| 过期 | 无，令牌永久有效直到手动清除 |

### 1.3 现状风险

| 编号 | 风险 | 说明 |
|------|------|------|
| R1 | **令牌进 URL** | 出现在浏览器历史、Referer、网关/代理访问日志，易被间接泄露 |
| R2 | **localStorage 明文令牌** | 任意 XSS 即可 `localStorage.getItem(...)` 盗走会话，跨标签页持久 |
| R3 | **无过期/刷新** | 令牌一旦泄露长期可用，无法主动失效 |
| R4 | **登出不同步** | 前端清了本地状态，后端令牌仍有效，可继续被冒用 |

---

## 2. 改造目标

1. **令牌不再出现在 URL**，改用 OAuth2 授权码（一次性、短期、不可重用）。
2. **前端不再持有令牌明文**，由后端通过 `HttpOnly + Secure + SameSite` Cookie 下发。
3. **建立过期 + 刷新机制**，缩短访问令牌寿命，刷新令牌可控回收。
4. **登出双向生效**，后端使会话失效。
5. 尽量**复用既有接口骨架**（此前已定义 `POST /api/auth/oa/callback`，可直接启用）。

---

## 3. 改造方案

### 3.1 OAuth2 授权码模式（消除 URL 带令牌）

- OA 代理回跳由携带 `token` 改为携带 `code`（authorization code）：
  `GET /login?status=success&code=<一次性code>&next=<path>`
- 前端拿到 `code` 后，**不再直接当令牌用**，而是调用后端：
  `POST /api/auth/oa/callback { code, next }`
- 后端用 `code` 向 OA 服务换取真实令牌，校验通过后：
  - 下发会话 Cookie（见 3.2）；
  - 返回 `{ ok: true, user, next }`（或前端再调 `/api/auth/me` 取用户）。
- `code` 短期有效、一次性，即便泄露也无法直接换到会话。

> 前置依赖：OA 代理（`springboard_v3/login_proxy`）需支持授权码流程并返回 `code` 而非 `token`。需与 OA 平台方确认能否配置 `redirect_uri` 白名单与 `client_id`，否则 R1 只能靠前端 `replaceState` 缓解（当前已做），无法根治。

### 3.2 HttpOnly + Secure + SameSite Cookie 下发会话

后端在 `/api/auth/oa/callback` 成功后通过 `Set-Cookie` 下发会话：

```
Set-Cookie: qb_session=<http-only-token>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=900
Set-Cookie: qb_refresh=<refresh-token>; Path=/api/auth/refresh; HttpOnly; Secure; SameSite=Lax; Max-Age=604800
```

- `HttpOnly`：JS 无法读取，XSS 拿不到令牌（根治 R2）。
- `Secure`：仅 HTTPS 传输。
- `SameSite=Lax`：同源/顶级导航自动携带，天然抗 CSRF（当前 `X-Session-Token` 头方案本身也抗 CSRF，迁移后可移除）。
- 前端 `fetch` 走 `/api`（经 vite proxy / 生产 Nginx 反代，与页面同域），浏览器自动带 Cookie，**无需额外 `credentials` 配置**。

### 3.3 过期与刷新（阶段二，建议同步规划）

- 访问令牌 `qb_session` 寿命短（如 15 分钟）；刷新令牌 `qb_refresh` 寿命长（如 7 天）。
- 后端对过期访问令牌返回 `401`；前端 `apiFetch` 拦截到 `401` 时：
  1. 调用 `POST /api/auth/refresh`（依赖 `qb_refresh` Cookie）；
  2. 成功 → 拿到新 `qb_session` Cookie，自动重试原请求；
  3. 失败 → 触发全局登出（`logout()`，已有机制）。
- 此逻辑复用现有 `apiFetch` 的 401 钩子（见前端改动 7.4），无需改动业务调用方。

---

## 4. 目标认证链路

```
LoginPage → window.location.href = getOALoginUrl()        // 仅带 next，不带令牌
  → OA 代理 → 回跳 /login?status=success&code=<code>&next=<path>
AuthContext 解析 query → POST /api/auth/oa/callback { code, next }
  后端: code 换 token → Set-Cookie(qb_session, qb_refresh) → { ok, user, next }
AuthContext: 不再存令牌，仅保存 user → navigate(next)
后续请求: 浏览器自动带 Cookie，apiFetch 遇 401 → refresh 或 logout
登出: POST /api/auth/logout（后端清 Cookie）→ 前端清 user 态
```

---

## 5. 前后端接口契约（目标态）

### 5.1 OA 回跳（OA 平台侧）
```
GET /login?status=success&code=<authorization_code>&next=<path>
```
- `code`：一次性、短期（建议 ≤ 60s），泄露不可重用。
- `next`：站内相对路径（前端已做 `startsWith('/')` 校验，防开放重定向）。

### 5.2 `POST /api/auth/oa/callback`
请求：
```json
{ "code": "<authorization_code>", "next": "/rty" }
```
响应（成功）：
```json
{ "ok": true, "user": { "itcode": "...", "name": "..." }, "next": "/rty" }
```
后置动作：后端 `Set-Cookie` 下发 `qb_session` / `qb_refresh`。
失败：返回 `401` 或 `4xx` + `{ detail }`，前端提示错误并留在登录页。

### 5.3 `GET /api/auth/me`
- 依赖 `qb_session` Cookie 鉴权。
- 响应：`{ "sessionId": "...", "itcode": "...", "user": {...} }`（契约不变）。
- 失效返回 `401` → 触发前端 `apiFetch` 的登出/刷新钩子。

### 5.4 `POST /api/auth/logout`
- 依赖 `qb_session` Cookie。
- 后端使会话失效、清除刷新令牌，并 `Set-Cookie` 令 `qb_session`/`qb_refresh` 过期。
- 前端调用后清本地 `user` 态并跳转 `/login`。

### 5.5 `POST /api/auth/refresh`（阶段二）
- 依赖 `qb_refresh` Cookie。
- 成功：刷新 `qb_session` 的 `Set-Cookie`；响应 `200`。
- 失败：返回 `401` → 前端 `logout()`。

### 5.6 Cookie 属性约定

| 名称 | HttpOnly | Secure | SameSite | Path | Max-Age |
|------|----------|--------|----------|------|---------|
| `qb_session` | ✅ | ✅ | Lax | `/` | 900s（阶段二） |
| `qb_refresh` | ✅ | ✅ | Lax | `/api/auth/refresh` | 604800s（阶段二） |

> 生产环境 Cookie 的 `Domain` 需与业务网关域名一致（经 Nginx 反代时，前端与 `/api` 同域，可不显式设 Domain）。

---

## 6. 前端改动清单

### 6.1 `src/api/authApi.ts`
- 移除模块级 `sessionToken` 单例与 `localStorage` 读写（`setSessionToken`/`restoreSessionTokenFromStorage`/`clearSessionToken`）。
- `withAuthHeaders` 不再注入 `X-Session-Token`（改为依赖 Cookie，或直接删除该函数）。
- 新增 `submitOALogin(code, next)` → `POST /api/auth/oa/callback`（复用此前删除的骨架，契约见 5.2）。
- `getCurrentUser` 维持 `GET /api/auth/me`，不再手动带令牌头。

### 6.2 `src/context/AuthContext.tsx`
- `useEffect` 回调分支改为：取 `code` → `submitOALogin(code, next)` → 成功保存 `user`（**不存令牌**）→ `navigate(next)`。
- `logout` 改为先 `POST /api/auth/logout`，再清 `user` 态（双向生效，治 R4）。
- `registerUnauthorizedHandler(logout)` 维持（全局 401 自动登出机制不变）。

### 6.3 `src/pages/LoginPage.tsx` / `getOALoginUrl`
- `getOALoginUrl()` 维持只带 `next`（当前已是站内路径），无需改。**不再期望回跳带 `token`**。
- `OA_LOGIN_BASE_URL` 已为 `https://` 且支持 `VITE_OA_LOGIN_URL` 覆盖，保持不变。

### 6.4 `src/api/authApi.ts` 的 `apiFetch`
- 移除 `withAuthHeaders` 注入逻辑（或置空）；请求依赖浏览器自动带 Cookie。
- 401 钩子逻辑不变：触发 `unauthorizedHandler()`（阶段二扩展为 refresh 重试）。

---

## 7. 后端改动清单

| 接口 | 改动 |
|------|------|
| OA 回跳 | 与 OA 平台确认返回 `code` 而非 `token`；配置 `redirect_uri` 白名单 + `client_id` |
| `POST /api/auth/oa/callback` | 用 `code` 向 OA 换 token；校验后 `Set-Cookie` 下发会话；返回 `{ ok, user, next }` |
| `GET /api/auth/me` | 由读 `X-Session-Token` 头改为读 `qb_session` Cookie；失效返回 `401` |
| `POST /api/auth/logout` | 新增：使会话失效、清刷新令牌、`Set-Cookie` 过期 |
| `POST /api/auth/refresh` | 阶段二新增：用 `qb_refresh` 刷 `qb_session` |
| 网关代理 | 确保 `/api` 反代透传 `Set-Cookie` 与 `Cookie`（Nginx 默认透传，注意不剥离） |

---

## 8. 迁移与兼容过渡

建议**双轨并行**灰度，避免一次性切换导致登录全挂：

1. **阶段一（Cookie 化，低风险）**：后端开始下发 `qb_session` Cookie，同时保留 `X-Session-Token` 头兼容；前端先切到「Cookie 优先」，移除 localStorage 存令牌。此时即使 OA 仍回跳带 `token`，前端仍可用 `token` 换 Cookie。
2. **阶段二（授权码模式）**：OA 平台侧切到返回 `code`；前端改为走 `submitOALogin(code)`；移除 URL 取 `token` 逻辑。
3. **阶段三（刷新机制）**：接入 `qb_refresh` 与 `apiFetch` 自动刷新。

退回方案：任一阶段出问题，后端回退为同时接受 `X-Session-Token` 头即可兼容旧前端。

---

## 9. 验收标准

- [ ] 登录成功后，地址栏无 `token`/`code` 之外不应出现的敏感参数（`replaceState` 已清）。
- [ ] DevTools → Application → Cookies 中 `qb_session` 标记为 `HttpOnly`，Console 中 `document.cookie` 不含该值（验证 R2 已治）。
- [ ] 模拟 XSS（控制台 `localStorage.getItem('qualiboard-session-token')`）返回 `null`。
- [ ] 令牌到期后，停留页面调用接口触发 `401` → 自动刷新或登出，不再卡「僵尸态」。
- [ ] 点登出后，后端会话失效，旧 `qb_session` 不可再用于 `/api/auth/me`。

---

## 10. 待与后端 / OA 平台确认事项

1. OA 代理（`springboard_v3/login_proxy`）是否支持授权码流程？能否配置 `redirect_uri` 与 `client_id`？
2. 后端网关 `localhost:4001`（生产 Nginx）是否透传 `Set-Cookie` / `Cookie`？
3. 会话令牌的签名/加密方案与过期时长约定（访问令牌 15min、刷新 7d 为建议值）。
4. 多标签页会话一致性：采用 Cookie 后天然共享，无需前端额外同步。
