import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

// ── Config ──────────────────────────────────────────────────────

interface KeyEntry {
  key: string;
  label?: string;
  cooldownUntil?: number;
}

interface Config {
  keys: KeyEntry[];
  exaApiKey?: string;
}

const CONFIG_PATH = join(homedir(), ".pi", "web-search.json");
const COOLDOWN_MS = 60_000;

function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) return { keys: [] };
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    if (raw.exaApiKey && (!raw.keys || raw.keys.length === 0)) {
      return { keys: [{ key: raw.exaApiKey, label: "default" }] };
    }
    return raw;
  } catch {
    return { keys: [] };
  }
}

function saveConfig(config: Config) {
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function maskedKey(key: string): string {
  if (key.length <= 12) return key.slice(0, 4) + "..." + key.slice(-2);
  return key.slice(0, 10) + "..." + key.slice(-4);
}

// ── Key Manager TUI Flow ──────────────────────────────────────

async function runExaKeysUI(ui: ExtensionContext["ui"]): Promise<string | null> {
  let keys: KeyEntry[] = loadConfig().keys;
  const save = () => saveConfig({ keys });

  while (true) {
    const now = Date.now();
    const items: string[] = keys.map((k, i) => {
      const cd = k.cooldownUntil && now < k.cooldownUntil
        ? ` [cooldown ${Math.ceil((k.cooldownUntil - now) / 1000)}s]` : "";
      return `${i + 1}. ${k.label || "unnamed"} — ${maskedKey(k.key)}${cd}`;
    });
    items.push("+ Add new key");
    items.push("Done");

    const choice = await ui.select(`Exa API Keys (${keys.length})`, items);

    if (!choice || choice === "Done") break;

    // ── Add ──
    if (choice === "+ Add new key") {
      const key = await ui.input("Paste your Exa API key", "exa_");
      if (!key?.trim()) continue;

      if (keys.some((k) => k.key === key.trim())) {
        ui.notify("Key already exists", "warning");
        continue;
      }

      const label = await ui.input("Label (optional)", "e.g. personal, work");
      keys.push({ key: key.trim(), label: label?.trim() || undefined });
      save();
      ui.notify(`Key added (${keys.length} total)`, "info");
      continue;
    }

    // ── Key actions ──
    // Parse "1. personal — exa_ab...cd" → index 0
    const match = choice.match(/^(\d+)\./);
    if (!match) continue;
    const idx = parseInt(match[1], 10) - 1;
    const k = keys[idx];
    if (!k) continue;

    const action = await ui.select(`Key: ${k.label || maskedKey(k.key)}`, [
      idx === 0 ? "   (top) Move up" : "↑ Move up",
      idx === keys.length - 1 ? "   (bottom) Move down" : "↓ Move down",
      `✎ Edit label [${k.label || "none"}]`,
      "⎘ Show full key",
      "✕ Remove",
    ]);

    if (!action) continue;

    switch (action) {
      case "↑ Move up":
        if (idx > 0) { [keys[idx], keys[idx - 1]] = [keys[idx - 1], keys[idx]]; save(); }
        break;
      case "   (top) Move up":
        break; // already at top
      case "↓ Move down":
        if (idx < keys.length - 1) { [keys[idx], keys[idx + 1]] = [keys[idx + 1], keys[idx]]; save(); }
        break;
      case "   (bottom) Move down":
        break; // already at bottom
      default: {
        if (action.startsWith("✎ Edit label")) {
          const newLabel = await ui.input("Enter label", k.label || "");
          if (newLabel !== undefined) { k.label = newLabel.trim() || undefined; save(); }
        }
        break;
      }
      case "⎘ Show full key":
        return k.key;
      case "✕ Remove": {
        const yes = await ui.confirm("Remove key?", `Remove "${k.label || "unnamed"}" (${maskedKey(k.key)})?`);
        if (yes) { keys.splice(idx, 1); save(); ui.notify("Key removed", "info"); }
        break;
      }
    }
  }

  return null;
}

// ── Extension ───────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── /exa command — TUI key manager ──

  pi.registerCommand("exa", {
    description: "Manage Exa API keys — add, remove, reorder via interactive TUI",
    handler: async (_args, ctx) => {
      const result = await runExaKeysUI(ctx.ui);
      if (result) {
        ctx.ui.notify(`Key:\n${result}`, "info");
      }
    },
  });

  // ── web_search tool ──

  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: "Search the web via Exa API with automatic multi-key fallback on rate limits.",
    promptSnippet: "Search the web for information",
    promptGuidelines: ["Use web_search when you need current information from the web, documentation, or recent news."],
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      numResults: Type.Optional(Type.Integer({ description: "Number of results (default 5, max 10)", minimum: 1, maximum: 10 })),
      recencyFilter: Type.Optional(Type.String({ description: "Recency filter: day, week, month, year", enum: ["day", "week", "month", "year"] })),
    }),
    async execute(toolCallId, params, signal, onUpdate, _ctx) {
      const config = loadConfig();
      const now = Date.now();
      const availableKeys = config.keys.filter((k) => {
        if (!k.cooldownUntil) return true;
        if (now >= k.cooldownUntil) { k.cooldownUntil = undefined; return true; }
        return false;
      });

      if (availableKeys.length === 0) {
        return {
          content: [{
            type: "text",
            text: [
              "No Exa API keys available.",
              "Run /exa to add a key, or get one at https://exa.ai",
              `Total configured: ${config.keys.length}${config.keys.length > 0 ? " (all on cooldown)" : ""}`,
            ].join("\n"),
          }],
          details: {},
        };
      }

      const body: Record<string, any> = {
        query: params.query,
        numResults: Math.min(params.numResults ?? 5, 10),
        type: "auto",
        contents: { text: { maxCharacters: 2000 } },
      };
      if (params.recencyFilter) body.startPublishedDate = getRecencyDate(params.recencyFilter);

      let lastError = "";
      for (const keyEntry of availableKeys) {
        if (signal?.aborted) break;
        try {
          const res = await fetch("https://api.exa.ai/search", {
            method: "POST",
            headers: { "x-api-key": keyEntry.key, "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal,
          });

          if (res.status === 429) {
            const orig = config.keys.find((k) => k.key === keyEntry.key);
            if (orig) { orig.cooldownUntil = Date.now() + COOLDOWN_MS; saveConfig(config); }
            lastError = `Key "${keyEntry.label || maskedKey(keyEntry.key)}" rate limited`;
            continue;
          }
          if (!res.status.toString().startsWith("2")) {
            lastError = `Key failed (${res.status}): ${(await res.text()).slice(0, 100)}`;
            continue;
          }

          const data = (await res.json()) as { results: Array<{ title: string; url: string; text?: string; publishedDate?: string }> };
          if (!data.results?.length) return { content: [{ type: "text", text: `No results for: ${params.query}` }], details: {} };

          const output = data.results.map((r, i) => {
            let b = `### ${i + 1}. ${r.title}\n${r.url}`;
            if (r.publishedDate) b += `\nPublished: ${r.publishedDate.split("T")[0]}`;
            if (r.text) b += `\n\n${r.text}`;
            return b;
          }).join("\n\n---\n\n");

          return {
            content: [{ type: "text", text: output }],
            details: { query: params.query, resultCount: data.results.length, usedKey: keyEntry.label || maskedKey(keyEntry.key) },
          };
        } catch (err: any) {
          if (signal?.aborted) return { content: [{ type: "text", text: "Search aborted." }], details: {} };
          lastError = err.message || String(err);
          continue;
        }
      }

      return {
        content: [{ type: "text", text: `All ${availableKeys.length} key(s) failed.\nLast error: ${lastError}` }],
        details: {},
        isError: true,
      };
    },
  });
}

function getRecencyDate(filter: string): string {
  const now = new Date();
  switch (filter) {
    case "day": now.setDate(now.getDate() - 1); break;
    case "week": now.setDate(now.getDate() - 7); break;
    case "month": now.setMonth(now.getMonth() - 1); break;
    case "year": now.setFullYear(now.getFullYear() - 1); break;
  }
  return now.toISOString();
}
