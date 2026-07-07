# AGENTS.md

## Project Structure

```
QualityMonitoringSystem/
├── frontend/           # React + Vite + TypeScript (main dev area)
├── backend/            # FastAPI (in progress)
└── docker/             # Reserved for containerization
```

## Commands

All frontend commands run from `frontend/` directory:

```bash
npm run dev      # Vite dev server on port 3000 (0.0.0.0, HTTPS enabled)
npm run build    # Production build to dist/
npm run lint     # TypeScript type check only (no ESLint/Prettier)
npm run preview  # Preview production build
npm run clean    # Remove dist/ and server.js
```

## Architecture

- **Monorepo**: Frontend (React/Vite) + Backend (FastAPI)
- **Only RTY module is implemented**; LRR/DOA/MFR routes redirect to Home
- **Path alias**: `@/*` maps to `frontend/` root
- **Backend connected**: All API calls proxied to `http://localhost:8000`

## Key Conventions

- **Tailwind v4**: Uses `@tailwindcss/vite` plugin, no config file, CSS-first in `index.css`
- **Mock API**: All API calls use `delay()` wrapper (500ms). Ready for real backend replacement.
- **Dual Token Auth**: access_token (15min, localStorage) + refresh_token (30day, sessionStorage) + auto-refresh
- **Settings**: SettingsModal saves all configs via `PUT /api/settings`, RTYPage listens for `settings-saved` event
- **MES Password**: Returned in plaintext from backend, toggle with eye icon
- **Table sorting**: RTYPage supports sorting by time, defectCount, inputCount, rtyRate
- **Excel export**: Uses `xlsx` library, supports column selection

## Gotchas

- HMR disabled when `DISABLE_HMR=true` env var set (AI Studio editing mode)
- `src/index.css` has Tailwind v4 imports + Inter/JetBrains Mono fonts
- Chart components use Recharts `ComposedChart` with dual Y-axes (Bar + Line)
- Design doc in `frontend/docs/design.md` (Chinese) describes full system spec
- RTYPage includes quick navigation tabs to switch between modules (RTY/LRR/DOA/MFR)
- MongoDB port is **27019** (not default 27017)

## Testing / Verification

- No test suite; verify with `npm run lint`
- Mock data: regenerate via `node generate_mock.cjs` at project root

## Design Doc

`frontend/docs/design.md` (Chinese) describes full system spec.
Skills provide specialized instructions and workflows for specific tasks.
Use the skill tool to load a skill when a task matches its description.