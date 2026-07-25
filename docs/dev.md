# Developer Guide

## Architecture

Single-file extension (`extensions/web-search.ts`):

```
web_search  ──→  POST https://api.exa.ai/search
                    contents.highlights (default)
                    optional contents.text
                    multi-key fallback + cooldown

web_fetch   ──→  POST https://api.exa.ai/contents
                    text + highlights
                    multi-key fallback + cooldown

/exa        ──→  ui.select / input / confirm
                    key CRUD + test → ~/.pi/web-search.json
                    EXA_API_KEY shown as env fallback
```

## Key files

```
extensions/web-search.ts   # tools + command + TUI + HTTP
~/.pi/web-search.json      # user keys (created on first add)
package.json               # pi package manifest
```

## Design choices

| Choice | Why |
|--------|-----|
| Highlights by default | ~10× more token-efficient than full text; Exa’s recommended agent pattern |
| Separate `web_fetch` | Search finds URLs; fetch deep-reads only what matters |
| Domain filters as strings | Models pass `"a.com, b.com"` reliably; we split client-side |
| `Authorization: Bearer` + `x-api-key` | Current docs prefer Bearer; both kept for compatibility |
| Compact `renderResult` | Collapsed tool rows stay short in the TUI |
| No deep/deep-reasoning types yet | Higher latency/cost; add later if needed |

## Local test loop

```bash
# from repo root
cp extensions/web-search.ts ~/.pi/agent/extensions/web-search.ts
# in pi:
/reload
/exa          # test keys
# ask: "search for latest exa api search parameters"
```

Or:

```bash
pi -e ./extensions/web-search.ts
```

## Publishing

1. Bump `version` in `package.json`
2. Update docs if parameters change
3. Commit & push to `github.com/QMahyar/pi-exa-search`
4. Users get it via `pi update` / reinstall of the git package

## Dependencies

Peer:

- `@earendil-works/pi-coding-agent` — ExtensionAPI, Theme
- `typebox` — tool parameter schemas

Runtime imports also use `@earendil-works/pi-tui` (`Text`, `truncateToWidth`) which ships with pi.
