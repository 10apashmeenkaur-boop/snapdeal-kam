"use client";

import type { Diagnosis } from "@/lib/types";
import { rupee } from "@/lib/uiFormat";

const LABEL: Record<string, string> = {
  stockouts: "Stock-outs",
  pricing: "Pricing",
  dispatch: "Slow dispatch",
  cancellations: "Cancellations",
  visibility: "Lower visibility",
};

const CONFIDENCE: Record<string, string> = {
  high: "High confidence",
  med: "Medium confidence",
  low: "Low confidence",
};

export default function DiagnosisCard({ d }: { d: Diagnosis }) {
  const h = d.headline;
  const priceNote =
    h.aspChangePct === 0
      ? "Prices held steady, so the whole drop is fewer orders."
      : `Average price ${h.aspChangePct > 0 ? "rose" : "fell"} ${Math.abs(h.aspChangePct)}%, which ${h.aspChangePct > 0 ? "softened" : "deepened"} the drop by ${rupee(Math.abs(h.priceEffectRupees))}.`;

  return (
    <section className="rounded-lg border border-rule bg-surface p-4">
      <h2 className="font-semibold">What&rsquo;s driving the drop</h2>
      <p className="num mt-2 text-[15px] leading-snug">
        Sales fell <strong>{rupee(h.salesDrop)}</strong> ({h.salesDropPct}%) as orders went from {h.ordersLast} to {h.ordersThis}.
      </p>
      <p className="num mt-1 text-[13px] text-muted">
        {priceNote} After cancellations, kept revenue is down {h.realisedRevenueDropPct}%.
      </p>

      {d.causes.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No problems found in this seller&rsquo;s data.</p>
      ) : (
        <ol className="mt-4 space-y-4">
          {d.causes.map((c, i) => {
            const isCancel = c.key === "cancellations";
            return (
              <li key={c.key} className="grid grid-cols-[1.5rem_1fr] gap-x-2">
                <span className={`num grid size-6 place-items-center rounded-full text-[12px] font-semibold ${i === 0 ? "bg-accent text-white" : "bg-rule text-muted"}`}>
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold">{LABEL[c.key]}</span>
                    <span className="text-[12px] text-muted">{CONFIDENCE[c.confidence]}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-rule">
                    <div className={`h-full rounded-full ${i === 0 ? "bg-accent" : "bg-ink/50"}`} style={{ width: `${Math.min(100, c.shareOfDropPct)}%` }} />
                  </div>
                  <div className="num mt-1 text-[13px]">
                    {isCancel ? (
                      <>About {c.impactOrders} extra cancelled orders, {rupee(c.impactRupees)}</>
                    ) : (
                      <>
                        {c.impactOrders} orders, {rupee(c.impactRupees)}, {Math.round(c.shareOfDropPct)}% of the drop
                      </>
                    )}
                  </div>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[13px] text-muted">
                    {c.evidence.slice(0, 2).map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                  {c.unknowns[0] && (
                    <p className="mt-1.5 text-[13px]">
                      <span className="text-muted">Asha asks: </span>
                      {c.unknowns[0]}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
