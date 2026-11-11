// Pushes the agent config in agent/ to ElevenLabs, so the dashboard setup is reproducible.
//
//   npm run agent:sync      create/update the 13 client tools + the agent, write NEXT_PUBLIC_AGENT_ID
//   npm run agent:check     read the live agent back and print a checklist (no changes)
//   npm run agent:voices    shortlist Indian English female voices from the voice library (read-only)
//   npm run agent:llms      list available fast LLMs (read-only)
//   npm run agent:add-voice -- <voice_id>   add a library voice to My Voices and switch the agent to it
//
// Reads ELEVENLABS_API_KEY from .env.local. Never prints the key.
// Plain TypeScript (types only), run directly by Node 22's type stripping.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.elevenlabs.io";
const ENV_FILE = join(root, ".env.local");

// ------------------------------------------------------------------ env

function readEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(ENV_FILE)) return out;
  for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function writeEnvVar(name: string, value: string) {
  const text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  const re = new RegExp(`^\\s*${name}\\s*=.*$`, "m");
  const next = re.test(text) ? text.replace(re, `${name}=${value}`) : `${text.replace(/\s*$/, "")}\n${name}=${value}\n`;
  writeFileSync(ENV_FILE, next);
}

const env = { ...readEnv(), ...process.env } as Record<string, string | undefined>;
const KEY = env.ELEVENLABS_API_KEY?.trim();
if (!KEY) {
  console.error("ELEVENLABS_API_KEY is missing. Put it in .env.local (never in .env.local.example).");
  process.exit(1);
}

// ------------------------------------------------------------------ http

async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "xi-api-key": KEY!, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 1500)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

// ------------------------------------------------------------------ config

interface AgentFile {
  name: string;
  first_message: string;
  language: string;
  additional_languages: string[];
  dynamic_variable_placeholders: Record<string, string>;
  llm_preferences: string[];
  temperature: number;
  tts_model_id: string;
  voice_id: string;
  max_duration_seconds: number;
  enable_auth: boolean;
  end_call: boolean;
}
interface ToolDef {
  type: "client";
  name: string;
  description: string;
  expects_response: boolean;
  response_timeout_secs: number;
  parameters: unknown;
}

const readJson = <T>(p: string): T => JSON.parse(readFileSync(join(root, p), "utf8")) as T;
const cfg = readJson<AgentFile>("agent/agent.json");
const tools = readJson<{ tools: ToolDef[] }>("agent/tools.json").tools;
const prompt = readFileSync(join(root, "agent/system-prompt.md"), "utf8").trim();

const HINDI_FIRST_MESSAGE =
  "Namaste {{seller_name}} ji, main Asha bol rahi hoon, Snapdeal seller success se. {{call_context}}";

const systemTool = (name: string) => ({
  type: "system",
  name,
  description: "",
  params: { system_tool_type: name },
});

// ------------------------------------------------------------------ helpers

async function pickLlm(): Promise<string> {
  const { llms } = await api<{ llms: { llm: string; deprecation_info: unknown }[] }>("GET", "/v1/convai/llm/list");
  const available = new Set(llms.filter((l) => !l.deprecation_info).map((l) => l.llm));
  const pick = cfg.llm_preferences.find((l) => available.has(l));
  if (!pick) throw new Error(`None of ${cfg.llm_preferences.join(", ")} is available.`);
  return pick;
}

async function listClientTools(): Promise<{ id: string; tool_config: { name: string } }[]> {
  const all: { id: string; tool_config: { name: string } }[] = [];
  let cursor: string | undefined;
  do {
    const q = new URLSearchParams({ types: "client", page_size: "100" });
    if (cursor) q.set("cursor", cursor);
    const page = await api<{ tools: { id: string; tool_config: { name: string } }[]; has_more: boolean; next_cursor?: string }>(
      "GET",
      `/v1/convai/tools?${q}`,
    );
    all.push(...page.tools);
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return all;
}

async function upsertTools(): Promise<Record<string, string>> {
  const existing = await listClientTools();
  const ids: Record<string, string> = {};
  for (const t of tools) {
    const tool_config = {
      type: "client",
      name: t.name,
      description: t.description,
      expects_response: true, // "Wait for response" ON
      response_timeout_secs: t.response_timeout_secs,
      parameters: t.parameters,
    };
    const found = existing.find((e) => e.tool_config.name === t.name);
    if (found) {
      await api("PATCH", `/v1/convai/tools/${found.id}`, { tool_config });
      ids[t.name] = found.id;
      console.log(`  updated tool ${t.name}`);
    } else {
      const created = await api<{ id: string }>("POST", "/v1/convai/tools", { tool_config });
      ids[t.name] = created.id;
      console.log(`  created tool ${t.name}`);
    }
  }
  return ids;
}

async function findAgentId(): Promise<string | undefined> {
  if (env.NEXT_PUBLIC_AGENT_ID) return env.NEXT_PUBLIC_AGENT_ID;
  const q = new URLSearchParams({ search: cfg.name, page_size: "30" });
  const { agents } = await api<{ agents: { agent_id: string; name: string }[] }>("GET", `/v1/convai/agents?${q}`);
  return agents.find((a) => a.name === cfg.name)?.agent_id;
}

function agentBody(llm: string, toolIds: string[]) {
  const builtIn: Record<string, unknown> = {};
  if (cfg.end_call) builtIn.end_call = systemTool("end_call");
  if (cfg.additional_languages.length) builtIn.language_detection = systemTool("language_detection");

  const language_presets: Record<string, unknown> = {};
  for (const lang of cfg.additional_languages)
    language_presets[lang] = {
      overrides: { agent: { first_message: lang === "hi" ? HINDI_FIRST_MESSAGE : cfg.first_message } },
    };

  const tts: Record<string, unknown> = { model_id: cfg.tts_model_id };
  if (cfg.voice_id) tts.voice_id = cfg.voice_id;

  return {
    name: cfg.name,
    tags: ["snapdeal-kam"],
    conversation_config: {
      agent: {
        first_message: cfg.first_message,
        language: cfg.language,
        dynamic_variables: { dynamic_variable_placeholders: cfg.dynamic_variable_placeholders },
        prompt: {
          prompt,
          llm,
          temperature: cfg.temperature,
          tool_ids: toolIds,
          built_in_tools: builtIn,
        },
      },
      tts,
      conversation: { max_duration_seconds: cfg.max_duration_seconds },
      language_presets,
    },
    platform_settings: { auth: { enable_auth: cfg.enable_auth } },
  };
}

// ------------------------------------------------------------------ checklist

async function check(agentId: string) {
  const a = await api<any>("GET", `/v1/convai/agents/${agentId}`);
  const ag = a.conversation_config?.agent ?? {};
  const p = ag.prompt ?? {};
  const tts = a.conversation_config?.tts ?? {};
  const placeholders = ag.dynamic_variables?.dynamic_variable_placeholders ?? {};
  const toolIds: string[] = p.tool_ids ?? [];
  const live = await Promise.all(toolIds.map((id) => api<any>("GET", `/v1/convai/tools/${id}`)));
  const liveByName = new Map(live.map((t) => [t.tool_config.name, t.tool_config]));
  const builtIn = p.built_in_tools ?? {};
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);

  const rows: [boolean, string][] = [
    [a.name === cfg.name, `Name: ${a.name}`],
    [(p.prompt ?? "").trim() === prompt, "System prompt matches agent/system-prompt.md"],
    [ag.first_message === cfg.first_message, `First message: ${ag.first_message}`],
    [
      Object.entries(cfg.dynamic_variable_placeholders).every(([k, v]) => placeholders[k] === v),
      `Dynamic variables: ${Object.entries(placeholders).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    ],
    [cfg.llm_preferences.includes(p.llm), `LLM: ${p.llm}`],
    [Math.abs((p.temperature ?? -1) - cfg.temperature) < 1e-6, `Temperature: ${p.temperature}`],
    [ag.language === cfg.language, `Default language: ${ag.language}`],
    [
      cfg.additional_languages.every((l) => a.conversation_config?.language_presets?.[l]),
      `Additional languages: ${Object.keys(a.conversation_config?.language_presets ?? {}).join(", ") || "none"}`,
    ],
    [!cfg.additional_languages.length || Boolean(builtIn.language_detection), "language_detection system tool (switch to Hindi mid-call)"],
    [tts.model_id === cfg.tts_model_id, `TTS model: ${tts.model_id}`],
    [Boolean(cfg.voice_id) && tts.voice_id === cfg.voice_id, `Voice id: ${tts.voice_id}${cfg.voice_id ? "" : " (ElevenLabs default; set voice_id in agent/agent.json)"}`],
    [
      tools.every((t) => liveByName.has(t.name)) && toolIds.length === tools.length,
      `Client tools attached: ${toolIds.length}/${tools.length}`,
    ],
    [
      tools.every((t) => {
        const l = liveByName.get(t.name);
        return l && l.type === "client" && l.expects_response === true;
      }),
      "All tools are type client with Wait for response ON",
    ],
    [
      tools.every((t) => {
        const l = liveByName.get(t.name);
        return l && same(Object.keys(l.parameters?.properties ?? {}).sort(), Object.keys((t.parameters as any).properties).sort())
          && same([...(l.parameters?.required ?? [])].sort(), [...(t.parameters as any).required].sort());
      }),
      "Tool parameter names and required lists match agent/tools.json",
    ],
    [Boolean(builtIn.end_call), "end_call system tool enabled"],
    [a.conversation_config?.conversation?.max_duration_seconds === cfg.max_duration_seconds, `Max call duration: ${a.conversation_config?.conversation?.max_duration_seconds}s`],
    [a.platform_settings?.auth?.enable_auth === cfg.enable_auth, `Authentication (private agent): ${a.platform_settings?.auth?.enable_auth ? "ON" : "OFF"}`],
  ];
  console.log(`\nAgent ${agentId}`);
  for (const [ok, label] of rows) console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  return rows.every(([ok]) => ok);
}

// ------------------------------------------------------------------ commands

async function sync() {
  const llm = await pickLlm();
  console.log(`LLM: ${llm}`);
  console.log("Tools:");
  const ids = await upsertTools();
  const toolIds = tools.map((t) => ids[t.name]);
  const body = agentBody(llm, toolIds);

  let agentId = await findAgentId();
  if (agentId) {
    await api("PATCH", `/v1/convai/agents/${agentId}`, body);
    console.log(`Updated agent ${agentId}`);
  } else {
    agentId = (await api<{ agent_id: string }>("POST", "/v1/convai/agents/create", body)).agent_id;
    console.log(`Created agent ${agentId}`);
  }
  writeEnvVar("NEXT_PUBLIC_AGENT_ID", agentId);
  console.log("Wrote NEXT_PUBLIC_AGENT_ID to .env.local");
  const ok = await check(agentId);
  if (!ok) process.exitCode = 2;
}

async function voices() {
  const seen = new Map<string, any>();
  const queries = [
    { gender: "female", language: "en", accent: "indian" },
    { gender: "female", language: "hi" },
  ];
  for (const q of queries) {
    const params = new URLSearchParams({ ...q, page_size: "100", sort: "usage_character_count_1y" });
    const { voices } = await api<{ voices: any[] }>("GET", `/v1/shared-voices?${params}`);
    for (const v of voices) if (!seen.has(v.voice_id)) seen.set(v.voice_id, v);
  }
  const rows = [...seen.values()]
    .filter((v) => v.free_users_allowed !== false)
    .map((v) => {
      const langs = new Set((v.verified_languages ?? []).map((l: any) => l.language));
      langs.add(v.language);
      return { v, en: langs.has("en"), hi: langs.has("hi") };
    })
    .filter((r) => r.en && r.hi)
    .sort((a, b) => (b.v.usage_character_count_1y ?? 0) - (a.v.usage_character_count_1y ?? 0))
    .slice(0, 12);
  for (const { v } of rows)
    console.log(
      [v.voice_id, v.name, `${v.accent ?? ""}/${v.age ?? ""}`, v.use_case ?? "", `${Math.round((v.usage_character_count_1y ?? 0) / 1e6)}M chars/yr`, v.preview_url ?? "", (v.description ?? "").replace(/\s+/g, " ").slice(0, 110)].join(" | "),
    );
}

/** Adds a Voice Library voice to My Voices (required before an agent can use it), then points the agent at it. */
async function addVoice() {
  const voiceId = process.argv[3];
  if (!voiceId) throw new Error("Usage: npm run agent:add-voice -- <voice_id>");
  const mine = await api<{ voices: { voice_id: string }[] }>("GET", "/v2/voices?page_size=100");
  if (!mine.voices.some((v) => v.voice_id === voiceId)) {
    let found: any;
    for (const q of [{ gender: "female", language: "en", accent: "indian" }, { gender: "female", language: "hi" }]) {
      const params = new URLSearchParams({ ...q, page_size: "100", sort: "usage_character_count_1y" });
      const { voices } = await api<{ voices: any[] }>("GET", `/v1/shared-voices?${params}`);
      found = voices.find((v) => v.voice_id === voiceId);
      if (found) break;
    }
    if (!found) throw new Error(`Voice ${voiceId} not found in the shared library search.`);
    await api("POST", `/v1/voices/add/${found.public_owner_id}/${voiceId}`, { new_name: found.name });
    console.log(`Added "${found.name}" to My Voices`);
  }
  const file = join(root, "agent/agent.json");
  const json = JSON.parse(readFileSync(file, "utf8"));
  json.voice_id = voiceId;
  writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  cfg.voice_id = voiceId;
  console.log("Set voice_id in agent/agent.json; syncing agent…");
  await sync();
}

async function llms() {
  const { llms } = await api<{ llms: { llm: string; deprecation_info: unknown }[] }>("GET", "/v1/convai/llm/list");
  console.log(llms.filter((l) => !l.deprecation_info && /flash|mini|haiku|lite/.test(l.llm)).map((l) => l.llm).join("\n"));
}

const cmd = process.argv[2] ?? "sync";
const run = { sync, voices, llms, "add-voice": addVoice, check: async () => {
  const id = await findAgentId();
  if (!id) throw new Error("No agent found. Run npm run agent:sync first.");
  if (!(await check(id))) process.exitCode = 2;
} }[cmd];
if (!run) {
  console.error(`Unknown command ${cmd}. Use sync | check | voices | llms | add-voice <voice_id>`);
  process.exit(1);
}
run().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
