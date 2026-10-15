# RTY Simplification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep order reads complete, prevent saving unloaded settings, and remove fabricated details and unused export calculations.

**Architecture:** Use the gateway client's checked pagination and existing short-lived cache for every complete order read. Share raw export loading across template, cycle, and station exports; only the template builds summary and TOP rows. Bind settings readiness to the authenticated user, role, and load attempt.

**Tech Stack:** FastAPI, Python, httpx, pytest, React, TypeScript, Vitest.

## Design Decisions

- Choose a shared complete order reader over separate dashboard/export readers. Reject oversized, malformed, or incomplete responses, including cached responses.
- Keep bounded full-detail requests: the upstream list projection omits required fields and the inspected gateway has no bulk detail API. Removing these requests would corrupt exports.
- Add a cycle source export endpoint with RTY permissions. Keep the existing template and station response contracts.
- Return only real defect details. Empty detail results stay empty; upstream failures propagate.
- Settings drafts become editable only after a successful load for the current user and role. Failed loads show an error and an explicit retry. Defaults are initial display state, never a substitute for loaded configuration when saving.
- Work with existing uncommitted changes; do not commit or modify the separate gateway repository.

## Task 1: Complete Order Reads

Files: `backend/app/services/data_gateway_client.py`, `backend/app/services/rty_export.py`, `backend/tests/unit/test_data_gateway_client.py`.

1. Add regression tests for more than 10,000 orders, malformed/incomplete pages, and cached/concurrent requests with different limits.
2. Make `all_orders` use checked pagination, sharing cache entries only for the same filter and row limit.
3. Reject cached over-limit data instead of slicing it. Validate each page against the declared total; do not infer totals or discard malformed rows.
4. Route export order reads through `all_orders`; retain exact model/base selection before full-detail hydration.

Validation: `cd backend && uv run pytest tests/unit/test_data_gateway_client.py tests/unit/test_rty_export.py -q`.

Status: implemented; order/client/export regression tests passed, including the 10,001-order case.

## Task 2: Genuine Defect Details

Files: `backend/app/services/rty_gateway.py`, `backend/tests/unit/test_rty_gateway.py`.

1. Reproduce lookup associations with empty or unrelated full details, and a failing detail request.
2. Remove substitution of lookup associations for full detail records.

Validation: `cd backend && uv run pytest tests/unit/test_rty_gateway.py -q`.

Status: implemented; empty, unrelated, and failed detail source regressions passed.

## Task 3: Shared Export Sources

Files: `backend/app/services/rty_export.py`, `backend/app/api/rty.py`, `frontend/src/api/rtyApi.ts`, related API/export tests and export documentation.

1. Extract order/fault selection, composite attribution, and source-ID deduplication into one source loader.
2. Let station and cycle exports project source columns directly. Keep summary/TOP calculations in the template builder.
3. Preserve exact filters, permission boundaries, missing values, leading zeros, repeated repairs, source IDs, and existing workbook sheets.
4. Delete the unused `frontend/src/components/rty/exportData.ts` and its obsolete test.

Validation: backend export/API tests; frontend API/cycle/workbook tests.

Status: implemented; raw sources match template sources, source-only builds skip metrics, and cycle/station permission tests passed.

## Task 4: Settings Load State

Files: `frontend/src/context/SettingsContext.tsx`, `frontend/src/types/settings.ts`, `frontend/src/components/SettingsModal.tsx`, corresponding tests.

1. Add regression tests for load failure, saving before load, retry, and changing identity/role while requests are pending.
2. Track the load result by user, role, and attempt; ignore outdated responses.
3. Block writes until a successful current load. Show error/retry in the modal and hide editable drafts during failed/pending loads.

Validation: `cd frontend && npm test && npm run lint && npm run build`.

Status: implemented; failed/pending loads cannot write, retry recovers, and outdated account/role responses are ignored.

## Final Verification

Run the full backend suite because the order reader serves multiple dashboards. Run frontend tests, typecheck/build, scoped Ruff checks, and `git diff --check`. Record results and remaining upstream limitations here.

- Backend full suite: 339 passed; nine existing deprecated-field warnings.
- Frontend full suite after final cleanup: 86 passed across 17 test files.
- Frontend typecheck and production build: passed.
- Scoped Ruff checks and whitespace checks: passed.
- Final checks after the last cleanup: 62 backend order/client/export tests passed; frontend full suite, typecheck, and production build passed; scoped Ruff and whitespace checks passed.
- Remaining dependency: full order fields still require up to eight concurrent per-order detail requests. Eliminating N+1 requires a bulk/full-field interface in the separate gateway.
- Existing local frontend/backend listeners on ports 4000/4001 were reused without restarting services. No production writes or commits were made.
