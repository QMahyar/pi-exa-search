# pi-exa-search

Web search for [pi](https://pi.dev) powered by [Exa](https://exa.ai) — neural search API with multi-key rotation and rate limit fallback.

![Exa Key Manager](screenshots/key-list.png)

## Install

```bash
pi install git:github.com/QMahyar/pi-exa-search
```

## Quick Start

1. Get an API key at [exa.ai](https://exa.ai) → Settings → API Keys
2. Run `/exa` in pi → select **"+ Add new key"** → paste key
3. Search works automatically — the agent calls `web_search` when it needs info

```bash
# Try it
/web_search pi coding agent features
```

## Features

- **`web_search` tool** — search the web from any pi conversation
- **Multi-key rotation** — add multiple Exa keys, auto-fallback on 429 rate limits
- **60s cooldown** — rate-limited keys recover automatically
- **`/exa` command** — interactive TUI to manage keys

![Key Actions](screenshots/key-actions.png)

## Docs

- [docs/setup.md](docs/setup.md) — installation & API key setup
- [docs/usage.md](docs/usage.md) — tool parameters & search tips
- [docs/dev.md](docs/dev.md) — architecture & how to contribute

## License

MIT
