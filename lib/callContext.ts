// One-line openers for calls Asha starts herself. They become {{call_context}} in the
// agent's first message, so every number here comes from computed metrics, never the LLM.

import type { HealthCheck, MonthMetrics } from "./types";

const fmtPct = (n: number) => `${Math.round(n * 10) / 10} percent`;

/** Follow-up call after the simulated week: lead with what changed. */
export function followupContext(before: MonthMetrics, after: MonthMetrics): string {
  const parts: string[] = ["It's been a week since we spoke."];
  if (after.orders > before.orders)
    parts.push(`Your orders are now tracking at ${after.orders} a month, up from ${before.orders}`);
  else if (after.orders < before.orders)
    parts.push(`Your orders have slipped to ${after.orders} a month, from ${before.orders}`);
  else parts.push(`Your orders are flat at ${after.orders} a month`);

  const c = after.cancelRate - before.cancelRate;
  if (c <= -1) parts[1] += `, and cancellations are down to ${fmtPct(after.cancelRate)}.`;
  else if (c >= 1) parts[1] += `, but cancellations are up to ${fmtPct(after.cancelRate)}.`;
  else parts[1] += `, with cancellations at ${fmtPct(after.cancelRate)}.`;

  parts.push("Can we go over what worked and what's still pending?");
  return parts.join(" ");
}

/** Proactive call from the health check. */
export function proactiveContext(h: HealthCheck): string | null {
  return h.callContext;
}
