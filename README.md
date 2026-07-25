<p align="center">
  <a href="https://exa.ai"><strong>Exa</strong></a>
  &nbsp;×&nbsp;
  <a href="https://pi.dev"><strong>pi</strong></a>
</p>

<h1 align="center">@qmahyar/pi-exa-search</h1>

<p align="center">
  <strong>Neural web search for pi.</strong><br />
  Token-efficient highlights, page fetch, multi-key rotation, and a simple <code>/exa</code> key manager.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@qmahyar/pi-exa-search"><img alt="npm" src="https://img.shields.io/npm/v/@qmahyar/pi-exa-search?style=flat-square" /></a>
  <a href="https://pi.dev/packages"><img alt="pi-package" src="https://img.shields.io/badge/pi.dev-package-111?style=flat-square" /></a>
  <a href="https://github.com/QMahyar/pi-exa-search/blob/master/LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" /></a>
</p>

<p align="center">
  <img src="screenshots/key-list.png" alt="Exa key manager" width="520" />
</p>

---

## Install

```bash
pi install npm:@qmahyar/pi-exa-search
```

Or from git:

```bash
pi install git:github.com/QMahyar/pi-exa-search
```

## What you get

| Piece | Role |
|-------|------|
| **`web_search`** | Exa neural search with **highlights** (cheap on context) |
| **`web_fetch`** | Full page content for known URLs (batch OK) |
| **`/exa`** | TUI: add, reorder, test, remove API keys |
| **Multi-key** | Auto-fallback on rate limits + cooldown |

<p align="center">
  <img src="screenshots/key-actions.png" alt="Key actions" width="420" />
</p>

## 60-second start

1. Get a key at [dashboard.exa.ai/api-keys](https://dashboard.exa.ai/api-keys)  
2. In pi: **`/exa`** → add key (or set `EXA_API_KEY`)  
3. Ask for current docs / news — the agent calls `web_search` / `web_fetch`

## Pair with 9Router (optional)

For multi-provider **chat** models plus image, speech, and gateway web tools:

```bash
pi install npm:@qmahyar/pi-9router
```

→ [**@qmahyar/pi-9router**](https://github.com/QMahyar/pi-9router) · [npm](https://www.npmjs.com/package/@qmahyar/pi-9router)

If you use both packages, disable overlapping web tools in one of them so the agent has a single clear search path.

## Docs

| Doc | |
|-----|--|
| [Setup](docs/setup.md) | Install & API keys |
| [Usage](docs/usage.md) | Parameters & tips |
| [Dev](docs/dev.md) | Architecture |

## Links

- [Exa](https://exa.ai) · [API docs](https://docs.exa.ai)
- [pi.dev](https://pi.dev) · [Package gallery](https://pi.dev/packages)
- [This package on npm](https://www.npmjs.com/package/@qmahyar/pi-exa-search)

## License

MIT
