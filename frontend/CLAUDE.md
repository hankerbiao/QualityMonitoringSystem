# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

QualiBoard 品质看板 - A React-based frontend for integrating four quality data subsystems:
- **RTY**: Overall First Pass Yield (整机综合直通率)
- **LRR**: Factory Part Failure Rate (部件故障率)
- **DOA**: Out-of-Box Failure Rate (开箱报修率)
- **MFR**: Monthly Field Failure Rate (月化故障率)

Currently, only the RTY module is fully implemented.

## Commands

See AGENTS.md for the full command reference. Quick reference:

```bash
npm run dev      # Start dev server on port 3000
npm run build    # Production build
npm run lint     # TypeScript type check only (no linter installed)
npm run preview  # Preview production build
```

## Tech Stack

- **React 19** + **TypeScript 5.8**
- **Vite 6** - Build tool
- **Tailwind CSS v4** - Using `@tailwindcss/vite` plugin (no tailwind.config.js)
- **React Router DOM v7** - Client-side routing
- **Recharts** - Charts (ComposedChart, Bar, Line)
- **Lucide React** - Icons

> Note: `components.json` exists as shadcn/ui schema config, but no components have been installed. All UI components are custom-built.

## Architecture

```
src/
├── api/           # Data layer - currently mock data, ready for real backend
│   ├── rtyApi.ts  # API methods with 500ms simulated delay
│   └── mockData.ts
├── components/    # Modal components (DefectModal, InputModal, AlertConfigModal, etc.)
├── pages/
│   ├── Home.tsx   # Dashboard with 4 module cards (Bento Grid layout)
│   └── RTYPage.tsx
├── types.ts       # Shared TypeScript interfaces (RTYData, DefectDetail, InputDetail)
├── lib/utils.ts   # Utility functions (cn for class merging)
├── App.tsx        # Router setup with routes: /, /rty, /lrr, /doa, /mfr
└── index.css      # Tailwind v4 imports, Inter + JetBrains Mono fonts
```

## Key Patterns

- **Path aliases**: `@/*` maps to project root for imports
- **Mock API structure**: All API calls return Promises, simulating async with `delay()`
- **Modal pattern**: State-driven modal visibility with `recordId` prop for data fetching
- **Filter state**: Centralized `RTYFilterParams` state in RTYPage
- **Chart integration**: Recharts `ResponsiveContainer` with `ComposedChart` (Bar + Line dual-axis)

## Configuration Files

- `vite.config.ts` - Vite with Tailwind v4 plugin, `@/` alias, HMR control via `DISABLE_HMR`
- `tsconfig.json` - ES2022 target, bundler module resolution, `paths` for `@/*`
- `components.json` - shadcn/ui schema config placeholder (style: base-nova, prefix: "")

## Environment Variables

Create `.env` from `.env.example`:
```
GEMINI_API_KEY=your_key  # Not currently used (AI features planned)
```

## Future Work (per docs/design.md)

- Implement LRR, DOA, MFR module pages
- Add authentication (Auth)
- Replace mock APIs with real backend integration
- Add email alerting system