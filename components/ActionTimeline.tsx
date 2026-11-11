"use client";

import type { SellerState } from "@/lib/state";
import type { Action } from "@/lib/types";
import { shortDate } from "@/lib/uiFormat";
import type { Changed } from "./useSellerState";

const STATUS: Record<Action["status"], { label: string; dot: string; text: string }> = {
  proposed: { label: "Proposed", dot: "border-2 border-faint bg-surface", text: "text-muted" },
  executed: { label: "Done", dot: "bg-gain", text: "text-gain" },
  failed: { label: "Failed", dot: "bg-loss", text: "text-loss" },
};

export default function ActionTimeline({ state, changed }: { state: SellerState; changed: Changed }) {
  const actions = [...state.actions].reverse();
  const follow = [...state.followUps].reverse().find((f) => f.status === "scheduled");
  const escalation = [...state.escalations].reverse().find((e) => e.status === "open");

  return (
    <section className="rounded-lg border border-rule bg-surface p-4">
      <h2 className="font-semibold">Actions</h2>
      {actions.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Nothing yet. Every action Asha takes on a call lands here.</p>
      ) : (
        <ol className="relative mt-3 space-y-3 before:absolute before:top-1 before:bottom-1 before:left-[5px] before:w-px before:bg-rule">
          {actions.map((a) => {
            const st = STATUS[a.status];
            return (
              <li key={a.id} className={`relative grid grid-cols-[11px_1fr] gap-x-3 rounded ${changed.ids.has(a.id) ? "just-changed" : ""}`}>
                <span className={`relative mt-1 size-[11px] rounded-full ${st.dot}`} />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{a.title}</div>
                  <div className="text-[13px] text-muted">{a.detail}</div>
                  <div className="num mt-0.5 flex flex-wrap gap-x-3 text-[12px]">
                    <span className={st.text}>{st.label}</span>
                    <span className="text-muted">Owner: {a.owner === "KAM" ? "Asha" : "Seller"}</span>
                    {a.status === "proposed" && <span className="text-muted">Due {shortDate(a.due)}</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {escalation && (
        <div className={`mt-4 rounded-md border border-loss/30 bg-loss/5 p-3 text-sm ${changed.ids.has(escalation.id) ? "just-changed" : ""}`}>
          <div className="font-medium text-loss">Handed to a human account manager</div>
          <div className="text-[13px] text-muted">They call back within 24 hours. Reason: {escalation.reason}</div>
        </div>
      )}

      {follow && (
        <div className={`mt-4 rounded-md bg-paper p-3 ${changed.ids.has(follow.id) ? "just-changed" : ""}`}>
          <div className="text-sm font-medium">Follow-up call in {follow.dueInDays} days</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[13px] text-muted">
            {follow.targets.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function PastCalls({ state, changed }: { state: SellerState; changed: Changed }) {
  const REASON = { inbound: "Seller called", proactive: "Asha called", followup: "Follow-up" } as const;
  return (
    <section className="rounded-lg border border-rule bg-surface p-4">
      <h2 className="font-semibold">Past calls</h2>
      {state.callLogs.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No calls yet. Asha saves a summary at the end of each call.</p>
      ) : (
        <ul className="mt-2 divide-y divide-rule">
          {state.callLogs.map((c) => (
            <li key={c.id} className={`py-2 ${changed.ids.has(c.id) ? "just-changed" : ""}`}>
              <details>
                <summary className="cursor-pointer text-sm">
                  <span className="font-medium">{REASON[c.reason]}</span>{" "}
                  <span className="num text-muted">{shortDate(c.startedAt)}</span>
                </summary>
                <div className="mt-2 space-y-2 text-[13px]">
                  <p>{c.summary}</p>
                  {c.nextSteps.length > 0 && (
                    <div>
                      <div className="text-muted">Next steps</div>
                      <ul className="list-disc pl-4">
                        {c.nextSteps.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
