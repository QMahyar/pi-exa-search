# Dev — @qmahyar/pi-exa-search

```text
extensions/web-search.ts   # /exa + web_search + web_fetch
```

Config: `~/.pi/web-search.json` (path via `CONFIG_DIR_NAME`; file chmod 0600)  
Auth: config keys → `EXA_API_KEY`  
Cooldowns: in-memory only (reset on restart, never written to the key list)  
Truncation: tool output capped at pi's built-in limit; overflow → temp file

Publish: `npm publish --access public` (name `@qmahyar/pi-exa-search`).
