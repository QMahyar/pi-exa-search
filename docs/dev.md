# Developer Guide

## Architecture

Single-file extension (`extensions/web-search.ts`) with two components:

```
web_search tool  ──→  Exa REST API (POST /search)
                          │
                     multi-key fallback
                     (60s cooldown on 429)

/exa command     ──→  pi ui.select() / ui.input() / ui.confirm()
                          │
                     key CRUD → ~/.pi/web-search.json
```

## Key Files

```
extensions/web-search.ts   # Extension: tool + command + TUI
~/.pi/web-search.json      # User's keys (created on first add)
```

## How It Works

### web_search tool

1. Load keys from config, filter out cooldown'd keys
2. Try each key → POST `https://api.exa.ai/search`
3. On 429: mark key cooldown, try next
4. On 2xx: format results as markdown
5. All fail: return error with last message

### /exa command

Chain of `ui.select()` → `ui.input()` → `ui.confirm()` calls:

- Main list: all keys + "Add" + "Done"
- Action submenu: move/edit/show/remove
- Add flow: paste key → optional label
- Remove: confirm dialog

## Dependencies

- `@earendil-works/pi-coding-agent` — ExtensionAPI, ExtensionContext types
- `@earendil-works/pi-tui` — (imported but not used in current version)
- `typebox` — parameter schema for tool registration

## Contributing

1. Fork & clone
2. Edit `extensions/web-search.ts`
3. Copy to `~/.pi/agent/extensions/` for local testing
4. Test with `/reload` in pi
5. PR to `github.com/QMahyar/pi-exa-search`
