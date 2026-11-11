// Tool layer: the only way the agent (or the dev panel) can read or change the
// mock seller backend. Every tool validates its arguments with zod, enforces
// guardrails in code, and returns a short string the agent can speak from.
//
// executeTool() is pure (DB in, DB out) so it's unit-testable; the API route
// wraps it in the store's atomic updateDB().

import { z } from "zod";
import { diagnose, getMetrics, sellerSkus } from "./analytics";
import { change, humanReason, inr } from "./format";
import type { Action, ActionType, CallLog, DB, Seller, Sku, TranscriptLine } from "./types";

// ---------------------------------------------------------------- types

export interface ToolContext {
  callId?: string;
  callReason?: CallLog["reason"];
  transcript?: TranscriptLine[];
  now?: Date;
}

export type UiKind =
  | "read"
  | "sku"
  | "alert"
  | "deal"
  | "action"
  | "followup"
  | "summary"
  | "escalation"
  | "error";

export interface ToolResponse {
  ok: boolean;
  message: string; // what the agent hears back
  ui: { kind: UiKind; skus?: string[] }; // what the dashboard should animate
}

export interface ToolOutcome {
  db: DB;
  response: ToolResponse;
  changed: boolean; // whether db should be persisted
}

/** A guardrail or lookup failure: reported to the agent, nothing is written. */
class ToolError extends Error {}

export const NOT_CONFIRMED = "NOT EXECUTED: ask the seller to confirm first";
const MAX_DISCOUNT_PCT = 30;
const MIN_MARGIN = 1.05; // deal price must stay ≥ cost × 1.05

// ---------------------------------------------------------------- schema helpers

const sellerId = z.string().trim().toUpperCase();

/** Only a literal true (or "true") counts as consent. */
const confirmed = z.preprocess((v) => v === true || v === "true", z.boolean());

/** Accept ["HK-112"] or "HK-112, HK-087". */
const skuList = z.preprocess(
  (v) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : v),
  z.array(z.string().trim().min(1)).min(1, "give at least one SKU").max(20),
);

/** Accept ["a", "b"] or a single string. */
const textList = z.preprocess(
  (v) => (typeof v === "string" ? [v] : v),
  z.array(z.string().trim().min(1)).max(10),
);

const int = (min: number, max: number, unit: string) =>
  z.coerce
    .number()
    .refine((n) => n >= min && n <= max, `must be between ${min} and ${max} ${unit}`)
    .transform((n) => Math.round(n));

// ---------------------------------------------------------------- lookup helpers

const iso = (d: Date) => d.toISOString();
// Full timestamp (not a UTC date string) so local display shows the right day in IST.
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000).toISOString();
const newId = (p: string) => `${p}_${Math.random().toString(36).slice(2, 9)}`;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function getSeller(db: DB, id: string): Seller {
  const s = db.sellers.find((x) => x.id === id);
  if (!s)
    throw new ToolError(
      `Unknown seller_id "${id}". Valid ids: ${db.sellers.map((x) => x.id).join(", ")}`,
    );
  return s;
}

/** Match by SKU code ("HK-112", "hk112") or, as a voice-friendly fallback, by product name. */
function resolveSkus(db: DB, sellerId: string, wanted: string[]): Sku[] {
  const mine = sellerSkus(db, sellerId);
  const found: Sku[] = [];
  const missing: string[] = [];
  for (const w of wanted) {
    const n = norm(w);
    const hit =
      mine.find((s) => norm(s.sku) === n) ??
      mine.find((s) => norm(s.name) === n) ??
      mine.find((s) => n.length >= 4 && (norm(s.name).includes(n) || n.includes(norm(s.name))));
    if (hit) {
      if (!found.includes(hit)) found.push(hit);
    } else missing.push(w);
  }
  if (missing.length)
    throw new ToolError(
      `NOT EXECUTED: ${missing.join(", ")} not found for this seller. Use get_sku_details to look up SKU codes.`,
    );
  return found;
}

function requireConfirmation(ok: boolean) {
  if (!ok) throw new ToolError(NOT_CONFIRMED);
}

function addAction(
  db: DB,
  ctx: ToolContext,
  a: {
    sellerId: string;
    type: ActionType;
    title: string;
    detail: string;
    payload: Record<string, unknown>;
    owner: Action["owner"];
    status: Action["status"];
    dueDays: number;
  },
): Action {
  const now = ctx.now ?? new Date();
  const action: Action = {
    id: newId("act"),
    sellerId: a.sellerId,
    type: a.type,
    title: a.title,
    detail: a.detail,
    payload: a.payload,
    status: a.status,
    owner: a.owner,
    due: addDays(now, a.dueDays),
    createdAt: iso(now),
    callId: ctx.callId,
  };
  db.actions.push(action);
  return action;
}

const names = (skus: Sku[], max = 3) => {
  const shown = skus.slice(0, max).map((s) => s.name);
  return skus.length > max ? `${shown.join(", ")} and ${skus.length - max} more` : shown.join(", ");
};

const daysOfCover = (s: Sku) => (s.avgDailySales > 0 ? s.stock / s.avgDailySales : Infinity);

// ---------------------------------------------------------------- tool registry

interface RunResult {
  message: string;
  ui: ToolResponse["ui"];
}

interface ToolDef<S extends z.ZodType> {
  kind: "read" | "write";
  schema: S;
  run: (db: DB, args: z.output<S>, ctx: ToolContext) => RunResult;
}

const def = <S extends z.ZodType>(d: ToolDef<S>) => d as unknown as ToolDef<z.ZodType>;

const CAUSE_LABEL: Record<string, string> = {
  stockouts: "stock-outs",
  pricing: "pricing",
  dispatch: "slow dispatch",
  cancellations: "cancellations",
  visibility: "lower visibility",
};

export const TOOLS: Record<string, ToolDef<z.ZodType>> = {
  // ============================== READ ==============================

  get_seller_snapshot: def({
    kind: "read",
    schema: z.object({ seller_id: sellerId }),
    run(db, { seller_id }) {
      const s = getSeller(db, seller_id);
      const l = getMetrics(db, s.id, "last")!;
      const t = getMetrics(db, s.id, "this")!;
      const w = getMetrics(db, s.id, "week+1");
      let msg =
        `${s.store}: sales ${inr(l.sales)} last month, ${inr(t.sales)} this month (${change(l.sales, t.sales)}). ` +
        `Orders ${l.orders} to ${t.orders}. Cancellation rate ${l.cancelRate}% to ${t.cancelRate}%. ` +
        `Average price ${l.asp} to ${t.asp} rupees. Out-of-stock products ${l.oosCount} to ${t.oosCount}. ` +
        `Dispatch ${l.avgDispatchDays} to ${t.avgDispatchDays} days, rating ${l.rating} to ${t.rating}.`;
      if (w)
        msg += ` Latest week, as a monthly run-rate: ${w.orders} orders, ${inr(w.sales)}, cancellation ${w.cancelRate}%, ${w.oosCount} out of stock.`;
      return { message: msg, ui: { kind: "read" } };
    },
  }),

  get_diagnosis: def({
    kind: "read",
    schema: z.object({ seller_id: sellerId }),
    run(db, { seller_id }) {
      const s = getSeller(db, seller_id);
      const d = diagnose(db, s.id);
      const h = d.headline;
      const price =
        h.aspChangePct === 0
          ? "average price is flat, so the whole drop is volume"
          : `average price ${h.aspChangePct > 0 ? "up" : "down"} ${Math.abs(h.aspChangePct)}%`;
      const parts = [
        `Sales down ${inr(h.salesDrop)} (${h.salesDropPct}%), orders down ${h.orderDrop} (${h.ordersLast} to ${h.ordersThis}); ${price}. ` +
          `Revenue kept after cancellations ${inr(h.realisedRevenueLast)} to ${inr(h.realisedRevenueThis)} (down ${h.realisedRevenueDropPct}%).`,
      ];
      d.causes.slice(0, 3).forEach((c, i) => {
        const size =
          c.key === "cancellations"
            ? `about ${c.impactOrders} extra cancelled orders, ${inr(c.impactRupees)}`
            : `${c.impactOrders} orders, ${inr(c.impactRupees)}, ${Math.round(c.shareOfDropPct)}% of the order drop`;
        // Keep it short for latency: full evidence for the top cause, two lines for the rest.
        let line = `Cause ${i + 1}: ${CAUSE_LABEL[c.key]} (${c.confidence} confidence): ${size}. ${c.evidence.slice(0, i === 0 ? 3 : 2).join("; ")}.`;
        if (i === 0 && c.skus?.length)
          line += ` Products: ${c.skus.slice(0, 4).map((k) => `${k.name} ${k.sku} (${k.orders} orders)`).join(", ")}.`;
        parts.push(line);
      });
      if (d.causes[0]) parts.push(`Ask the seller (one at a time): ${d.causes[0].unknowns.join(" ")}`);
      return { message: parts.join(" "), ui: { kind: "read" } };
    },
  }),

  get_sku_details: def({
    kind: "read",
    schema: z.object({
      seller_id: sellerId,
      filter: z.enum(["out_of_stock", "top_sellers", "low_rank"]),
    }),
    run(db, { seller_id, filter }) {
      const s = getSeller(db, seller_id);
      let list = sellerSkus(db, s.id);
      if (filter === "out_of_stock")
        list = list.filter((k) => k.stock === 0).sort((a, b) => b.ordersLast - a.ordersLast);
      else if (filter === "top_sellers") list = [...list].sort((a, b) => b.ordersLast - a.ordersLast);
      else
        list = list
          .filter((k) => k.status === "live")
          .sort((a, b) => b.searchRank - b.searchRankLast - (a.searchRank - a.searchRankLast));
      const top = list.slice(0, 5);
      if (!top.length) return { message: `No products match ${filter.replace(/_/g, " ")}.`, ui: { kind: "read" } };
      const lines = top.map((k) => {
        const comp = k.competitorPrice ? `, competitor ${k.competitorPrice}` : "";
        return `${k.sku} ${k.name}: stock ${k.stock}, ${k.status}, price ${k.price}${comp}, search rank ${k.searchRank} (was ${k.searchRankLast}), orders ${k.ordersLast} last month, ${k.ordersThis} this month`;
      });
      const more = list.length > 5 ? ` (${list.length - 5} more not shown)` : "";
      return { message: lines.join("; ") + more + ".", ui: { kind: "read", skus: top.map((k) => k.sku) } };
    },
  }),

  get_cancellation_breakdown: def({
    kind: "read",
    schema: z.object({ seller_id: sellerId }),
    run(db, { seller_id }) {
      const s = getSeller(db, seller_id);
      const l = getMetrics(db, s.id, "last")!;
      const t = getMetrics(db, s.id, "this")!;
      const total = Object.values(t.cancelReasons).reduce((a, b) => a + b, 0);
      const reasons = Object.entries(t.cancelReasons)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${humanReason(k)} ${n} (was ${l.cancelReasons[k] ?? 0})`);
      return {
        message: `This month ${total} cancellations, ${t.cancelRate}% of orders (last month ${l.cancelRate}%): ${reasons.join(", ")}.`,
        ui: { kind: "read" },
      };
    },
  }),

  get_account_history: def({
    kind: "read",
    schema: z.object({ seller_id: sellerId }),
    run(db, { seller_id }) {
      const s = getSeller(db, seller_id);
      const calls = db.callLogs
        .filter((c) => c.sellerId === s.id)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      const actions = db.actions.filter((a) => a.sellerId === s.id);
      const follow = db.followUps
        .filter((f) => f.sellerId === s.id && f.status === "scheduled")
        .at(-1);
      const escalations = db.escalations.filter((e) => e.sellerId === s.id && e.status === "open");
      const parts: string[] = [`${s.name}, ${s.store}, ${s.city}, selling since ${s.since}.`];

      if (!calls.length && !actions.length) {
        parts.push("No previous calls or actions. This is the first conversation.");
      } else {
        const c = calls[0];
        if (c) parts.push(`Last call (${c.startedAt.slice(0, 10)}, ${c.reason}): ${c.summary}`);
        if (actions.length)
          parts.push(
            `Actions: ${actions
              .slice(-6)
              .map((a) => `${a.title} (owner ${a.owner}, ${a.status})`)
              .join("; ")}.`,
          );
        if (follow) parts.push(`Follow-up targets: ${follow.targets.join("; ")}.`);
      }
      const t = getMetrics(db, s.id, "this")!;
      const w = getMetrics(db, s.id, "week+1");
      if (w)
        parts.push(
          `Since then, monthly run-rate: orders ${t.orders} to ${w.orders}, sales ${inr(t.sales)} to ${inr(w.sales)}, ` +
            `cancellation ${t.cancelRate}% to ${w.cancelRate}%, out of stock ${t.oosCount} to ${w.oosCount}, dispatch ${t.avgDispatchDays} to ${w.avgDispatchDays} days.`,
        );
      if (escalations.length) parts.push(`Open escalation: ${escalations.at(-1)!.reason}.`);
      return { message: parts.join(" "), ui: { kind: "read" } };
    },
  }),

  // ============================== WRITE ==============================

  mark_listings_unavailable: def({
    kind: "write",
    schema: z.object({ seller_id: sellerId, skus: skuList, seller_confirmed: confirmed }),
    run(db, a, ctx) {
      const s = getSeller(db, a.seller_id);
      const skus = resolveSkus(db, s.id, a.skus);
      const inStock = skus.filter((k) => k.stock > 0);
      const targets = skus.filter((k) => k.stock === 0 && k.status === "live");
      if (!targets.length)
        throw new ToolError(
          inStock.length
            ? `NOT EXECUTED: ${names(inStock)} still ${inStock.length > 1 ? "have" : "has"} stock; only out-of-stock listings can be marked unavailable.`
            : "Nothing to do: those listings are already unavailable.",
        );
      requireConfirmation(a.seller_confirmed);
      targets.forEach((k) => (k.status = "unavailable"));
      addAction(db, ctx, {
        sellerId: s.id,
        type: "mark_listings_unavailable",
        title: `Paused ${targets.length} out-of-stock listing${targets.length > 1 ? "s" : ""}`,
        detail: targets.map((k) => `${k.sku} ${k.name}`).join(", "),
        payload: { skus: targets.map((k) => k.sku) },
        owner: "KAM",
        status: "executed",
        dueDays: 0,
      });
      const skipped = inStock.length ? ` Skipped ${names(inStock)} because ${inStock.length > 1 ? "they have" : "it has"} stock.` : "";
      return {
        message: `Done. Marked ${targets.length} listing${targets.length > 1 ? "s" : ""} unavailable: ${names(targets)}. No new orders will come in and get cancelled; they go live again once restocked.${skipped}`,
        ui: { kind: "sku", skus: targets.map((k) => k.sku) },
      };
    },
  }),

  set_low_stock_alert: def({
    kind: "write",
    schema: z.object({
      seller_id: sellerId,
      skus: skuList,
      threshold_days: int(3, 30, "days"),
      seller_confirmed: confirmed,
    }),
    run(db, a, ctx) {
      const s = getSeller(db, a.seller_id);
      const skus = resolveSkus(db, s.id, a.skus);
      requireConfirmation(a.seller_confirmed);
      for (const k of skus) {
        db.alerts = db.alerts.filter((x) => !(x.sellerId === s.id && x.sku === k.sku));
        db.alerts.push({
          id: newId("alr"),
          sellerId: s.id,
          sku: k.sku,
          type: "low_stock",
          thresholdDays: a.threshold_days,
          active: true,
        });
      }
      addAction(db, ctx, {
        sellerId: s.id,
        type: "set_low_stock_alert",
        title: `Low-stock alerts on ${skus.length} product${skus.length > 1 ? "s" : ""} (${a.threshold_days} days)`,
        detail: skus.map((k) => `${k.sku} ${k.name}`).join(", "),
        payload: { skus: skus.map((k) => k.sku), threshold_days: a.threshold_days },
        owner: "KAM",
        status: "executed",
        dueDays: 0,
      });
      const below = skus.filter((k) => daysOfCover(k) < a.threshold_days);
      const warn = below.length
        ? ` Already below the threshold now: ${below.map((k) => (k.stock === 0 ? `${k.name} (out of stock)` : `${k.name} (${Math.floor(daysOfCover(k))} days left)`)).slice(0, 3).join(", ")}.`
        : "";
      return {
        message: `Done. Low-stock alerts set on ${names(skus)}: the seller is warned when stock drops below ${a.threshold_days} days of sales.${warn}`,
        ui: { kind: "alert", skus: skus.map((k) => k.sku) },
      };
    },
  }),

  create_restock_plan: def({
    kind: "write",
    schema: z.object({ seller_id: sellerId, skus: skuList, seller_confirmed: confirmed }),
    run(db, a, ctx) {
      const s = getSeller(db, a.seller_id);
      const skus = resolveSkus(db, s.id, a.skus).sort((x, y) => y.ordersLast - x.ordersLast);
      requireConfirmation(a.seller_confirmed);
      const plan = skus.map((k, i) => ({
        priority: i + 1,
        sku: k.sku,
        name: k.name,
        units: Math.max(10, Math.ceil(k.avgDailySales * 30)),
        ordersPerMonth: k.ordersLast,
      }));
      const orders = plan.reduce((t, p) => t + p.ordersPerMonth, 0);
      addAction(db, ctx, {
        sellerId: s.id,
        type: "create_restock_plan",
        title: `Restock ${skus.length} product${skus.length > 1 ? "s" : ""} (about ${orders} orders a month)`,
        detail: plan.map((p) => `${p.priority}. ${p.name}: ${p.units} units`).join("; "),
        payload: { skus: plan.map((p) => p.sku), plan },
        owner: "Seller",
        status: "proposed",
        dueDays: 3,
      });
      return {
        message: `Done. Restock plan created for the seller, due in 3 days, in priority order: ${plan
          .slice(0, 4)
          .map((p) => `${p.name} about ${p.units} units`)
          .join(", ")}${plan.length > 4 ? ` and ${plan.length - 4} more` : ""}. Together they sold ${orders} orders a month.`,
        ui: { kind: "action", skus: plan.map((p) => p.sku) },
      };
    },
  }),

  create_deal: def({
    kind: "write",
    schema: z.object({
      seller_id: sellerId,
      sku: z.string().trim().min(1),
      discount_pct: z.coerce.number().positive("must be above 0"),
      days: int(1, 30, "days"),
      start: z.enum(["now", "after_restock"]).default("now"),
      seller_confirmed: confirmed,
    }),
    run(db, a, ctx) {
      const s = getSeller(db, a.seller_id);
      const [k] = resolveSkus(db, s.id, [a.sku]);
      // Guardrails run before the confirmation check, so the agent learns the
      // safe limit before it asks the seller.
      const marginMax = Math.floor((1 - (k.cost * MIN_MARGIN) / k.price) * 100);
      const maxPct = Math.max(0, Math.min(MAX_DISCOUNT_PCT, marginMax));
      const priceAt = (p: number) => Math.round(k.price * (1 - p / 100));
      if (maxPct <= 0)
        throw new ToolError(`NOT EXECUTED: ${k.name} has no room for a discount within margin. Suggest other levers instead.`);
      if (a.discount_pct > MAX_DISCOUNT_PCT)
        throw new ToolError(
          `NOT EXECUTED: ${a.discount_pct}% is above the 30% cap. Maximum allowed for ${k.name} is ${maxPct}%, a price of ${priceAt(maxPct)} rupees.`,
        );
      if (k.price * (1 - a.discount_pct / 100) < k.cost * MIN_MARGIN)
        throw new ToolError(
          `NOT EXECUTED: ${a.discount_pct}% would take ${k.name} below cost plus 5% margin. Maximum allowed is ${maxPct}%, a price of ${priceAt(maxPct)} rupees.`,
        );
      if (a.start === "now" && k.stock === 0)
        throw new ToolError(`NOT EXECUTED: ${k.name} is out of stock. Use start "after_restock" instead.`);
      requireConfirmation(a.seller_confirmed);

      db.deals = db.deals.filter((d) => !(d.sellerId === s.id && d.sku === k.sku));
      db.deals.push({
        id: newId("deal"),
        sellerId: s.id,
        sku: k.sku,
        discountPct: a.discount_pct,
        days: a.days,
        startsWhen: a.start,
      });
      const newPrice = priceAt(a.discount_pct);
      addAction(db, ctx, {
        sellerId: s.id,
        type: "create_deal",
        title: `${a.discount_pct}% off ${k.name} for ${a.days} days`,
        detail: `${k.price} to ${newPrice} rupees, starts ${a.start === "now" ? "now" : "after restock"}`,
        payload: { sku: k.sku, discount_pct: a.discount_pct, days: a.days, start: a.start },
        owner: "KAM",
        status: "executed",
        dueDays: 0,
      });
      const comp = k.competitorPrice
        ? ` Competitor is at ${k.competitorPrice}, so you are ${newPrice <= k.competitorPrice ? "now at or below them" : `still ${newPrice - k.competitorPrice} rupees above`}.`
        : "";
      return {
        message: `Done. ${a.discount_pct}% off ${k.name} for ${a.days} days, starting ${a.start === "now" ? "now" : "once it is back in stock"}: price ${k.price} to ${newPrice} rupees.${comp}`,
        ui: { kind: "deal", skus: [k.sku] },
      };
    },
  }),

  update_dispatch_sla: def({
    kind: "write",
    schema: z.object({
      seller_id: sellerId,
      target_hours: int(24, 72, "hours"),
      seller_confirmed: confirmed,
    }),
    run(db, a, ctx) {
      const s = getSeller(db, a.seller_id);
      requireConfirmation(a.seller_confirmed);
      const before = getMetrics(db, s.id, "this")!.avgDispatchDays;
      s.dispatchSlaHours = a.target_hours;
      addAction(db, ctx, {
        sellerId: s.id,
        type: "update_dispatch_sla",
        title: `Dispatch within ${a.target_hours} hours`,
        detail: `Current average ${before} days`,
        payload: { target_hours: a.target_hours },
        owner: "Seller",
        status: "executed",
        dueDays: 1,
      });
      return {
        message: `Done. Dispatch commitment set to ${a.target_hours} hours, against a current average of ${before} days. The seller needs to hit it from tomorrow.`,
        ui: { kind: "action" },
      };
    },
  }),

  schedule_followup: def({
    kind: "write",
    schema: z.object({
      seller_id: sellerId,
      in_days: int(1, 30, "days"),
      targets: textList.pipe(z.array(z.string()).min(1, "give at least one target")),
    }),
    run(db, a, ctx) {
      const s = getSeller(db, a.seller_id);
      db.followUps.forEach((f) => {
        if (f.sellerId === s.id && f.status === "scheduled") f.status = "done";
      });
      db.followUps.push({
        id: newId("fu"),
        sellerId: s.id,
        dueInDays: a.in_days,
        targets: a.targets,
        status: "scheduled",
        createdAt: iso(ctx.now ?? new Date()),
      });
      return {
        message: `Follow-up call scheduled in ${a.in_days} days to check: ${a.targets.join("; ")}.`,
        ui: { kind: "followup" },
      };
    },
  }),

  escalate_to_human_kam: def({
    kind: "write",
    schema: z.object({ seller_id: sellerId, reason: z.string().trim().min(3) }),
    run(db, a, ctx) {
      const s = getSeller(db, a.seller_id);
      db.escalations.push({
        id: newId("esc"),
        sellerId: s.id,
        reason: a.reason,
        createdAt: iso(ctx.now ?? new Date()),
        status: "open",
      });
      addAction(db, ctx, {
        sellerId: s.id,
        type: "escalate_to_human_kam",
        title: "Human KAM to call back",
        detail: a.reason,
        payload: { reason: a.reason },
        owner: "KAM",
        status: "proposed",
        dueDays: 1,
      });
      return {
        message: "Escalated. Tell the seller a human account manager will call them within 24 hours.",
        ui: { kind: "escalation" },
      };
    },
  }),

  save_call_summary: def({
    kind: "write",
    schema: z.object({
      seller_id: sellerId,
      key_issues: textList,
      actions_agreed: textList,
      next_steps: textList,
      follow_up: z.string().trim().optional().default(""),
    }),
    run(db, a, ctx) {
      const s = getSeller(db, a.seller_id);
      const id = ctx.callId ?? newId("call");
      const summary =
        `${a.key_issues.join("; ") || "General check-in"}.` +
        (a.actions_agreed.length ? ` Agreed: ${a.actions_agreed.join("; ")}.` : "") +
        (a.follow_up ? ` Follow-up ${a.follow_up}.` : "");
      const log: CallLog = {
        id,
        sellerId: s.id,
        startedAt: iso(ctx.now ?? new Date()),
        reason: ctx.callReason ?? "inbound",
        summary,
        keyIssues: a.key_issues,
        actionsAgreed: a.actions_agreed,
        nextSteps: a.next_steps,
        followUp: a.follow_up || undefined,
        transcript: ctx.transcript ?? [],
      };
      // The agent may save twice in one call; keep the latest.
      db.callLogs = db.callLogs.filter((c) => c.id !== id);
      db.callLogs.push(log);
      return {
        message: "Call summary saved. Now summarise for the seller in 2 to 3 sentences, say goodbye and end the call.",
        ui: { kind: "summary" },
      };
    },
  }),
};

export const TOOL_NAMES = Object.keys(TOOLS);
export const isReadTool = (name: string) => TOOLS[name]?.kind === "read";

// ---------------------------------------------------------------- entry point

export function executeTool(db: DB, name: string, rawArgs: unknown, ctx: ToolContext = {}): ToolOutcome {
  const tool = TOOLS[name];
  if (!tool)
    return {
      db,
      changed: false,
      response: { ok: false, message: `Unknown tool "${name}".`, ui: { kind: "error" } },
    };

  const parsed = tool.schema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const why = parsed.error.issues.map((i) => `${i.path.join(".") || "args"} ${i.message}`).join("; ");
    return {
      db,
      changed: false,
      response: { ok: false, message: `NOT EXECUTED: invalid arguments: ${why}.`, ui: { kind: "error" } },
    };
  }

  const next: DB = structuredClone(db);
  try {
    const out = tool.run(next, parsed.data, ctx);
    return { db: next, changed: tool.kind === "write", response: { ok: true, ...out } };
  } catch (e) {
    if (e instanceof ToolError)
      return { db, changed: false, response: { ok: false, message: e.message, ui: { kind: "error" } } };
    throw e;
  }
}
