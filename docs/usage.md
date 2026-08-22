# Usage — @qmahyar/pi-exa-search

## `/exa`

Interactive key manager: add, reorder, test, remove. Shows live cooldown countdowns.

## Tools

| Tool | Label | Purpose |
|------|-------|---------|
| `web_search` | Search | Neural search with highlights |
| `web_fetch` | Fetch | Full content for known URLs (live-crawl aware) |

### web_search parameters

| Param | Notes |
|-------|-------|
| `query` | Describe the ideal page, not keyword soup |
| `numResults` | Default 5, capped at 20 |
| `recencyFilter` | `day` / `week` / `month` / `year` |
| `category` | Known: company, people, publication, news, personal site, financial report; other strings are hints. `company`/`people` ignore recency + excludeDomains |
| `includeDomains` / `excludeDomains` | Comma-separated domains (prefer over `site:` in the query) |
| `type` | `auto` (default), `fast`, `instant`, or `deep-lite` / `deep` / `deep-reasoning` for hard research (slower, costlier) |
| `includeText` | Also return page text (default: highlights only) |
| `maxCharacters` | Per-result text cap when `includeText` (default 2000, max 10000) |

### web_fetch parameters

| Param | Notes |
|-------|-------|
| `urls` | Absolute `http(s)` URLs, comma- or space-separated; batch several in one call |
| `maxCharacters` | Per page (default 5000, max 10000) |
| `highlightsQuery` | Focus query for highlights |
| `maxAgeHours` | Freshness: `-1` cache only (fastest), `0` always live-crawl (freshest), `N` use cache if newer than N hours. Default: live-crawl only when no cache exists |
| `subpages` | Crawl up to N linked subpages per URL (max 10) — great for docs sites |
| `subpageTarget` | Comma-separated section names to target (e.g. `docs, api`) |

### Tips

- Output is capped (~45KB / 2000 lines); oversized payloads are saved to a temp file and the path is reported
- Errors are thrown (pi renders them as failed tool calls), so the agent sees and can recover from them
- Key rotation: 429 → cooldown per `Retry-After`; 401/403 → 1h; 402 → 10m; 5xx/network → retried twice with backoff before rotating
- Per-request timeout is 30s (override with `PI_EXA_TIMEOUT_MS`)

## Related

Config file location can be overridden with `PI_WEB_SEARCH_CONFIG` (advanced/testing).
