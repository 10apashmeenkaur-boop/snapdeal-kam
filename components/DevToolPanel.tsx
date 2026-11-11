"use client";

// Dev-only panel (?dev=1): call any tool with editable sample args, without a voice call.
// Results go through the same event bus as the voice agent, so the dashboard reacts identically.

import { useEffect, useState } from "react";
import { sampleArgs } from "@/lib/devSamples";
import { callTool } from "@/lib/uiBus";

type ToolInfo = { name: string; kind: "read" | "write" };
type LogEntry = { id: number; tool: string; ok: boolean; message: string };

export default function DevToolPanel({ sellerId }: { sellerId: string }) {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [selected, setSelected] = useState("get_diagnosis");
  const [argsText, setArgsText] = useState(() => JSON.stringify(sampleArgs("get_diagnosis", sellerId), null, 2));
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/tools").then((r) => r.json()).then(setTools);
  }, []);

  // Selecting a tool or switching seller sets args in the same render, so Run never sends stale args.
  const pick = (tool: string, seller = sellerId) => {
    setSelected(tool);
    setArgsText(JSON.stringify(sampleArgs(tool, seller), null, 2));
  };
  const [lastSeller, setLastSeller] = useState(sellerId);
  if (lastSeller !== sellerId) {
    setLastSeller(sellerId);
    pick(selected, sellerId);
  }

  async function run() {
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(argsText);
    } catch {
      setLog((l) => [{ id: Date.now(), tool: selected, ok: false, message: "Arguments aren't valid JSON." }, ...l]);
      return;
    }
    setBusy(true);
    const res = await callTool(selected, args, "dev", { callId: "dev_panel", callReason: "inbound" });
    setLog((l) => [{ id: Date.now(), tool: selected, ok: res.ok, message: res.message }, ...l].slice(0, 30));
    setBusy(false);
  }

  return (
    <section className="rounded-lg border border-dashed border-faint bg-surface p-4 text-sm">
      <h2 className="font-semibold">Dev tool panel</h2>
      <p className="text-[13px] text-muted">Runs tools for {sellerId} directly, without a voice call. Uses no ElevenLabs minutes.</p>
      <div className="mt-3 grid gap-4 md:grid-cols-[230px_1fr]">
        <div className="flex flex-col gap-1">
          {tools.map((t) => (
            <button
              key={t.name}
              onClick={() => pick(t.name)}
              className={`rounded-md px-2 py-1 text-left font-mono text-xs ${selected === t.name ? "bg-ink text-white" : "hover:bg-paper"}`}
            >
              <span className={selected === t.name ? "" : t.kind === "write" ? "text-accent" : "text-muted"}>{t.kind === "write" ? "W" : "R"}</span> {t.name}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <textarea
            aria-label="Tool arguments (JSON)"
            className="h-44 w-full rounded-md border border-rule bg-paper p-2 font-mono text-xs"
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
            spellCheck={false}
          />
          <button onClick={run} disabled={busy} className="self-start rounded-md bg-accent px-3 py-1.5 font-medium text-white hover:brightness-110 disabled:opacity-50">
            {busy ? "Running…" : `Run ${selected}`}
          </button>
          <ol className="flex max-h-80 flex-col gap-2 overflow-auto">
            {log.map((e) => (
              <li key={e.id} className={`rounded-md border p-2 ${e.ok ? "border-gain/40" : "border-loss/40 bg-loss/5"}`}>
                <div className="font-mono text-xs text-muted">
                  {e.ok ? "✓" : "✗"} {e.tool}
                </div>
                <div className="whitespace-pre-wrap break-words">{e.message}</div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
