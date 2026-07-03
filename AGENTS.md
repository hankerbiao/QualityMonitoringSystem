# AGENTS.md

## Commands

```bash
npm run dev      # Vite dev server on port 3000 (0.0.0.0)
npm run build    # Production build to dist/
npm run lint     # TypeScript type check only (no ESLint/Prettier)
npm run preview  # Preview production build locally
npm run clean    # Remove dist/ and server.js
```

## Architecture

React 19 + TypeScript 5.8 + Vite 6 + Tailwind CSS v4 (no tailwind.config.js).

Only RTY module is implemented. LRR/DOA/MFR routes redirect to home.

```
src/
├── api/rtyApi.ts      # Mock API with 500ms delay() wrapper
├── api/mockData.ts    # Generated data (run node generate_mock.cjs to regenerate)
├── pages/RTYPage.tsx  # Main page (~394 lines, handles filters + charts + modals)
├── pages/Home.tsx     # Dashboard with 4 module cards
├── components/        # Modals: DefectModal, InputModal, AlertConfigModal, etc.
├── types.ts           # RTYData, DefectDetail, InputDetail interfaces
├── lib/utils.ts       # cn() for Tailwind class merging
```

## Key Conventions

- **Path alias**: `@/*` maps to project root (vite.config.ts + tsconfig.json)
- **No linter/formatter**: `npm run lint` runs `tsc --noEmit` only
- **Tailwind v4**: Uses `@tailwindcss/vite` plugin, no config file, CSS-first config in index.css
- **Mock API**: All API calls return Promises with `delay()`. Replace with real backend later.
- **Modal pattern**: State-driven visibility in parent, passes `recordId` for data fetching
- **Utility scripts**: Root `generate_mock.cjs` regenerates mockData.ts, `update_modal.cjs` updates AlertConfigModal

## Gotchas

- HMR disabled when `DISABLE_HMR=true` env var set (AI Studio editing mode)
- `src/index.css` has Tailwind v4 imports + Inter/JetBrains Mono fonts
- Chart components use Recharts `ComposedChart` with dual Y-axes (Bar + Line)
- Design doc in `docs/design.md` is in Chinese, describes full system spec
