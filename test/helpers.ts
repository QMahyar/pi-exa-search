/** Shared harness: loads the extension fresh with an isolated config and a scripted fetch. */
import { vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface CapturedRequest {
	url: string;
	body: any;
	headers: Record<string, string>;
	signal?: AbortSignal;
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...headers },
	});
}

export function abortError(): Error {
	return Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
}

/** Replace global fetch with a router; returns the captured requests. */
export function stubFetch(handler: (req: CapturedRequest, index: number) => Response | Promise<Response>) {
	const calls: CapturedRequest[] = [];
	const fn = vi.fn(async (url: string, init: RequestInit) => {
		const req: CapturedRequest = {
			url,
			body: JSON.parse(String(init.body)),
			headers: init.headers as Record<string, string>,
			signal: init.signal ?? undefined,
		};
		calls.push(req);
		return handler(req, calls.length - 1);
	});
	vi.stubGlobal("fetch", fn);
	return { calls, fn };
}

export interface LoadOptions {
	config?: unknown;
	env?: Record<string, string | undefined>;
	timeoutMs?: number;
}

/**
 * Fresh-load the extension module with:
 * - a temp config file (PI_WEB_SEARCH_CONFIG)
 * - EXA_API_KEY cleared unless set via env
 * - optional PI_EXA_TIMEOUT_MS override
 * Returns the registered tool/command definitions via a fake pi API.
 */
export async function loadExtension(opts: LoadOptions = {}) {
	const dir = await mkdtemp(join(tmpdir(), "pi-exa-test-"));
	const cfgPath = join(dir, "web-search.json");
	if (opts.config !== undefined) {
		writeFileSync(cfgPath, JSON.stringify(opts.config));
	}

	const savedEnv: Record<string, string | undefined> = {};
	const setEnv = (k: string, v: string | undefined) => {
		savedEnv[k] = process.env[k];
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	};
	setEnv("PI_WEB_SEARCH_CONFIG", cfgPath);
	setEnv("EXA_API_KEY", undefined);
	for (const [k, v] of Object.entries(opts.env ?? {})) setEnv(k, v);
	if (opts.timeoutMs !== undefined) setEnv("PI_EXA_TIMEOUT_MS", String(opts.timeoutMs));

	vi.resetModules();
	const mod = await import("../extensions/web-search.ts");

	const tools: any[] = [];
	const commands: any[] = [];
	const fakePi: any = {
		registerTool: (def: any) => tools.push(def),
		registerCommand: (name: string, def: any) => commands.push({ name, ...def }),
	};
	mod.default(fakePi);

	const restore = () => {
		for (const [k, v] of Object.entries(savedEnv)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
	};

	return { tools, commands, configPath: cfgPath, dir, restore };
}

export function searchTool(defs: any[]): any {
	const t = defs.find((d) => d.name === "web_search");
	if (!t) throw new Error("web_search not registered");
	return t;
}

export function fetchTool(defs: any[]): any {
	const t = defs.find((d) => d.name === "web_fetch");
	if (!t) throw new Error("web_fetch not registered");
	return t;
}

/** Minimal fake theme: strips color, keeps text. */
export const fakeTheme = { fg: (_color: string, text: string) => text } as any;

export function exaSearchResponse(results: any[] = []) {
	return jsonResponse(200, { results, requestId: "req-1", costDollars: { total: 0.001 } });
}

export async function execute(tool: any, params: any, signal?: AbortSignal) {
	return tool.execute("call-1", params, signal, undefined, {} as any);
}
