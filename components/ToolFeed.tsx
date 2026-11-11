"use client";

// Live feed of every tool call: what Asha (or the dev panel) did, and whether it worked.

import { useEffect, useState } from "react";
import { onToolEvent, type ToolEvent } from "@/lib/uiBus";

function argSummary(args: Record<string, unknown>): string {
  return Object.entries(args)
    .filter(([k]) => k !== "seller_id" && k !== "seller_confirmed")
    .map(([, v]) => (Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v)))
    .join(", ")
    .slice(0, 90);
}

export default function ToolFeed({ resetKey }: { resetKey: string }) {
  const [events, setEvents] = useState<ToolEvent[]>([]);

  useEffect(() => onToolEvent((e) => setEvents((list) => [e, ...list].slice(0, 40))), []);
  useEffect(() => setEvents([]), [resetKey]);

  return (
    <section aria-label="Tool calls" className="min-h-0">
      <h3 className="text-sm font-semibold text-white/90">What Asha did</h3>
      {events.length === 0 ? (
        <p className="mt-2 text-[13px] text-white/50">Each lookup and action Asha takes shows up here as it happens.</p>
      ) : (
        <ol className="mt-2 space-y-2" aria-live="polite">
          {events.map((e) => {
            const confirmed = e.args.seller_confirmed === true;
            return (
              <li key={e.id} className="rounded-md bg-plum-2 px-3 py-2 text-[13px]">
                <div className="flex items-start gap-2">
                  <span aria-hidden className={e.response.ok ? "text-emerald-300" : "text-rose-300"}>
                    {e.response.ok ? "✓" : "✗"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="break-words text-white">
                      <span className="text-white/50">{e.source === "dev" ? "Dev panel ran" : "Asha called"} </span>
                      <span className="font-mono text-[12px]">
                        {e.name}({argSummary(e.args)})
                      </span>
                      {confirmed && <span className="ml-1 text-[11px] text-emerald-300">seller said yes</span>}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-white/55">{e.response.message}</div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
