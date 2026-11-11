"use client";

// Tiny in-browser event bus. Whoever runs a tool (the dev panel now, the voice
// agent's client tools in Phase 4) emits here; the dashboard and tool feed listen.

import type { ToolResponse } from "./tools";

export interface ToolEvent {
  id: number;
  at: number;
  name: string;
  args: Record<string, unknown>;
  response: ToolResponse;
  source: "agent" | "dev";
}

type Listener = (e: ToolEvent) => void;
const listeners = new Set<Listener>();
let seq = 0;

export function emitToolEvent(e: Omit<ToolEvent, "id" | "at">) {
  const full: ToolEvent = { ...e, id: ++seq, at: Date.now() };
  listeners.forEach((l) => l(full));
}

export function onToolEvent(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** POST a tool call to the backend and broadcast the result. */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
  source: ToolEvent["source"],
  ctx?: Record<string, unknown>,
): Promise<ToolResponse> {
  let response: ToolResponse;
  try {
    const res = await fetch(`/api/tools/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args, ctx }),
    });
    response = (await res.json()) as ToolResponse;
  } catch (err) {
    response = { ok: false, message: `Tool call failed: ${(err as Error).message}`, ui: { kind: "error" } };
  }
  emitToolEvent({ name, args, response, source });
  return response;
}
