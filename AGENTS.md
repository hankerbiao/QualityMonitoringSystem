# AGENTS.md

## Project Structure

```
QualityMonitoringSystem/
├── frontend/           # React + Vite + TypeScript
├── backend/            # FastAPI (已实现 RTY + Settings + OA 登录)
└── docker/             # Reserved for containerization
```

## Commands

Frontend (from `frontend/` directory):

```bash
npm run dev      # Vite dev server on port 3000
npm run build    # Production build to dist/
npm run lint     # TypeScript type check only (no ESLint/Prettier)
npm run preview  # Preview production build
npm run clean    # Remove dist/ and server.js
```

Backend (from `backend/` directory):

```bash
uv sync                                           # 安装依赖
uv run uvicorn app.main:app --reload --port 8000  # 启动服务
uv run python init_default_settings.py             # 初始化配置
```

## Architecture

- **Monorepo**: Frontend (React/Vite) + Backend (FastAPI)
- **Only RTY module is implemented**; LRR/DOA/MFR routes redirect to Home
- **Path alias**: `@/*` maps to `frontend/` root
- **Backend connected**: Frontend proxies `/api/*` to `http://localhost:8000`

## Key Conventions

- **Tailwind v4**: Uses `@tailwindcss/vite` plugin, no config file, CSS-first in `index.css`
- **Mock API**: All API calls use `delay()` wrapper (500ms). Ready for real backend replacement.
- **OA Login**: ProtectedLayout checks localStorage.token, redirects to /login if missing
- **Settings**: SettingsModal saves all configs via `PUT /api/settings`, RTYPage listens for `settings-saved` event
- **MES Password**: Returned in plaintext from backend, toggle with eye icon
- **MongoDB port**: **27019** (not default 27017)
- **HMR disabled** when `DISABLE_HMR=true` env var set (AI Studio editing mode)

## Testing / Verification

- No test suite; verify with `npm run lint`
- Mock data: regenerate via `node generate_mock.cjs` at project root

## Design Doc

`frontend/docs/design.md` (Chinese) describes full system spec.

## API Integration Status

- ✅ RTY data (list, defects, inputs, cycle-stats)
- ✅ Settings management (MES, model targets, email alert, AI)
- ✅ OA login (JWT verification, dual token issuance)
- ✅ Dual Token auth (access_token 15min + refresh_token 30day with auto-refresh)
- ✅ AI analyze endpoint
- 🚧 LRR/DOA/MFR pages
- 🚧 Email sending