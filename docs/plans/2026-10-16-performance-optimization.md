# Performance Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove redundant export and authorization work while preserving source consistency, base permissions, and existing reporting rules.

**Architecture:** Reuse bounded process-local caches and existing gateway sync versions. Cache immutable authorization indexes and serialized export responses. Validate versions before publishing cached snapshots. Keep photo pages short-lived and issue fresh image grants per request. No new infrastructure.

**Tech Stack:** FastAPI, Motor, Pydantic, React, TypeScript, pytest, Vitest.

## Tasks

- [x] Version order-list caches and recheck export source generations before caching.
- [x] Add bounded immutable order ownership indexes and serialized export response caching.
- [x] Bucket repair groups by model and skip unused legacy TOP aggregation for integrated exports.
- [x] Use direct single-base photo pagination and reusable fixed-size pages for multiple bases.
- [x] Share saved station configuration with ordinary users; keep editing restricted to administrators.
- [x] Add focused regression coverage, run backend/frontend checks, and measure warm-path improvements.

## Cache Contracts

- Export source/response caches: at most eight entries each, one-hour TTL, source URL, versions, filters, and current base scope in keys. Response keys additionally include BOM version and export schema version.
- Order ownership: immutable per-base sets, bounded cache, source URL and order version in keys; scope unions keyed by the current permission tuple. Unversioned gateways retain conservative uncached authorization behavior.
- Photos: at most 512 upstream pages, ten-second TTL, client generation and exact page/filter in keys. Failures are not cached. Credentials invalidation clears page cache.
- Missing trustworthy source versions bypass long-lived export caches. Mid-read version changes fail with a retryable source error.

## Verification

Exercise sync rollover, concurrent loads, failed loads, mutable value isolation, permission changes, BOM rollover, filter/kind isolation, fixed-size photo pagination, credential invalidation, and ordinary/admin station settings contracts. Run existing reporting-rule tests and complete backend/frontend suites, type checking, and production build. Use synthetic measurements only; do not mutate production data.

## Implementation Map

| Area | Implementation | Regression Coverage |
| --- | --- | --- |
| Sync generations | `backend/app/services/data_gateway_client.py`, `rty_export.py` | `test_data_gateway_client.py`, `test_rty_export.py` |
| Immutable ownership | `backend/app/services/async_ttl_cache.py`, `rty_gateway.py` | `test_async_ttl_cache.py`, `test_base_access.py` |
| Serialized exports | `backend/app/services/rty_export.py`, `backend/app/api/rty.py` | `test_rty_export.py`, `test_rty_api.py` |
| Repair grouping | `backend/app/services/repair_integration.py` | Existing material/counting tests plus integrated-export regression |
| Photo pagination | `backend/app/services/process_record_service.py` | `test_base_access.py`, existing source-client tests |
| Station configuration | Backend settings schema/service/API, frontend station page/settings types | Settings/admin integration tests, station-page/context tests |

Ruling: Initial implementation and review used the existing checkout on `codex/performance-cache-optimization` without publishing changes. On 2026-10-16, the user explicitly authorized committing, pushing all changes, and deploying to production. Preserve production configuration and verify the release without changing business data.

Ruling: Keep the existing cross-base merge order. Different sources paginate by source ID while the application orders by submission time; a cursor/heap merge would require a matching upstream sort contract. Multi-base cold deep pages still accumulate prefixes, using fixed-size cached pages. Normal next-page navigation can reuse those pages for ten seconds.

## Validation Results

- Backend: `cd backend && .venv/bin/python -m pytest -q -o addopts= tests/unit tests/integration` — 468 passed; nine existing deprecation warnings.
- Frontend: `cd frontend && npm test -- --reporter=dot` — 143 passed across 23 files in the final workspace run (including concurrent unrelated frontend changes).
- `npm run lint` and `npm run build` passed.
- Ruff checks passed for changed Python files.

Seven-repeat synthetic measurements, median on this workstation:

| Scenario | Before | After |
| --- | --- | --- |
| 50,000 orders / 25,000 authorized, warm authorization | 266.887 ms | 0.0038 ms |
| 10,000 orders + 25,000 faults, 2,039,542-byte JSON serialization / warm response cache | 5.5505 ms | 0.0081 ms |
| Sorting/filtering 10,000 repair groups across 100 models | 76.184 ms | 0.3838 ms |
| Single-base photo page 100, page size 30 | Request page 1 with 3,000 rows | Request page 100 with 30 rows |

These are local algorithm/cache measurements with mocked gateway versions, not production latency estimates. The export measurement isolates serialization savings; the warm response also avoids the real source decompression and aggregation. Eight identical export calls invoked the export builder once. Repair timings isolate the sorting kernel, not the entire repair export. Photo pagination is checked by upstream request assertions.

Caches are process-local and bounded by entry count, so memory use scales with worker count and response size. No new package, database collection, or infrastructure was added.
