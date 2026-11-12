"use client";

import { useMemo, useState } from "react";
import type { SellerState } from "@/lib/state";
import type { Sku } from "@/lib/types";
import { rupee } from "@/lib/uiFormat";
import type { Changed } from "./useSellerState";

type Filter = "all" | "out_of_stock" | "low_stock";

const daysLeft = (s: Sku) => (s.avgDailySales > 0 ? s.stock / s.avgDailySales : Infinity);
const isLow = (s: Sku) => s.status === "live" && s.stock > 0 && daysLeft(s) < 5;

function Status({ s }: { s: Sku }) {
  if (s.status === "unavailable")
    return <span className="inline-flex items-center gap-1.5 text-muted"><span className="size-2 rounded-full border border-faint" />Paused</span>;
  if (s.stock === 0)
    return (
      <span className="inline-flex items-center gap-1.5 font-medium text-accent" title="Listing is live with no stock, so new orders get cancelled">
        <span className="size-2 rounded-full bg-accent" />No stock
      </span>
    );
  return <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-gain" />Live</span>;
}

export default function SkuTable({ state, changed }: { state: SellerState; changed: Changed }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [showAll, setShowAll] = useState(false);

  const alerted = new Set(state.alerts.filter((a) => a.active).map((a) => a.sku));
  const deals = new Map(state.deals.map((d) => [d.sku, d]));

  const counts = {
    all: state.skus.length,
    out_of_stock: state.skus.filter((s) => s.stock === 0).length,
    low_stock: state.skus.filter(isLow).length,
  };

  const rows = useMemo(() => {
    let r = [...state.skus];
    if (filter === "out_of_stock") r = r.filter((s) => s.stock === 0);
    if (filter === "low_stock") r = r.filter(isLow);
    return r.sort((a, b) => b.ordersLast - a.ordersLast || a.sku.localeCompare(b.sku));
  }, [state.skus, filter]);

  // Keep any just-changed rows visible even when collapsed.
  const visible = showAll ? rows : rows.filter((s, i) => i < 12 || changed.skus.has(s.sku));

  const tabs: [Filter, string][] = [
    ["all", "All"],
    ["out_of_stock", "Out of stock"],
    ["low_stock", "Running low"],
  ];

  return (
    <section className="min-w-0 rounded-lg border border-rule bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-3">
        <h2 className="mr-auto font-semibold">Products</h2>
        <div role="tablist" aria-label="Filter products" className="flex rounded-md border border-rule p-0.5 text-[13px]">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={filter === key}
              onClick={() => setFilter(key)}
              className={`num rounded px-2.5 py-1 ${filter === key ? "bg-ink text-white" : "text-muted hover:text-ink"}`}
            >
              {label} {counts[key]}
            </button>
          ))}
        </div>
      </div>

      {/* Fits its card at laptop widths; scrolls sideways (visible scrollbar) only when the card is narrower than the table's floor. */}
      <div className="scroll-x overflow-x-auto">
        <table className="num w-full min-w-[440px] text-[13px]">
          <thead>
            <tr className="text-left text-[12px] leading-tight text-muted">
              <th className="py-2 pr-1.5 pl-3 font-medium">Product</th>
              <th className="px-1.5 py-2 text-right font-medium">Price</th>
              <th className="px-1.5 py-2 text-right font-medium">Stock</th>
              <th className="px-1.5 py-2 font-medium">Status</th>
              <th className="px-1.5 py-2 text-right font-medium" title="Search rank (change since last month)">Rank</th>
              <th className="w-[5.5rem] py-2 pr-3 pl-1.5 text-right font-medium">Orders (last → this)</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => {
              const deal = deals.get(s.sku);
              const rankSlip = s.searchRank - s.searchRankLast;
              const priced = s.price !== s.priceLast;
              return (
                <tr key={s.sku} className={`border-t border-rule ${changed.skus.has(s.sku) ? "just-changed" : ""}`}>
                  <td className="py-2 pr-1.5 pl-3">
                    <div className="font-medium leading-snug">{s.name}</div>
                    <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
                      <span className="font-mono">{s.sku}</span>
                      {alerted.has(s.sku) && <span title="Low-stock alert set">🔔 alert</span>}
                      {deal && <span className="font-medium text-accent">{deal.discountPct}% deal</span>}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-1.5 py-2 text-right">
                    <div>{rupee(s.price)}</div>
                    {priced && <div className="text-[11px] text-loss">was {rupee(s.priceLast)}</div>}
                    {s.competitorPrice !== undefined && s.competitorPrice < s.price && (
                      <div className="text-[11px] text-muted">rival {rupee(s.competitorPrice)}</div>
                    )}
                  </td>
                  <td className="px-1.5 py-2 text-right">
                    <div className={s.stock === 0 ? "font-medium text-accent" : ""}>{s.stock}</div>
                    {isLow(s) && <div className="whitespace-nowrap text-[11px] text-loss">{Math.max(1, Math.floor(daysLeft(s)))}d left</div>}
                  </td>
                  <td className="whitespace-nowrap px-1.5 py-2"><Status s={s} /></td>
                  <td className="whitespace-nowrap px-1.5 py-2 text-right">
                    {s.searchRank}
                    {rankSlip !== 0 && (
                      <span className={`ml-1 text-[11px] ${rankSlip > 0 ? "text-loss" : "text-gain"}`}>
                        {rankSlip > 0 ? `↓${rankSlip}` : `↑${-rankSlip}`}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 pl-1.5 text-right">
                    <span className="text-faint">{s.ordersLast}</span> → <span className="font-medium">{s.ordersThis}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length > 12 && (
        <button onClick={() => setShowAll((v) => !v)} className="w-full border-t border-rule px-4 py-2 text-sm text-muted hover:text-ink">
          {showAll ? "Show top 12" : `Show all ${rows.length} products`}
        </button>
      )}
      {rows.length === 0 && <p className="px-4 py-6 text-sm text-muted">No products match this filter.</p>}
    </section>
  );
}
