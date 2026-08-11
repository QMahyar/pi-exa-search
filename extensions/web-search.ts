/**
 * pi-exa-search — Web search + page fetch for pi via Exa API
 *
 * Tools:
 *   web_search  — neural search with highlights (token-efficient)
 *   web_fetch   — full page content for known URLs
 *
 * Command:
 *   /exa        — interactive multi-key manager TUI
 *
 * Config: ~/.pi/web-search.json (path uses CONFIG_DIR_NAME; file is chmod 0600)
 * Env:    EXA_API_KEY (used if no keys in config)
 * Cooldowns are in-memory only (never persisted into the key list).
 * Tool output is capped at pi's built-in limit; overflow goes to a temp file.
 */

import {
	CONFIG_DIR_NAME,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	keyHint,
	truncateHead,
	type ExtensionAPI,
	type ExtensionContext,
	type Theme,
	type TruncationResult,
} from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { chmodSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir, tmpdir } from "node:os";

// ── Config ──────────────────────────────────────────────────────

interface KeyEntry {
	key: string;
	label?: string;
	/** Legacy persisted cooldown — read for migration only, never written */
	cooldownUntil?: number;
}

interface Config {
	keys: KeyEntry[];
	/** @deprecated migrated to keys[] */
	exaApiKey?: string;
}

const CONFIG_PATH = join(homedir(), CONFIG_DIR_NAME, "web-search.json");
const COOLDOWN_MS = 60_000;
/** Keep tool output under pi's built-in 50KB / 2000-line cap (see extensions.md "Output Truncation") */
const MAX_OUTPUT_BYTES = Math.floor(DEFAULT_MAX_BYTES * 0.9);
const DEFAULT_SEARCH_MAX_CHARS = 2000;
const DEFAULT_FETCH_MAX_CHARS = 5000;
const MAX_RESULTS = 20;

const CATEGORIES = [
	"company",
	"people",
	"publication",
	"news",
	"personal site",
	"financial report",
] as const;

const SEARCH_TYPES = ["auto", "fast", "instant"] as const;
const RECENCY = ["day", "week", "month", "year"] as const;

type Category = (typeof CATEGORIES)[number];
type SearchType = (typeof SEARCH_TYPES)[number];
type Recency = (typeof RECENCY)[number];

/** Runtime cooldowns only — deliberately never written to the key list file */
const cooldowns = new Map<string, number>();
let cachedConfig: Config | undefined;

function loadConfig(): Config {
	if (cachedConfig) return cachedConfig;
	let cfg: Config = { keys: [] };
	if (existsSync(CONFIG_PATH)) {
		try {
			const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
			// Migrate legacy single-key field
			if (raw.exaApiKey && (!raw.keys || raw.keys.length === 0)) {
				cfg = { keys: [{ key: raw.exaApiKey, label: "default" }] };
			} else {
				cfg = { keys: Array.isArray(raw.keys) ? raw.keys : [] };
			}
		} catch {
			cfg = { keys: [] };
		}
	}
	// Migrate legacy persisted cooldowns into the runtime map, then forget them
	const now = Date.now();
	for (const k of cfg.keys) {
		if (typeof k.cooldownUntil === "number" && k.cooldownUntil > now) {
			cooldowns.set(k.key, k.cooldownUntil);
		}
		delete k.cooldownUntil;
	}
	cachedConfig = cfg;
	return cfg;
}

function saveConfig(config: Config) {
	const dir = dirname(CONFIG_PATH);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
	// Strip runtime-only + deprecated fields and lock permissions on the key file
	const out: Config = { keys: config.keys.map(({ key, label }) => ({ key, label })) };
	writeFileSync(CONFIG_PATH, JSON.stringify(out, null, 2) + "\n", { mode: 0o600 });
	try {
		chmodSync(CONFIG_PATH, 0o600);
	} catch {
		// best-effort on platforms without POSIX permissions
	}
	cachedConfig = config;
}

function maskedKey(key: string): string {
	if (key.length <= 12) return key.slice(0, 4) + "..." + key.slice(-2);
	return key.slice(0, 10) + "..." + key.slice(-4);
}

function envKey(): string | undefined {
	const k = process.env.EXA_API_KEY?.trim();
	return k || undefined;
}

function isCoolingDown(key: string, now = Date.now()): boolean {
	const until = cooldowns.get(key);
	if (!until) return false;
	if (now >= until) {
		cooldowns.delete(key);
		return false;
	}
	return true;
}

/** Ordered keys: config (skip cooldown) then EXA_API_KEY env fallback */
function availableKeys(config: Config): KeyEntry[] {
	const now = Date.now();
	const fromConfig = config.keys.filter((k) => k.key?.trim() && !isCoolingDown(k.key, now));

	const env = envKey();
	if (env && !fromConfig.some((k) => k.key === env) && !isCoolingDown(env, now)) {
		fromConfig.push({ key: env, label: "env:EXA_API_KEY" });
	}
	return fromConfig;
}

function markCooldown(_config: Config, key: string, ms: number) {
	cooldowns.set(key, Date.now() + ms);
}

// ── Exa HTTP ────────────────────────────────────────────────────

interface ExaResult {
	title?: string;
	url: string;
	id?: string;
	publishedDate?: string;
	author?: string;
	text?: string;
	highlights?: string[];
	summary?: string;
	score?: number;
}

interface ExaSearchResponse {
	results?: ExaResult[];
	requestId?: string;
	costDollars?: { total?: number };
}

interface ExaContentsResponse {
	results?: ExaResult[];
	statuses?: Array<{ id: string; status: string; error?: string }>;
	requestId?: string;
	costDollars?: { total?: number };
}

type ExaOk<T> = { ok: true; data: T; usedKey: KeyEntry; status: number };
type ExaFail = { ok: false; lastError: string; tried: number };

async function exaRequest<T>(
	path: string,
	body: Record<string, unknown>,
	signal?: AbortSignal,
	onStatus?: (msg: string) => void,
): Promise<ExaOk<T> | ExaFail> {
	const config = loadConfig();
	// Clear expired cooldowns and persist once if needed
	const keys = availableKeys(config);
	if (keys.length === 0) {
		const total = config.keys.length + (envKey() ? 1 : 0);
		return {
			ok: false,
			tried: 0,
			lastError: [
				"No Exa API keys available.",
				"Run /exa to add a key, set EXA_API_KEY, or get one at https://dashboard.exa.ai/api-keys",
				`Configured keys: ${config.keys.length}${config.keys.length > 0 ? " (all on cooldown)" : ""}${envKey() ? " + env" : ""}`,
				total === 0 ? "" : "",
			]
				.filter(Boolean)
				.join("\n"),
		};
	}

	let lastError = "";
	for (let i = 0; i < keys.length; i++) {
		const keyEntry = keys[i];
		if (signal?.aborted) {
			return { ok: false, tried: i, lastError: "aborted" };
		}

		onStatus?.(
			keys.length > 1
				? `Exa ${path} via ${keyEntry.label || maskedKey(keyEntry.key)} (${i + 1}/${keys.length})…`
				: `Exa ${path}…`,
		);

		try {
			const res = await fetch(`https://api.exa.ai${path}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					// Both headers accepted by Exa; Bearer is preferred in current docs
					Authorization: `Bearer ${keyEntry.key}`,
					"x-api-key": keyEntry.key,
				},
				body: JSON.stringify(body),
				signal,
			});

			if (res.status === 429) {
				const retryAfter = Number(res.headers.get("retry-after"));
				const coolMs = Number.isFinite(retryAfter) && retryAfter > 0
					? Math.min(retryAfter * 1000, 5 * 60_000)
					: COOLDOWN_MS;
				markCooldown(config, keyEntry.key, coolMs);
				lastError = `Key "${keyEntry.label || maskedKey(keyEntry.key)}" rate limited (cooldown ${Math.round(coolMs / 1000)}s)`;
				continue;
			}

			if (res.status === 401 || res.status === 403) {
				lastError = `Key "${keyEntry.label || maskedKey(keyEntry.key)}" unauthorized (${res.status})`;
				// Don't burn remaining keys on a likely global issue, but try next in case of bad key
				continue;
			}

			if (res.status === 402) {
				lastError = `Key "${keyEntry.label || maskedKey(keyEntry.key)}" payment required (402) — check Exa plan/credits`;
				continue;
			}

			if (!res.ok) {
				const errText = (await res.text()).slice(0, 300);
				lastError = `Key "${keyEntry.label || maskedKey(keyEntry.key)}" failed (${res.status}): ${errText}`;
				// 4xx on body (bad params) — don't rotate forever
				if (res.status >= 400 && res.status < 500 && res.status !== 429) {
					return { ok: false, tried: i + 1, lastError };
				}
				continue;
			}

			const data = (await res.json()) as T;
			return { ok: true, data, usedKey: keyEntry, status: res.status };
		} catch (err: any) {
			if (signal?.aborted || err?.name === "AbortError") {
				return { ok: false, tried: i + 1, lastError: "aborted" };
			}
			lastError = err?.message || String(err);
			continue;
		}
	}

	return { ok: false, tried: keys.length, lastError };
}

// ── Formatting ──────────────────────────────────────────────────

function getRecencyDate(filter: Recency): string {
	const now = new Date();
	switch (filter) {
		case "day":
			now.setDate(now.getDate() - 1);
			break;
		case "week":
			now.setDate(now.getDate() - 7);
			break;
		case "month":
			now.setMonth(now.getMonth() - 1);
			break;
		case "year":
			now.setFullYear(now.getFullYear() - 1);
			break;
	}
	return now.toISOString();
}

function parseDomainList(value?: string): string[] | undefined {
	if (!value?.trim()) return undefined;
	const list = value
		.split(/[,\s]+/)
		.map((s) => s.trim().replace(/^https?:\/\//, "").replace(/\/$/, ""))
		.filter(Boolean);
	return list.length ? list : undefined;
}

function formatResult(r: ExaResult, index: number, opts: { includeText: boolean }): string {
	const title = r.title?.trim() || r.url;
	const lines: string[] = [`### ${index + 1}. ${title}`, r.url];

	const meta: string[] = [];
	if (r.publishedDate) meta.push(`Published: ${r.publishedDate.split("T")[0]}`);
	if (r.author) meta.push(`Author: ${r.author}`);
	if (typeof r.score === "number") meta.push(`Score: ${r.score.toFixed(3)}`);
	if (meta.length) lines.push(meta.join(" · "));

	if (r.summary?.trim()) {
		lines.push("", `**Summary:** ${r.summary.trim()}`);
	}

	if (r.highlights?.length) {
		lines.push("", "**Highlights:**");
		for (const h of r.highlights) {
			const t = h.trim();
			if (t) lines.push(`- ${t}`);
		}
	}

	if (opts.includeText && r.text?.trim()) {
		// Avoid duplicating if highlights already cover it and text is huge
		if (!r.highlights?.length || r.text.length > 200) {
			lines.push("", r.text.trim());
		}
	}

	return lines.join("\n");
}

function formatSearchOutput(
	query: string,
	results: ExaResult[],
	meta: { usedKey: string; includeText: boolean },
): string {
	if (!results.length) {
		return `No results for: ${query}`;
	}
	const header = `Search: ${query}\nResults: ${results.length} · key: ${meta.usedKey}`;
	const body = results.map((r, i) => formatResult(r, i, { includeText: meta.includeText })).join("\n\n---\n\n");
	return `${header}\n\n${body}`;
}

function toolError(message: string, details: Record<string, unknown> = {}) {
	return {
		content: [{ type: "text" as const, text: message }],
		details,
		isError: true as const,
	};
}

function toolOk(text: string, details: Record<string, unknown>) {
	return {
		content: [{ type: "text" as const, text }],
		details,
	};
}

// ── Output trimming ─────────────────────────────────────────────

async function saveFullOutput(text: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pi-exa-"));
	const file = join(dir, "output.txt");
	await writeFile(file, text, "utf8");
	return file;
}

/**
 * Clamp tool output to pi's built-in cap (50KB / 2000 lines, whichever is hit first).
 * When cut, the full payload is saved to a temp file and the LLM is told where.
 */
async function trimOutput(
	body: string,
): Promise<{ text: string; truncated?: TruncationResult; fullOutputPath?: string }> {
	const tr = truncateHead(body, { maxLines: DEFAULT_MAX_LINES, maxBytes: MAX_OUTPUT_BYTES });
	if (!tr.truncated) return { text: body };

	// truncateHead never returns partial lines: a single line over the cap yields
	// empty content, so fall back to a hard byte cut with an ellipsis.
	let shown = tr.content;
	if (!shown) {
		shown = Buffer.from(body, "utf8").subarray(0, MAX_OUTPUT_BYTES).toString("utf8") + "\n…";
	}

	const fullOutputPath = await saveFullOutput(body);
	const shownBytes = Buffer.byteLength(shown, "utf8");
	const notice =
		`\n\n[Output truncated: ${formatSize(shownBytes)} of ${formatSize(tr.totalBytes)} shown` +
		` (${tr.totalLines} lines total). Full output saved to: ${fullOutputPath}]`;

	return { text: shown + notice, truncated: tr, fullOutputPath };
}

// ── Compact TUI renderer ────────────────────────────────────────

function renderSearchResult(
	details: Record<string, unknown> | undefined,
	theme: Theme,
	expanded: boolean,
	textFallback: string,
	isPartial = false,
): Text {
	if (isPartial) {
		return new Text(theme.fg("warning", "searching…"), 0, 0);
	}
	const query = typeof details?.query === "string" ? details.query : "";
	const count = typeof details?.resultCount === "number" ? details.resultCount : 0;
	const usedKey = typeof details?.usedKey === "string" ? details.usedKey : "";
	const urls = Array.isArray(details?.urls) ? (details!.urls as string[]) : [];

	if (!expanded) {
		const q = query ? truncateToWidth(query, 48) : "search";
		const line = theme.fg("toolTitle", `web_search`) +
			theme.fg("dim", ` · ${count} hit${count === 1 ? "" : "s"}`) +
			(query ? theme.fg("muted", ` · ${q}`) : "") +
			(usedKey ? theme.fg("dim", ` · ${usedKey}`) : "") +
			theme.fg("dim", ` (${keyHint("app.tools.expand", "expand results")})`);
		return new Text(line, 0, 0);
	}

	const lines: string[] = [];
	if (query) lines.push(theme.fg("accent", "Query: ") + theme.fg("text", query));
	if (usedKey) lines.push(theme.fg("dim", `Key: ${usedKey}`));
	if (urls.length) {
		for (const u of urls.slice(0, 8)) lines.push(theme.fg("muted", `• ${u}`));
		if (urls.length > 8) lines.push(theme.fg("dim", `… +${urls.length - 8} more`));
	} else if (textFallback) {
		lines.push(theme.fg("toolOutput", truncateToWidth(textFallback.replace(/\s+/g, " "), 200)));
	}
	if (typeof details?.fullOutputPath === "string") {
		lines.push(theme.fg("dim", `Full output: ${details.fullOutputPath}`));
	}
	return new Text(lines.join("\n") || textFallback, 0, 0);
}

// ── Key Manager TUI ─────────────────────────────────────────────

async function testKey(ui: ExtensionContext["ui"], key: string): Promise<void> {
	ui.notify("Testing key…", "info");
	try {
		const res = await fetch("https://api.exa.ai/search", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${key}`,
				"x-api-key": key,
			},
			body: JSON.stringify({
				query: "exa ai",
				numResults: 1,
				type: "instant",
				contents: { highlights: true },
			}),
			signal: AbortSignal.timeout(10_000),
		});
		if (res.ok) {
			ui.notify("Key works ✓", "info");
		} else if (res.status === 429) {
			ui.notify("Key valid but rate limited (429)", "warning");
		} else if (res.status === 401 || res.status === 403) {
			ui.notify(`Key rejected (${res.status})`, "error");
		} else if (res.status === 402) {
			ui.notify("Key valid but payment required (402)", "warning");
		} else {
			ui.notify(`Unexpected status ${res.status}`, "warning");
		}
	} catch (err: any) {
		ui.notify(`Network error: ${err?.message || err}`, "error");
	}
}

async function runExaKeysUI(ui: ExtensionContext["ui"]): Promise<string | null> {
	let keys: KeyEntry[] = loadConfig().keys;
	const save = () => saveConfig({ keys });

	while (true) {
		const now = Date.now();
		const env = envKey();
		const items: string[] = keys.map((k, i) => {
			const until = cooldowns.get(k.key);
			const cd =
				typeof until === "number" && until > now
					? ` [cooldown ${Math.ceil((until - now) / 1000)}s]`
					: "";
			return `${i + 1}. ${k.label || "unnamed"} — ${maskedKey(k.key)}${cd}`;
		});
		if (env) {
			const inList = keys.some((k) => k.key === env);
			items.push(inList ? `env EXA_API_KEY — already in list` : `env EXA_API_KEY — ${maskedKey(env)} (fallback)`);
		}
		items.push("+ Add new key");
		if (keys.length) items.push("⟳ Test top key");
		items.push("Done");

		const choice = await ui.select(`Exa API Keys (${keys.length}${env ? " + env" : ""})`, items);
		if (!choice || choice === "Done") break;

		if (choice === "+ Add new key") {
			const key = await ui.input("Paste your Exa API key", "exa_… or UUID");
			if (!key?.trim()) continue;

			const trimmed = key.trim();
			if (keys.some((k) => k.key === trimmed)) {
				ui.notify("Key already exists", "warning");
				continue;
			}

			const label = await ui.input("Label (optional)", "e.g. personal, work");
			keys.push({ key: trimmed, label: label?.trim() || undefined });
			save();
			ui.notify(`Key added (${keys.length} total)`, "info");

			const shouldTest = await ui.confirm("Test key?", "Send a cheap 1-result search to verify?");
			if (shouldTest) await testKey(ui, trimmed);
			continue;
		}

		if (choice === "⟳ Test top key") {
			if (keys[0]) await testKey(ui, keys[0].key);
			continue;
		}

		if (choice.startsWith("env EXA_API_KEY")) {
			ui.notify(
				env
					? `EXA_API_KEY is set (${maskedKey(env)}). Used as fallback when config keys fail or are empty.`
					: "EXA_API_KEY not set",
				"info",
			);
			continue;
		}

		const match = choice.match(/^(\d+)\./);
		if (!match) continue;
		const idx = parseInt(match[1], 10) - 1;
		const k = keys[idx];
		if (!k) continue;

		const action = await ui.select(`Key: ${k.label || maskedKey(k.key)}`, [
			idx === 0 ? "   (top) Move up" : "↑ Move up",
			idx === keys.length - 1 ? "   (bottom) Move down" : "↓ Move down",
			`✎ Edit label [${k.label || "none"}]`,
			"✓ Test key",
			"⎘ Show full key",
			"✕ Remove",
		]);

		if (!action) continue;

		switch (action) {
			case "↑ Move up":
				if (idx > 0) {
					[keys[idx], keys[idx - 1]] = [keys[idx - 1], keys[idx]];
					save();
				}
				break;
			case "   (top) Move up":
				break;
			case "↓ Move down":
				if (idx < keys.length - 1) {
					[keys[idx], keys[idx + 1]] = [keys[idx + 1], keys[idx]];
					save();
				}
				break;
			case "   (bottom) Move down":
				break;
			case "✓ Test key":
				await testKey(ui, k.key);
				break;
			case "⎘ Show full key":
				return k.key;
			case "✕ Remove": {
				const yes = await ui.confirm(
					"Remove key?",
					`Remove "${k.label || "unnamed"}" (${maskedKey(k.key)})?`,
				);
				if (yes) {
					keys.splice(idx, 1);
					cooldowns.delete(k.key);
					save();
					ui.notify("Key removed", "info");
				}
				break;
			}
			default: {
				if (action.startsWith("✎ Edit label")) {
					const newLabel = await ui.input("Enter label", k.label || "");
					if (newLabel !== undefined) {
						k.label = newLabel.trim() || undefined;
						save();
					}
				}
				break;
			}
		}
	}

	return null;
}

// ── Schemas ─────────────────────────────────────────────────────

const WebSearchParams = Type.Object({
	query: Type.String({
		description:
			"Natural-language search query. Prefer a description of the ideal page, not keyword soup. Example: 'official Exa API search endpoint documentation' not 'exa api'.",
	}),
	numResults: Type.Optional(
		Type.Integer({
			description: `Number of results (default 5, max ${MAX_RESULTS})`,
			minimum: 1,
			maximum: MAX_RESULTS,
		}),
	),
	recencyFilter: Type.Optional(
		Type.String({
			description: "Only results published within this window: day, week, month, year",
			enum: [...RECENCY],
		}),
	),
	category: Type.Optional(
		Type.String({
			description:
				"Focus results: company, people, publication, news, personal site, financial report. Note: company/people do not support recency or excludeDomains.",
			enum: [...CATEGORIES],
		}),
	),
	includeDomains: Type.Optional(
		Type.String({
			description:
				"Comma-separated domain allowlist (e.g. 'docs.python.org, github.com'). Prefer this over site: in the query.",
		}),
	),
	excludeDomains: Type.Optional(
		Type.String({
			description: "Comma-separated domain blocklist (e.g. 'pinterest.com, quora.com')",
		}),
	),
	type: Type.Optional(
		Type.String({
			description: "Search latency/quality: auto (default), fast, instant",
			enum: [...SEARCH_TYPES],
		}),
	),
	includeText: Type.Optional(
		Type.Boolean({
			description:
				"If true, also return full page text snippets (costlier/heavier). Default false — highlights only.",
		}),
	),
	maxCharacters: Type.Optional(
		Type.Integer({
			description: `Max characters of page text per result when includeText is true (default ${DEFAULT_SEARCH_MAX_CHARS}, max 10000)`,
			minimum: 200,
			maximum: 10000,
		}),
	),
});

const WebFetchParams = Type.Object({
	urls: Type.String({
		description:
			"One or more URLs to fetch, separated by commas or whitespace. Prefer batching multiple URLs in one call.",
	}),
	maxCharacters: Type.Optional(
		Type.Integer({
			description: `Max characters per page (default ${DEFAULT_FETCH_MAX_CHARS}, max 10000)`,
			minimum: 200,
			maximum: 10000,
		}),
	),
	highlightsQuery: Type.Optional(
		Type.String({
			description: "Optional focus query for highlights extraction on each page",
		}),
	),
});

// ── Extension ───────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.registerCommand("exa", {
		description: "Exa — manage API keys (add, reorder, test)",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui" && !ctx.hasUI) {
				ctx.ui.notify("/exa needs interactive UI", "error");
				return;
			}
			const result = await runExaKeysUI(ctx.ui);
			if (result) {
				ctx.ui.notify(`Key:\n${result}`, "info");
			}
		},
	});

	// ── web_search ──

	pi.registerTool({
		name: "web_search",
		label: "Search",
		description:
			"Search the web with Exa neural search. Returns URLs and focused highlights. Best for current docs, news, facts, people, and companies. Prefer descriptive queries. Follow with web_fetch when you need full page text. " +
			`Output is capped at ~${formatSize(MAX_OUTPUT_BYTES)}; if a search exceeds that, the full output is saved to a temp file whose path is reported.`,
		promptSnippet: "Search the web with Exa (highlights)",
		promptGuidelines: [
			"Call web_search for up-to-date information from the web.",
			"Describe the ideal page in the query; avoid bare keyword lists.",
			"Use category for people, company, news, or publication when it fits.",
			"Use includeDomains for official docs instead of site: in the query.",
			"Default results are highlights (token-efficient). Call web_fetch for full pages.",
			"Use recencyFilter for news and recent changes.",
		],
		parameters: WebSearchParams,

		async execute(_toolCallId, params, signal, onUpdate, _ctx) {
			const query = params.query?.trim();
			if (!query) return toolError("query is required");

			const category = params.category as Category | undefined;
			const recency = params.recencyFilter as Recency | undefined;
			const searchType = (params.type as SearchType | undefined) || "auto";
			const includeText = params.includeText === true;
			const maxCharacters = Math.min(params.maxCharacters ?? DEFAULT_SEARCH_MAX_CHARS, 10000);
			const includeDomains = parseDomainList(params.includeDomains);
			const excludeDomains = parseDomainList(params.excludeDomains);

			// Exa: company/people reject date filters and excludeDomains
			const restrictedCategory = category === "company" || category === "people";

			const contents: Record<string, unknown> = {
				// Highlights are ~10x more token-efficient than full text
				highlights: true,
			};
			if (includeText) {
				contents.text = { maxCharacters };
			}

			const body: Record<string, unknown> = {
				query,
				numResults: Math.min(params.numResults ?? 5, MAX_RESULTS),
				type: searchType,
				contents,
			};

			if (category) body.category = category;
			if (includeDomains) body.includeDomains = includeDomains;
			if (excludeDomains && !restrictedCategory) body.excludeDomains = excludeDomains;
			if (recency && !restrictedCategory) body.startPublishedDate = getRecencyDate(recency);

			onUpdate?.({
				content: [{ type: "text", text: `Searching: ${query}` }],
				details: { phase: "search", query },
			});

			const result = await exaRequest<ExaSearchResponse>("/search", body, signal, (msg) => {
				onUpdate?.({
					content: [{ type: "text", text: msg }],
					details: { phase: "search", query },
				});
			});

			if (!result.ok) {
				if (result.lastError === "aborted") {
					return toolError("Search aborted.", { query });
				}
				return toolError(
					result.tried === 0
						? result.lastError
						: `Search failed after ${result.tried} key(s).\n${result.lastError}`,
					{ query, error: result.lastError },
				);
			}

			const results = result.data.results ?? [];
			const usedKey = result.usedKey.label || maskedKey(result.usedKey.key);
			const fullText = formatSearchOutput(query, results, { usedKey, includeText });
			const trimmed = await trimOutput(fullText);

			return toolOk(trimmed.text, {
				query,
				resultCount: results.length,
				usedKey,
				category: category ?? null,
				type: searchType,
				includeText,
				urls: results.map((r) => r.url),
				titles: results.map((r) => r.title || r.url),
				requestId: result.data.requestId ?? null,
				costUsd: result.data.costDollars?.total ?? null,
				truncated: trimmed.truncated ? true : undefined,
				fullOutputPath: trimmed.fullOutputPath ?? undefined,
			});
		},

		renderResult(result, { expanded, isPartial }, theme) {
			const text =
				result.content
					?.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("\n") || "";
			return renderSearchResult(result.details as Record<string, unknown> | undefined, theme, expanded, text, isPartial);
		},
	});

	// ── web_fetch ──

	pi.registerTool({
		name: "web_fetch",
		label: "Fetch",
		description:
			"Fetch clean page content for known URLs with Exa. Use after web_search when highlights are not enough, or to read a specific URL. Batch multiple URLs in one call. " +
			`Total output is capped at ~${formatSize(MAX_OUTPUT_BYTES)}; if exceeded, the full payload is saved to a temp file whose path is reported.`,
		promptSnippet: "Fetch URL content with Exa",
		promptGuidelines: [
			"Call web_fetch when you already have URLs and need full page content.",
			"Batch related URLs in one call instead of many separate fetches.",
			"Prefer web_search first when you do not know the URL yet.",
		],
		parameters: WebFetchParams,

		async execute(_toolCallId, params, signal, onUpdate, _ctx) {
			const raw = params.urls?.trim() ?? "";
			const urlList = raw
				.split(/[,\s]+/)
				.map((s) => s.trim())
				.filter((s) => /^https?:\/\//i.test(s));

			if (!urlList.length) {
				return toolError(
					"No valid URLs. Pass absolute URLs starting with http:// or https://, separated by commas or spaces.",
					{ urls: raw },
				);
			}

			const maxCharacters = Math.min(params.maxCharacters ?? DEFAULT_FETCH_MAX_CHARS, 10000);
			const body: Record<string, unknown> = {
				urls: urlList,
				text: { maxCharacters },
				highlights: params.highlightsQuery
					? { query: params.highlightsQuery }
					: true,
			};

			onUpdate?.({
				content: [{ type: "text", text: `Fetching ${urlList.length} URL(s)…` }],
				details: { phase: "fetch", urls: urlList },
			});

			const result = await exaRequest<ExaContentsResponse>("/contents", body, signal, (msg) => {
				onUpdate?.({
					content: [{ type: "text", text: msg }],
					details: { phase: "fetch", urls: urlList },
				});
			});

			if (!result.ok) {
				if (result.lastError === "aborted") {
					return toolError("Fetch aborted.", { urls: urlList });
				}
				return toolError(
					result.tried === 0
						? result.lastError
						: `Fetch failed after ${result.tried} key(s).\n${result.lastError}`,
					{ urls: urlList, error: result.lastError },
				);
			}

			const results = result.data.results ?? [];
			const usedKey = result.usedKey.label || maskedKey(result.usedKey.key);

			if (!results.length) {
				const statuses = result.data.statuses
					?.map((s) => `- ${s.id}: ${s.status}${s.error ? ` (${s.error})` : ""}`)
					.join("\n");
				return toolError(
					`No content returned for ${urlList.length} URL(s).${statuses ? `\n${statuses}` : ""}`,
					{ urls: urlList, usedKey },
				);
			}

			const fullText =
				`Fetch: ${results.length} page(s) · key: ${usedKey}\n\n` +
				results.map((r, i) => formatResult(r, i, { includeText: true })).join("\n\n---\n\n");
			const trimmed = await trimOutput(fullText);

			return toolOk(trimmed.text, {
				urlCount: results.length,
				usedKey,
				urls: results.map((r) => r.url),
				titles: results.map((r) => r.title || r.url),
				requestId: result.data.requestId ?? null,
				costUsd: result.data.costDollars?.total ?? null,
				truncated: trimmed.truncated ? true : undefined,
				fullOutputPath: trimmed.fullOutputPath ?? undefined,
			});
		},

		renderResult(result, { expanded, isPartial }, theme) {
			if (isPartial) {
				return new Text(theme.fg("warning", "fetching…"), 0, 0);
			}
			const details = (result.details || {}) as Record<string, unknown>;
			const count = typeof details.urlCount === "number" ? details.urlCount : 0;
			const urls = Array.isArray(details.urls) ? (details.urls as string[]) : [];
			if (!expanded) {
				const line =
					theme.fg("toolTitle", "web_fetch") +
					theme.fg("dim", ` · ${count || urls.length} page${(count || urls.length) === 1 ? "" : "s"}`) +
					theme.fg("dim", ` (${keyHint("app.tools.expand", "expand")})`);
				return new Text(line, 0, 0);
			}
			const lines = urls.slice(0, 10).map((u) => theme.fg("muted", `• ${u}`));
			if (typeof details.fullOutputPath === "string") {
				lines.push(theme.fg("dim", `Full output: ${details.fullOutputPath}`));
			}
			return new Text(lines.join("\n") || "fetched", 0, 0);
		},
	});
}
