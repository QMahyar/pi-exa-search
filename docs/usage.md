# Usage

## web_search

Neural web search via Exa. Default response uses **highlights** (relevant excerpts) instead of full page text — cheaper and easier on context.

The agent usually calls this on its own. You can also ask it to search explicitly.

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | — | **Required.** Describe the ideal page, not keyword soup. |
| `numResults` | integer | 5 | Results 1–20 |
| `recencyFilter` | string | — | `day` · `week` · `month` · `year` |
| `category` | string | — | `company` · `people` · `publication` · `news` · `personal site` · `financial report` |
| `includeDomains` | string | — | Comma-separated allowlist, e.g. `docs.python.org, github.com` |
| `excludeDomains` | string | — | Comma-separated blocklist |
| `type` | string | `auto` | `auto` · `fast` · `instant` |
| `includeText` | boolean | `false` | Also return full text snippets (heavier) |
| `maxCharacters` | integer | 2000 | Per-result text cap when `includeText` is true (max 10000) |

**Notes**

- `category: company` / `people` do **not** support `recencyFilter` or `excludeDomains` (Exa API limit).
- Prefer `includeDomains` over putting `site:` in the query.
- When highlights are not enough, follow up with **`web_fetch`** on the best URLs.

### Examples

```
web_search(query: "official pi coding agent extension API documentation")
web_search(query: "AI regulation policy updates", recencyFilter: "week", category: "news")
web_search(query: "TypeScript satisfies operator handbook", includeDomains: "www.typescriptlang.org, github.com")
web_search(query: "founders of exa.ai", category: "people")
```

## web_fetch

Fetch clean content for **known URLs**. Batch several URLs in one call.

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `urls` | string | — | **Required.** Absolute `http(s)` URLs, comma- or space-separated |
| `maxCharacters` | integer | 5000 | Cap per page (max 10000) |
| `highlightsQuery` | string | — | Optional focus for highlight extraction |

### Examples

```
web_fetch(urls: "https://exa.ai/docs/reference/search")
web_fetch(urls: "https://pi.dev https://github.com/QMahyar/pi-exa-search", maxCharacters: 3000)
```

## /exa command

Interactive key manager:

| Action | Description |
|--------|-------------|
| **+ Add new key** | Paste API key, optional label, optional live test |
| **↑ / ↓** | Change priority (top key is tried first) |
| **✎ Edit label** | Rename |
| **✓ Test key** | Cheap 1-result search to verify the key |
| **⎘ Show full key** | Display unmasked key |
| **✕ Remove** | Delete with confirmation |
| **⟳ Test top key** | Quick health check on priority key |

## Multi-key fallback

1. Keys are tried in list order (then `EXA_API_KEY` if set and not already listed).
2. On **429**, that key gets a cooldown (honors `Retry-After` when present, else 60s).
3. Next key is tried automatically.
4. **401/403/402** skip that key; bad request **4xx** stops without burning the whole pool.
5. If everything fails, the tool returns the last error.

## Config

`~/.pi/web-search.json`:

```json
{
  "keys": [
    { "key": "…", "label": "personal" },
    { "key": "…", "label": "work" }
  ]
}
```

Optional env fallback:

```bash
export EXA_API_KEY=…
```
