# Setup

## Install

```bash
pi install git:github.com/QMahyar/pi-exa-search
```

Or add to `~/.pi/agent/settings.json`:

```json
{
  "packages": ["git:github.com/QMahyar/pi-exa-search"]
}
```

Run `/reload` or restart pi.

### Local / linked install (development)

```bash
# clone, then either:
pi install git:github.com/QMahyar/pi-exa-search
# or copy the extension for a quick test:
cp extensions/web-search.ts ~/.pi/agent/extensions/
```

If you already have a copy in `~/.pi/agent/extensions/web-search.ts`, prefer **one** source (package *or* local file) to avoid double-registering tools.

## Get an Exa API Key

1. Sign up at [exa.ai](https://exa.ai)
2. Open [API Keys](https://dashboard.exa.ai/api-keys)
3. Create a key (format may be `exa_…` or a bare UUID depending on account)

## Add the key to pi

**Option A — TUI (recommended)**  
Run `/exa` → **"+ Add new key"** → paste → optional label → optional test.

**Option B — environment**

```bash
export EXA_API_KEY=your_key_here
```

Env is used as fallback when config keys are missing or on cooldown.

**Option C — config file**  
Edit `~/.pi/web-search.json` (see [usage.md](usage.md)).

## Verify

1. `/exa` → **⟳ Test top key** (or test a specific key)
2. Ask pi something that needs current info — it should call `web_search`
