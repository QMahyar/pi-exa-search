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

## Get an Exa API Key

1. Sign up at [exa.ai](https://exa.ai)
2. Go to Settings → API Keys
3. Copy your key (starts with `exa_`)

Free tier: 1,000 searches/month.

## Add Key to Pi

Run `/exa` in pi → select **"+ Add new key"** → paste key → optional label.

Multiple keys rotate automatically on rate limits.

## Verify

Ask pi anything that needs current info — it'll call `web_search` automatically.
