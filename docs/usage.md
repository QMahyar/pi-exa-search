# Usage — @qmahyar/pi-exa-search

## `/exa`

Interactive key manager: add, reorder, test, remove. Supports multi-key fallback on 429.

## Tools

| Tool | Label | Purpose |
|------|-------|---------|
| `web_search` | Search | Neural search with highlights |
| `web_fetch` | Fetch | Full content for known URLs |

### web_search tips

- Describe the ideal page, not keyword soup  
- `category`, `includeDomains`, `recencyFilter` when useful  
- Default is highlights; set `includeText` only if you need longer snippets  

### web_fetch tips

- Absolute `http(s)` URLs, comma- or space-separated  
- Batch several URLs in one call  

## Related

[pi-9router](https://github.com/QMahyar/pi-9router) if you want gateway chat models + image/TTS tools.
