# Usage

## web_search Tool

The agent calls this automatically. You can also invoke it directly:

```
web_search(query: "exa api documentation")
```

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | — | Search query (required) |
| `numResults` | integer | 5 | Results 1-10 |
| `recencyFilter` | string | — | `day`, `week`, `month`, `year` |

### Examples

```
web_search(query: "pi coding agent", numResults: 3)
web_search(query: "latest AI news", recencyFilter: "day")
web_search(query: "exa neural search", recencyFilter: "month")
```

## /exa Command

Interactive key manager:

| Action | Description |
|--------|-------------|
| **+ Add new key** | Paste API key, set optional label |
| **↑ Move up** | Increase priority |
| **↓ Move down** | Decrease priority |
| **✎ Edit label** | Rename the label |
| **⎘ Show full key** | Display unmasked key |
| **✕ Remove** | Delete with confirmation |

## Multi-Key Fallback

If a key hits a 429 rate limit:
1. Key is cooldown'd for 60 seconds
2. Next available key is tried automatically
3. All keys exhausted → error returned with details

## Config

Keys stored in `~/.pi/web-search.json`:

```json
{
  "keys": [
    { "key": "exa_abc...", "label": "personal" },
    { "key": "exa_def...", "label": "work" }
  ]
}
```
