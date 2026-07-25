# pi-exa-search

Web search + page fetch for [pi](https://pi.dev) powered by [Exa](https://exa.ai) — neural search, multi-key rotation, and rate-limit fallback.

![Exa Key Manager](screenshots/key-list.png)

## Install

```bash
pi install git:github.com/QMahyar/pi-exa-search
```

## Quick Start

1. Get an API key at [dashboard.exa.ai/api-keys](https://dashboard.exa.ai/api-keys)
2. Run `/exa` in pi → **"+ Add new key"** → paste key  
   (or set `EXA_API_KEY` in your environment)
3. The agent calls `web_search` / `web_fetch` when it needs the web

## Features

| Piece | What it does |
|-------|----------------|
| **`web_search`** | Neural search with **highlights** (token-efficient). Filters: category, domains, recency. |
| **`web_fetch`** | Full page content for known URLs (batch supported). |
| **Multi-key rotation** | Several Exa keys; auto-fallback on 429 with cooldown. |
| **`EXA_API_KEY`** | Env fallback when config is empty or keys are cooling down. |
| **`/exa`** | TUI to add / reorder / test / remove keys. |

![Key Actions](screenshots/key-actions.png)

## Docs

- [docs/setup.md](docs/setup.md) — installation & API keys
- [docs/usage.md](docs/usage.md) — tool parameters & tips
- [docs/dev.md](docs/dev.md) — architecture

## License

MIT
