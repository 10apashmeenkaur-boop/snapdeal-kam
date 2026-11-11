"use client";

// Dev-only panel (?dev=1): call every tool with editable sample args, without a voice call.

import { useCallback, useEffect, useState } from "react";
import { sampleArgs } from "@/lib/devSamples";

type ToolInfo = { name: string; kind: "read" | "write" };
type LogEntry = { id: number; tool: string; args: unknown; ok: boolean; message: string };

interface Peek {
  orders: number;
  week: number | null;
  oos: number;
  unavailable: number;
  actions: number;
  alerts: number;
  deals: number;
  calls: number;
}

export default function DevToolPanel({ sellerId: initialSeller = "S1", onChange }: { sellerId?: string; onChange?: () => void }) {
  const [sellerId, setSellerId] = useState(initialSeller);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [selected, setSelected] = useState("get_diagnosis");
  const [argsText, setArgsText] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [peek, setPeek] = useState<Peek | null>(null);

  const refresh = useCallback(async () => {
    const s = await fetch(`/api/seller/${sellerId}`, { cache: "no-store" }).then((r) => r.json());
    setPeek({
      orders: s.metrics.this.orders,
      week: s.metrics.week?.orders ?? null,
      oos: s.skus.filter((k: { stock: number }) => k.stock === 0).length,
      unavailable: s.skus.filter((k: { status: string }) => k.status === "unavailable").length,
      actions: s.actions.length,
      alerts: s.alerts.length,
      deals: s.deals.length,
      calls: s.callLogs.length,
    });
    onChange?.();
  }, [sellerId, onChange]);

  useEffect(() => {
    fetch("/api/tools").then((r) => r.json()).then(setTools);
  }, []);
  // Set args in the same event as the selection, so Run never sends stale args.
  const pick = (tool: string, seller = sellerId) => {
    setSelected(tool);
    setArgsText(JSON.stringify(sampleArgs(tool, seller), null, 2));
  };
  useEffect(() => {
    setArgsText(JSON.stringify(sampleArgs("get_diagnosis", initialSeller), null, 2));
  }, [initialSeller]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const push = (e: Omit<LogEntry, "id">) => setLog((l) => [{ ...e, id: Date.now() + Math.random() }, ...l].slice(0, 30));

  async function runTool() {
    let args: unknown;
    try {
      args = JSON.parse(argsText);
    } catch {
      push({ tool: selected, args: argsText, ok: false, message: "Args are not valid JSON" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/tools/${selected}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args, ctx: { callId: "dev_panel", callReason: "inbound" } }),
      }).then((r) => r.json());
      push({ tool: selected, args, ok: res.ok, message: res.message });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function demo(path: string, label: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/demo/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellerId }),
      }).then((r) => r.json());
      push({ tool: label, args: { sellerId }, ok: res.ok !== false && !res.error, message: JSON.stringify(res).slice(0, 600) });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-dashed border-amber-400 bg-amber-50/60 p-4 text-sm text-zinc-800">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-semibold">Dev tool panel <span className="font-normal text-zinc-500">(no voice minutes used)</span></h2>
        <select
          aria-label="Seller"
          className="rounded-md border border-zinc-300 bg-white px-2 py-1"
          value={sellerId}
          onChange={(e) => {
            setSellerId(e.target.value);
            pick(selected, e.target.value);
          }}
        >
          {["S1", "S2", "S3"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <button className="rounded-md border border-zinc-300 bg-white px-2 py-1 hover:bg-zinc-50" disabled={busy} onClick={() => demo("reset", "reset")}>
          Reset demo
        </button>
        <button className="rounded-md border border-zinc-300 bg-white px-2 py-1 hover:bg-zinc-50" disabled={busy} onClick={() => demo("simulate-week", "simulate-week")}>
          Simulate 7 days
        </button>
        <button className="rounded-md border border-zinc-300 bg-white px-2 py-1 hover:bg-zinc-50" disabled={busy} onClick={() => demo("health-check", "health-check")}>
          Health check
        </button>
      </div>

      {peek && (
        <p className="mb-3 font-mono text-xs text-zinc-600">
          {sellerId}: orders {peek.orders}
          {peek.week !== null && ` → week+1 ${peek.week}`} · out of stock {peek.oos} · unavailable {peek.unavailable} · actions {peek.actions} · alerts {peek.alerts} · deals {peek.deals} · calls {peek.calls}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <div className="flex flex-col gap-1">
          {tools.map((t) => (
            <button
              key={t.name}
              onClick={() => pick(t.name)}
              className={`rounded-md px-2 py-1 text-left font-mono text-xs ${
                selected === t.name ? "bg-rose-600 text-white" : "bg-white hover:bg-rose-50"
              }`}
            >
              <span className={selected === t.name ? "" : t.kind === "write" ? "text-rose-600" : "text-sky-700"}>
                {t.kind === "write" ? "W" : "R"}
              </span>{" "}
              {t.name}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <textarea
            aria-label="Tool arguments (JSON)"
            className="h-44 w-full rounded-md border border-zinc-300 bg-white p-2 font-mono text-xs"
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
            spellCheck={false}
          />
          <button
            onClick={runTool}
            disabled={busy}
            className="self-start rounded-md bg-rose-600 px-3 py-1.5 font-medium text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {busy ? "Running…" : `Run ${selected}`}
          </button>
          <ol className="flex max-h-96 flex-col gap-2 overflow-auto">
            {log.map((e) => (
              <li key={e.id} className={`rounded-md border p-2 ${e.ok ? "border-emerald-300 bg-white" : "border-rose-300 bg-rose-50"}`}>
                <div className="font-mono text-xs text-zinc-500">
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
