# AGENTS.md

## Project Structure

```
frontend/
├── src/
│   ├── pages/           # LoginPage, RTYPage, Home
│   ├── context/         # AuthContext, SettingsContext
│   ├── api/             # authApi, rtyApi, settingsApi
│   ├── components/      # SettingsModal, DefectModal, etc.
│   └── index.css        # Tailwind v4 CSS-first
├── docs/design.md       # 设计系统文档
└── vite.config.ts       # Vite + API proxy
```

## Commands

```bash
npm run dev      # Vite dev server port 4000 (binds 0.0.0.0)
npm run build    # Production build to dist/
npm run lint     # TypeScript 类型检查 (无 ESLint/Prettier)
npm run preview  # Preview production build
npm run clean    # Remove dist/ and server.js
```

## Key Conventions

- **双 Token 认证**: access_token localStorage (15min) + refresh_token sessionStorage (30day)
- **AuthContext**: 暴露 `isAuthLoaded` 状态，ProtectedLayout 和子 Context 必须等其 true 后才发 API
- **Settings**: `PUT /api/settings` 保存，监听 `settings-saved` 事件刷新
- **Excel 导出**: `xlsx` 库，支持列选择
- **Tailwind v4**: CSS-first，入口为 `@import "tailwindcss"`

## Critical Gotchas

- **刷新后重新登录 bug**: `ProtectedLayout` 必须等 `isAuthLoaded` 为 true 后才检查 `isAuthenticated`
- **HMR**: `DISABLE_HMR=true` 环境变量禁用热更新
- **MongoDB**: 后端端口 **27019**

## Testing

- 无测试套件，用 `npm run lint` 验证
