"use client";

// Page shell: header (seller switcher + demo controls) and the three columns.

import { useCallback, useEffect, useState } from "react";
import { followupContext } from "@/lib/callContext";
import type { HealthCheck, MonthMetrics } from "@/lib/types";
import ActionTimeline, { PastCalls } from "./ActionTimeline";
import Dashboard from "./Dashboard";
import DevToolPanel from "./DevToolPanel";
import DiagnosisCard from "./DiagnosisCard";
import IncomingCallModal, { type IncomingCall } from "./IncomingCallModal";
import { useSellerState } from "./useSellerState";
import VoiceCall, { type CallRequest } from "./VoiceCall";

const SELLERS = [
  { id: "S1", short: "Sharma Home & Kitchen" },
  { id: "S2", short: "Priya Ethnic Wear" },
  { id: "S3", short: "GadgetHub" },
];

export default function Console({ dev }: { dev: boolean }) {
  const [sellerId, setSellerId] = useState("S1");
  const { state, changed, error, refresh } = useSellerState(sellerId);
  const [busy, setBusy] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [resetKey, setResetKey] = useState("0");
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [callRequest, setCallRequest] = useState<CallRequest | null>(null);
  const [inCall, setInCall] = useState(false);
  const onLiveChange = useCallback((live: boolean) => setInCall(live), []);

  const acceptIncoming = () => {
    if (!incoming) return;
    setCallRequest({ id: Date.now(), reason: incoming.reason, context: incoming.context });
    setIncoming(null);
    setHealth(null);
  };

  // Remember the last seller per viewer (a convenience only).
  useEffect(() => {
    try {
      const saved = localStorage.getItem("kam:seller");
      if (saved && SELLERS.some((s) => s.id === saved)) setSellerId(saved);
    } catch {}
  }, []);
  const choose = (id: string) => {
    setSellerId(id);
    setHealth(null);
    setIncoming(null);
    setCallRequest(null); // a fresh VoiceCall must not replay the last seller's call request
    try {
      localStorage.setItem("kam:seller", id);
    } catch {}
  };

  async function demo(path: "reset" | "simulate-week" | "health-check") {
    setBusy(path);
    try {
      const res = await fetch(`/api/demo/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellerId }),
      }).then((r) => r.json());
      if (path === "health-check") {
        const h = res as HealthCheck;
        setHealth(h);
        // Something worth a call: Asha rings the seller (unless already on a call).
        if (h.callContext && h.anomalies.length && !inCall)
          setIncoming({
            reason: "proactive",
            headline: h.anomalies[0].message.replace(/^./, (c) => c.toUpperCase()) + ".",
            context: h.callContext,
            details: h.anomalies.slice(1).map((a) => a.message),
          });
      }
      if (path === "simulate-week" && res.ok && state && !inCall) {
        const before = state.metrics.this as MonthMetrics;
        const after = res.week as MonthMetrics;
        setIncoming({
          reason: "followup",
          headline: `A week on: orders ${before.orders} → ${after.orders} a month, cancellations ${before.cancelRate}% → ${after.cancelRate}%. Asha wants to review last week's actions with you.`,
          context: followupContext(before, after),
        });
      }
      if (path === "reset") {
        setHealth(null);
        setIncoming(null);
        setResetKey(String(Date.now()));
      }
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  const s = state?.seller;

  return (
    <div className="mx-auto max-w-[1600px] px-4 pb-10 sm:px-6">
      <header className="flex flex-wrap items-end gap-x-6 gap-y-3 py-5">
        <div className="mr-auto min-w-0">
          <div className="text-[13px] text-muted">Snapdeal seller success</div>
          <h1 className="truncate text-2xl font-semibold tracking-tight">{s?.store ?? "Loading…"}</h1>
          {s && (
            <div className="text-[13px] text-muted">
              {s.name}, {s.city}. {s.category}, selling since {s.since}.
            </div>
          )}
        </div>

        <nav aria-label="Choose seller" className="flex max-w-full overflow-x-auto rounded-lg border border-rule bg-surface p-0.5 text-sm">
          {SELLERS.map((x) => (
            <button
              key={x.id}
              onClick={() => choose(x.id)}
              aria-current={x.id === sellerId ? "page" : undefined}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 ${x.id === sellerId ? "bg-ink text-white" : "text-muted hover:text-ink"}`}
            >
              {x.short}
            </button>
          ))}
        </nav>

        <div className="flex flex-wrap gap-2 text-sm">
          <button onClick={() => demo("reset")} disabled={!!busy} className="rounded-lg border border-rule bg-surface px-3 py-1.5 hover:border-ink disabled:opacity-50">
            {busy === "reset" ? "Resetting…" : "Reset demo"}
          </button>
          <button onClick={() => demo("simulate-week")} disabled={!!busy} className="rounded-lg border border-rule bg-surface px-3 py-1.5 hover:border-ink disabled:opacity-50">
            {busy === "simulate-week" ? "Simulating…" : "Simulate 7 days ⏩"}
          </button>
          <button onClick={() => demo("health-check")} disabled={!!busy} className="rounded-lg border border-rule bg-surface px-3 py-1.5 hover:border-ink disabled:opacity-50">
            {busy === "health-check" ? "Checking…" : "Run health check 🔔"}
          </button>
        </div>
      </header>

      {health && (
        <div role="status" className="mb-4 rounded-lg border border-accent/30 bg-accent-soft px-4 py-3 text-sm">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <div className="font-semibold">
                {health.anomalies.length ? `Health check found ${health.anomalies.length} issue${health.anomalies.length > 1 ? "s" : ""}` : "Health check found nothing urgent"}
              </div>
              <ul className="mt-1 list-disc pl-5">
                {health.anomalies.map((a) => (
                  <li key={a.key}>{a.message}</li>
                ))}
              </ul>
            </div>
            <button onClick={() => setHealth(null)} className="text-muted hover:text-ink" aria-label="Dismiss health check">
              ✕
            </button>
          </div>
        </div>
      )}

      {error && <p className="mb-4 rounded-lg border border-loss/40 bg-loss/5 px-4 py-3 text-sm text-loss">{error}. Check that the dev server is running, then reload.</p>}

      {state ? (
        <main className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1.35fr)_360px_minmax(0,1fr)]">
          <div className="order-2 min-w-0 lg:order-1">
            <Dashboard state={state} changed={changed} />
          </div>
          <div className="order-1 lg:order-2 lg:row-span-2 xl:row-span-1">
            <VoiceCall
              key={sellerId}
              sellerId={sellerId}
              sellerName={state.seller.name}
              resetKey={resetKey}
              request={callRequest}
              onCallEnd={() => refresh()}
              onLiveChange={onLiveChange}
            />
          </div>
          <div className="order-3 flex min-w-0 flex-col gap-4">
            <DiagnosisCard d={state.diagnosis} />
            <ActionTimeline state={state} changed={changed} />
            <PastCalls state={state} changed={changed} />
          </div>
        </main>
      ) : (
        !error && <p className="py-20 text-center text-muted">Loading seller data…</p>
      )}

      {incoming && state && (
        <IncomingCallModal
          call={incoming}
          sellerName={state.seller.name}
          onAccept={acceptIncoming}
          onDecline={() => setIncoming(null)}
        />
      )}

      {dev && (
        <div className="mt-6">
          <DevToolPanel sellerId={sellerId} />
        </div>
      )}
    </div>
  );
}
