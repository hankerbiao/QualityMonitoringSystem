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
cd frontend
npm run dev      # Vite dev server on port 3000 (0.0.0.0, HTTPS enabled)
npm run build    # Production build to dist/
npm run lint     # TypeScript type check only (no ESLint/Prettier)
npm run preview  # Preview production build
npm run clean    # Remove dist/ and server.js
```

## Architecture

- **Monorepo**: Frontend (React/Vite) + Backend (FastAPI, work-in-progress)
- **Only RTY module is implemented**; LRR/DOA/MFR routes redirect to Home
- **Path alias**: `@/*` maps to `frontend/` root

## Key Conventions

- **Tailwind v4**: Uses `@tailwindcss/vite` plugin, no config file, CSS-first in `index.css`
- **Mock API**: All API calls use `delay()` wrapper (500ms). Ready for real backend replacement.
- **Voice input**: WebSocket to FunASR at `ws://10.17.150.235:10095`, audio pipeline: `getUserMedia` → `AudioContext(16kHz)` → `ScriptProcessor(4096)` → PCM16 → WebSocket
- **HMR disabled** when `DISABLE_HMR=true` env var set (AI Studio editing mode)

## Testing / Verification

- No test suite; verify with `npm run lint`
- Mock data: regenerate via `node generate_mock.cjs` at project root

## Design Doc

`frontend/docs/design.md` (Chinese) describes full system spec.