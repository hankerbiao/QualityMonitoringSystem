# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Enterprise-grade quality data integration platform consolidating four quality modules:
- **RTY**: 整机综合直通率 (Overall First Pass Yield) - **Fully implemented**
- **LRR**: 部件故障率 (Part Failure Rate) - Planned
- **DOA**: 开箱报修率 (Out-of-Box Failure Rate) - Planned
- **MFR**: 月化故障率 (Monthly Field Failure Rate) - Planned

## Repository Structure

```
QualiBoard/
├── frontend/          # Main development area (React + Vite + TypeScript)
├── backend/           # Reserved for future backend services
├── docker/            # Reserved for containerization
└── .claude/           # Claude Code configuration
```

## Commands

All commands run from the `frontend/` directory:

```bash
cd frontend

npm run dev      # Start dev server on port 3000 with HTTPS
npm run build    # Production build to dist/
npm run lint     # TypeScript type check only (no linter/formatter)
npm run preview  # Preview production build
npm run clean    # Remove dist/ and server.js
```

## Tech Stack (frontend)

- **React 19** + **TypeScript 5.8**
- **Vite 6** - Build tool with HTTPS enabled (self-signed cert)
- **Tailwind CSS v4** - Uses `@tailwindcss/vite` plugin (no tailwind.config.js)
- **React Router DOM v7** - Client-side routing
- **Recharts** - Charts (ComposedChart with Bar + Line dual-axis)
- **Lucide React** - Icons
- **xlsx** - Excel export functionality
- **Voice Recognition** - FunASR WebSocket integration (see VoiceInput.tsx)

## Architecture

### Source Structure

```
frontend/src/
├── api/
│   ├── rtyApi.ts       # Mock API with delay() wrapper (500ms simulated latency)
│   └── mockData.ts     # Generated mock data
├── components/
│   ├── AIAssistant.tsx      # Floating AI assistant (rule-based mock responses)
│   ├── AlertConfigModal.tsx # Email alert configuration
│   ├── DefectModal.tsx      # Defect detail modal
│   ├── DetailModal.tsx      # Common detail modal
│   ├── InputModal.tsx       # Input detail modal
│   ├── SettingsModal.tsx    # System configuration (MES, RTY targets, alerts)
│   └── VoiceInput.tsx       # Voice input with FunASR WebSocket
├── context/
│   ├── ModelTargetsContext.tsx  # RTY target rates per model
│   └── SettingsContext.tsx      # System settings state
├── hooks/
│   └── useVoiceRecognition.ts   # WebSocket audio streaming to FunASR
├── pages/
│   ├── Home.tsx    # Dashboard with 4 module cards (Bento Grid layout)
│   └── RTYPage.tsx # RTY data table + charts + modals (~580 lines)
├── types.ts        # Shared interfaces: RTYData, DefectDetail, InputDetail
├── App.tsx         # Router setup with /, /rty, /lrr, /doa, /mfr routes
└── index.css       # Tailwind v4 imports + Inter/JetBrains Mono fonts
```

### Key Patterns

- **Path alias**: `@/*` maps to frontend root (vite.config.ts + tsconfig.json)
- **Mock API pattern**: All API calls return Promises with `delay()`. Ready for real backend replacement.
- **Modal pattern**: Parent manages visibility state, passes `recordId` for data fetching
- **Voice recognition**: WebSocket connection → AudioContext (16kHz) → ScriptProcessor → PCM16 streaming → FunASR backend
- **Chart integration**: Recharts `ComposedChart` with dual Y-axes for production volume + RTY rate

### Routes

| Path | Component | Status |
|------|-----------|--------|
| `/` | Home | ✅ |
| `/rty` | RTYPage | ✅ |
| `/lrr` | Home (redirect) | Planned |
| `/doa` | Home (redirect) | Planned |
| `/mfr` | Home (redirect) | Planned |

## Configuration

### Vite (vite.config.ts)
- HTTPS enabled with self-signed certificates (`key.pem`, `cert.pem`)
- WebSocket proxy: `/ws-voice` → `ws://10.17.150.235:10095` (FunASR service)
- HMR can be disabled via `DISABLE_HMR=true` environment variable

### TypeScript (tsconfig.json)
- Target: ES2022, Module: ESNext
- Strict mode enabled
- Path alias: `@/*` → `./`

### Environment Variables

Create `frontend/.env` from `frontend/.env.example`:
```
GEMINI_API_KEY=your_key  # For future AI features
APP_URL=your_app_url     # For self-referential links
```

## Voice Input Feature

Located in `src/hooks/useVoiceRecognition.ts`:
- Connects to FunASR WebSocket service
- Audio pipeline: `getUserMedia` → `AudioContext(16kHz)` → `ScriptProcessor(4096)` → `PCM16` → WebSocket
- Protocol: Send `{ type: 'end' }` to stop, receive `is_final`/`complete` for final results

## Future Work (per docs/design.md)

- [ ] Implement LRR, DOA, MFR module pages
- [ ] Add unified authentication (Auth)
- [ ] Replace mock APIs with real backend integration
- [ ] Integrate Gemini AI for AI Assistant (requires GEMINI_API_KEY)
- [ ] Email alerting system

## Notes

- `components.json` exists as shadcn/ui schema config but no components installed - all UI is custom
- Design documentation in `frontend/docs/design.md` (Chinese) describes full system spec
- Mock data can be regenerated via root scripts `generate_mock.cjs` and `update_modal.cjs`