"use client";

// Left column: the seller's ledger. Metrics, why orders get cancelled, products, alerts and deals.

import type { SellerState } from "@/lib/state";
import type { MonthMetrics } from "@/lib/types";
import { humanize, pctChange, pctOf, rupee, signed } from "@/lib/uiFormat";
import type { Changed } from "./useSellerState";
import SkuTable from "./SkuTable";

type Direction = "up-good" | "up-bad" | "neutral";

const METRICS: { label: string; get: (m: MonthMetrics) => number; fmt: (n: number) => string; dir: Direction; points?: boolean }[] = [
  { label: "Sales", get: (m) => m.sales, fmt: rupee, dir: "up-good" },
  { label: "Orders", get: (m) => m.orders, fmt: (n) => n.toLocaleString("en-IN"), dir: "up-good" },
  { label: "Cancellation rate", get: (m) => m.cancelRate, fmt: pctOf, dir: "up-bad", points: true },
  { label: "Avg selling price", get: (m) => m.asp, fmt: rupee, dir: "neutral" },
  { label: "Out of stock", get: (m) => m.oosCount, fmt: (n) => `${n} products`, dir: "up-bad" },
];

function tone(delta: number, dir: Direction) {
  if (delta === 0 || dir === "neutral") return "text-muted";
  const good = dir === "up-good" ? delta > 0 : delta < 0;
  return good ? "text-gain" : "text-loss";
}

function MetricsStrip({ state, flash }: { state: SellerState; flash: boolean }) {
  const { last, this: now, week } = state.metrics;
  return (
    <section aria-label="Key metrics" className={`flex flex-wrap gap-px overflow-hidden rounded-lg border border-rule bg-rule ${flash ? "just-changed" : ""}`}>
      {METRICS.map((m) => {
        const a = m.get(last);
        const b = m.get(now);
        // Rates change in percentage points; everything else in percent.
        const delta = (x: number, y: number) => (m.points ? Math.round((y - x) * 10) / 10 : pctChange(x, y));
        const label = (n: number) => (m.points ? `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)} pts` : signed(n));
        const d = delta(a, b);
        const w = week ? m.get(week) : null;
        const dw = w === null ? 0 : delta(b, w);
        return (
          <div key={m.label} className="min-w-0 flex-1 basis-[150px] bg-surface px-4 py-3">
            <div className="text-[13px] text-muted">{m.label}</div>
            <div className="num mt-0.5 text-2xl font-semibold tracking-tight">{m.fmt(b)}</div>
            <div className="num mt-1 flex flex-wrap items-baseline gap-x-2 text-[13px]">
              <span className="text-faint">was {m.fmt(a)}</span>
              <span className={`font-medium ${tone(d, m.dir)}`}>{label(d)}</span>
            </div>
            {w !== null && (
              <div className="num mt-1.5 border-t border-dashed border-rule pt-1.5 text-[13px]">
                <span className="text-muted">After 7 days </span>
                <span className="font-medium">{m.fmt(w)}</span>{" "}
                <span className={tone(dw, m.dir)}>{label(dw)}</span>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

const REASON_COLORS = ["bg-accent", "bg-loss", "bg-plum-2", "bg-faint", "bg-muted"];

function CancelReasons({ state }: { state: SellerState }) {
  const { last, this: now } = state.metrics;
  const reasons = Object.entries(now.cancelReasons).sort((a, b) => b[1] - a[1]);
  const total = reasons.reduce((t, [, n]) => t + n, 0);
  return (
    <section className="rounded-lg border border-rule bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">Why orders were cancelled</h2>
        <span className="num text-[13px] text-muted">
          {total} this month, {Object.values(last.cancelReasons).reduce((t, n) => t + n, 0)} last month
        </span>
      </div>
      <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-rule" role="img" aria-label="Cancellations by reason">
        {reasons.map(([k, n], i) => (
          <div key={k} className={REASON_COLORS[i % REASON_COLORS.length]} style={{ width: `${(n / Math.max(total, 1)) * 100}%` }} />
        ))}
      </div>
      <ul className="num mt-3 grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-2">
        {reasons.map(([k, n], i) => (
          <li key={k} className="flex items-center gap-2">
            <span className={`size-2.5 shrink-0 rounded-sm ${REASON_COLORS[i % REASON_COLORS.length]}`} />
            <span>{humanize(k)}</span>
            <span className="ml-auto font-medium">{n}</span>
            <span className="w-14 text-right text-faint">was {last.cancelReasons[k] ?? 0}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AlertsAndDeals({ state, changed }: { state: SellerState; changed: Changed }) {
  const name = (sku: string) => state.skus.find((s) => s.sku === sku)?.name ?? sku;
  const alerts = state.alerts.filter((a) => a.active);
  if (!alerts.length && !state.deals.length) return null;
  return (
    <section className="grid gap-3 sm:grid-cols-2">
      {alerts.length > 0 && (
        <div className="rounded-lg border border-rule bg-surface p-4">
          <h2 className="font-semibold">Low-stock alerts</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {alerts.map((a) => (
              <li key={a.id} className={`rounded px-1 -mx-1 ${changed.ids.has(a.id) ? "just-changed" : ""}`}>
                {name(a.sku)} <span className="text-muted">warns under {a.thresholdDays} days of stock</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {state.deals.length > 0 && (
        <div className="rounded-lg border border-rule bg-surface p-4">
          <h2 className="font-semibold">Deals</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {state.deals.map((d) => {
              const s = state.skus.find((k) => k.sku === d.sku);
              return (
                <li key={d.id} className={`num rounded px-1 -mx-1 ${changed.ids.has(d.id) ? "just-changed" : ""}`}>
                  {name(d.sku)}{" "}
                  <span className="text-muted">
                    {d.discountPct}% off for {d.days} days{s ? `, ${rupee(s.price)} to ${rupee(s.price * (1 - d.discountPct / 100))}` : ""}
                    {d.startsWhen === "after_restock" ? ", starts after restock" : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

export default function Dashboard({ state, changed }: { state: SellerState; changed: Changed }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <MetricsStrip state={state} flash={changed.metrics} />
      <CancelReasons state={state} />
      <AlertsAndDeals state={state} changed={changed} />
      <SkuTable state={state} changed={changed} />
    </div>
  );
}
