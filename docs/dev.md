# Dev — @qmahyar/pi-exa-search

```text
extensions/web-search.ts   # /exa + web_search + web_fetch (single file, loaded by pi's TS loader)
test/                      # vitest: config, rotation/cooldowns/retry, tool behavior, live E2E
```

Config: `~/.pi/web-search.json` (path via `CONFIG_DIR_NAME`; file chmod 0600; override with `PI_WEB_SEARCH_CONFIG`)  
Auth: config keys → `EXA_API_KEY` (via `x-api-key` header)  
Cooldowns: in-memory only (reset on restart, never written to the key list) — 429 uses `Retry-After` (max 5m, default 60s), 401/403 → 1h, 402 → 10m  
Retry: 5xx/408/425 + network errors retry the same key twice (300ms/900ms backoff) before rotating  
Timeout: 30s per request (`PI_EXA_TIMEOUT_MS`), combined with the caller's abort signal via `AbortSignal.any`  
Truncation: tool output capped at pi's built-in limit; overflow → temp file  
Errors: `execute` throws (pi's error contract); thrown errors surface as failed tool calls  

## Tests

```bash
npm test                    # unit tests (mocked fetch, no network)
npm run typecheck           # tsc --noEmit

# live end-to-end (costs a fraction of a cent):
PI_EXA_E2E=1 EXA_API_KEY=… npm test
```

Tests load the real extension module through a fake `pi` API and drive the registered tools with a scripted `fetch`, so they exercise the actual code path (rotation, cooldowns, retry/backoff, truncation, formatting, rendering).

Publish: `npm publish --access public` (name `@qmahyar/pi-exa-search`).
