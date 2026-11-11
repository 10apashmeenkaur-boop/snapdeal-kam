"use client";

// Maps every tool name in agent/tools.json to a browser function the ElevenLabs
// agent can call. Each one POSTs to /api/tools/<name>, broadcasts the result to
// the dashboard (via the UI bus), and returns the short message to the agent.

import toolsJson from "@/agent/tools.json";
import type { TranscriptLine } from "./types";
import { callTool, emitToolEvent } from "./uiBus";

export const AGENT_TOOL_NAMES: string[] = toolsJson.tools.map((t) => t.name);

export interface CallContext {
  sellerId: string;
  callId?: string;
  callReason: "inbound" | "proactive" | "followup";
  transcript: TranscriptLine[];
}

export function buildClientTools(getCtx: () => CallContext) {
  const tools: Record<string, (params: Record<string, unknown>) => Promise<string>> = {};
  for (const name of AGENT_TOOL_NAMES) {
    tools[name] = async (params) => {
      const ctx = getCtx();
      // The agent should always pass seller_id; fill it in if the LLM forgets.
      const args = { seller_id: ctx.sellerId, ...(params ?? {}) };
      const res = await callTool(name, args, "agent", {
        callId: ctx.callId,
        callReason: ctx.callReason,
        transcript: name === "save_call_summary" ? ctx.transcript : undefined,
      });
      return res.message;
    };
  }
  return tools;
}

/** The agent asked for a tool the browser doesn't know: config drift. Make it loud. */
export function reportUnknownTool(name: string, params: unknown) {
  console.error(`[agent] UNKNOWN CLIENT TOOL "${name}". Run npm run agent:check; agent/tools.json and the dashboard disagree.`, params);
  emitToolEvent({
    name,
    args: (params as Record<string, unknown>) ?? {},
    response: { ok: false, message: "Unknown tool: not registered in the app.", ui: { kind: "error" } },
    source: "agent",
  });
}
