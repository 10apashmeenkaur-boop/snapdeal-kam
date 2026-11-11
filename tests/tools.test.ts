import { describe, expect, it } from "vitest";
import seedJson from "@/data/seed.json";
import { simulateWeek } from "@/lib/analytics";
import { executeTool, NOT_CONFIRMED, TOOL_NAMES } from "@/lib/tools";
import toolsJson from "@/agent/tools.json";
import type { DB } from "@/lib/types";

const fresh = (): DB => JSON.parse(JSON.stringify(seedJson));
const NOW = new Date("2026-11-12T10:00:00Z");
const run = (db: DB, name: string, args: unknown) => executeTool(db, name, args, { now: NOW, callId: "call_test" });

describe("tool registry", () => {
  it("matches agent/tools.json exactly (names and required params)", () => {
    const cfg = toolsJson.tools;
    expect(cfg.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    for (const t of cfg) {
      for (const p of t.parameters.required) expect(Object.keys(t.parameters.properties)).toContain(p);
    }
  });

  it("unknown tool and unknown seller are rejected", () => {
    expect(run(fresh(), "delete_everything", {}).response.ok).toBe(false);
    const r = run(fresh(), "get_diagnosis", { seller_id: "S9" });
    expect(r.response.ok).toBe(false);
    expect(r.response.message).toMatch(/Unknown seller_id/);
  });
});

describe("read tools", () => {
  it("get_diagnosis speaks the S1 numbers without symbols", () => {
    const m = run(fresh(), "get_diagnosis", { seller_id: "s1" }).response.message;
    expect(m).toMatch(/65,000 rupees \(32.5%\)/);
    expect(m).toMatch(/stock-outs \(high confidence\): 97 orders, 48,500 rupees, 75%/);
    expect(m).toMatch(/Steel water bottle 1L HK-112 \(30 orders\)/);
    expect(m).toMatch(/Ask the seller/);
    expect(m).not.toMatch(/₹/);
  });

  it("get_seller_snapshot uses lakh formatting", () => {
    const m = run(fresh(), "get_seller_snapshot", { seller_id: "S1" }).response.message;
    expect(m).toMatch(/2 lakh rupees last month, 1.35 lakh rupees this month \(down 32.5%\)/);
  });

  it("get_sku_details filters and caps at 5", () => {
    const r = run(fresh(), "get_sku_details", { seller_id: "S1", filter: "out_of_stock" }).response;
    expect(r.message.startsWith("HK-112")).toBe(true);
    expect(r.ui.skus).toHaveLength(5);
    expect(r.message).toMatch(/more not shown/);
  });

  it("get_cancellation_breakdown compares with last month", () => {
    const m = run(fresh(), "get_cancellation_breakdown", { seller_id: "S1" }).response.message;
    expect(m).toMatch(/38 cancellations, 14%/);
    expect(m).toMatch(/seller no stock 26 \(was 6\)/);
  });

  it("get_account_history on a fresh seller says first call", () => {
    expect(run(fresh(), "get_account_history", { seller_id: "S1" }).response.message).toMatch(/first conversation/);
  });

  it("read tools never mark the db as changed", () => {
    expect(run(fresh(), "get_diagnosis", { seller_id: "S1" }).changed).toBe(false);
  });
});

describe("confirmation guard (enforced in code)", () => {
  const writes: [string, Record<string, unknown>][] = [
    ["mark_listings_unavailable", { seller_id: "S1", skus: ["HK-112"] }],
    ["set_low_stock_alert", { seller_id: "S1", skus: ["HK-016"], threshold_days: 7 }],
    ["create_restock_plan", { seller_id: "S1", skus: ["HK-112"] }],
    ["create_deal", { seller_id: "S2", sku: "PE-201", discount_pct: 15, days: 7, start: "now" }],
    ["update_dispatch_sla", { seller_id: "S3", target_hours: 24 }],
  ];
  for (const [name, args] of writes) {
    it(`${name} refuses without seller_confirmed=true`, () => {
      for (const c of [undefined, false, "false", "yes"]) {
        const out = run(fresh(), name, { ...args, seller_confirmed: c });
        expect(out.response.message).toBe(NOT_CONFIRMED);
        expect(out.changed).toBe(false);
      }
    });
    it(`${name} executes with seller_confirmed=true`, () => {
      const out = run(fresh(), name, { ...args, seller_confirmed: true });
      expect(out.response.ok).toBe(true);
      expect(out.response.message).toMatch(/^Done\./);
      expect(out.changed).toBe(true);
    });
  }
});

describe("write tools", () => {
  it("mark_listings_unavailable only touches out-of-stock listings, accepts names and comma strings", () => {
    const db = fresh();
    const out = run(db, "mark_listings_unavailable", {
      seller_id: "S1",
      skus: "hk112, Non-stick tawa 28cm, HK-010",
      seller_confirmed: true,
    });
    expect(out.response.ok).toBe(true);
    expect(out.response.ui.skus).toEqual(["HK-112", "HK-087"]);
    expect(out.response.message).toMatch(/Skipped/);
    expect(out.db.skus.find((s) => s.sku === "HK-112")!.status).toBe("unavailable");
    expect(out.db.skus.find((s) => s.sku === "HK-010")!.status).toBe("live");
    expect(db.skus.find((s) => s.sku === "HK-112")!.status).toBe("live"); // input untouched
    expect(out.db.actions[0]).toMatchObject({ owner: "KAM", status: "executed", callId: "call_test" });
  });

  it("rejects SKUs from another seller", () => {
    const out = run(fresh(), "create_restock_plan", { seller_id: "S1", skus: ["PE-201"], seller_confirmed: true });
    expect(out.response.ok).toBe(false);
    expect(out.response.message).toMatch(/not found for this seller/);
  });

  it("set_low_stock_alert enforces 3 to 30 days", () => {
    for (const d of [2, 31]) {
      const out = run(fresh(), "set_low_stock_alert", { seller_id: "S1", skus: ["HK-016"], threshold_days: d, seller_confirmed: true });
      expect(out.response.message).toMatch(/between 3 and 30 days/);
    }
  });

  it("create_restock_plan is seller-owned, due in 3 days, prioritised by lost orders", () => {
    const out = run(fresh(), "create_restock_plan", {
      seller_id: "S1",
      skus: ["HK-063", "HK-112", "HK-145", "HK-087"],
      seller_confirmed: true,
    });
    const a = out.db.actions[0];
    expect(a).toMatchObject({ owner: "Seller", status: "proposed" });
    expect(a.due).toMatch(/^2026-11-15/);
    expect(a.payload.skus).toEqual(["HK-112", "HK-087", "HK-145", "HK-063"]);
    expect(out.response.message).toMatch(/88 orders a month/);
  });

  it("create_deal rejects 40% and returns the max allowed", () => {
    const out = run(fresh(), "create_deal", { seller_id: "S2", sku: "PE-201", discount_pct: 40, days: 7, start: "now", seller_confirmed: true });
    expect(out.response.ok).toBe(false);
    expect(out.response.message).toMatch(/above the 30% cap. Maximum allowed for Cotton Anarkali kurti is 30%/);
    expect(out.db.deals).toHaveLength(0);
  });

  it("create_deal enforces cost × 1.05 margin (Chikankari max is 19%)", () => {
    const out = run(fresh(), "create_deal", { seller_id: "S2", sku: "PE-305", discount_pct: 25, days: 7, start: "now", seller_confirmed: true });
    expect(out.response.message).toMatch(/below cost plus 5% margin. Maximum allowed is 19%/);
    const ok = run(fresh(), "create_deal", { seller_id: "S2", sku: "PE-305", discount_pct: 19, days: 7, start: "now", seller_confirmed: true });
    expect(ok.response.ok).toBe(true);
  });

  it("create_deal reports the guardrail before asking for confirmation", () => {
    const out = run(fresh(), "create_deal", { seller_id: "S2", sku: "PE-201", discount_pct: 40, days: 7, start: "now", seller_confirmed: false });
    expect(out.response.message).toMatch(/Maximum allowed/);
  });

  it("create_deal on an out-of-stock SKU must start after restock", () => {
    const base = { seller_id: "S1", sku: "HK-112", discount_pct: 10, days: 7, seller_confirmed: true };
    expect(run(fresh(), "create_deal", { ...base, start: "now" }).response.message).toMatch(/after_restock/);
    expect(run(fresh(), "create_deal", { ...base, start: "after_restock" }).response.ok).toBe(true);
  });

  it("create_deal compares with the competitor price", () => {
    const out = run(fresh(), "create_deal", { seller_id: "S2", sku: "PE-201", discount_pct: 22, days: 7, start: "now", seller_confirmed: true });
    expect(out.response.message).toMatch(/949 to 740 rupees. Competitor is at 749, so you are now at or below them/);
  });

  it("update_dispatch_sla enforces 24 to 72 hours", () => {
    expect(run(fresh(), "update_dispatch_sla", { seller_id: "S3", target_hours: 12, seller_confirmed: true }).response.message).toMatch(/between 24 and 72 hours/);
    const out = run(fresh(), "update_dispatch_sla", { seller_id: "S3", target_hours: "48", seller_confirmed: "true" });
    expect(out.response.ok).toBe(true);
    expect(out.db.sellers.find((s) => s.id === "S3")!.dispatchSlaHours).toBe(48);
  });

  it("schedule_followup and escalate need no confirmation", () => {
    const f = run(fresh(), "schedule_followup", { seller_id: "S1", in_days: 7, targets: ["cancellation rate below 9%"] });
    expect(f.response.ok).toBe(true);
    expect(f.db.followUps[0]).toMatchObject({ dueInDays: 7, status: "scheduled" });
    const e = run(fresh(), "escalate_to_human_kam", { seller_id: "S1", reason: "Seller wants compensation" });
    expect(e.response.message).toMatch(/within 24 hours/);
    expect(e.db.escalations).toHaveLength(1);
  });

  it("save_call_summary writes one call log per call id", () => {
    let db = fresh();
    const args = { seller_id: "S1", key_issues: ["Stock-outs on 4 bestsellers"], actions_agreed: "Restock plan", next_steps: ["Seller restocks in 3 days"], follow_up: "in 7 days" };
    db = run(db, "save_call_summary", args).db;
    db = run(db, "save_call_summary", args).db;
    expect(db.callLogs).toHaveLength(1);
    expect(db.callLogs[0].actionsAgreed).toEqual(["Restock plan"]);
  });
});

describe("end to end: S1 call, then a simulated week, then follow-up history", () => {
  it("history shows agreed actions and the improvement", () => {
    let db = fresh();
    const top4 = ["HK-112", "HK-087", "HK-145", "HK-063"];
    const oos = db.skus.filter((s) => s.sellerId === "S1" && s.stock === 0 && s.status === "live").map((s) => s.sku);
    db = run(db, "mark_listings_unavailable", { seller_id: "S1", skus: oos, seller_confirmed: true }).db;
    db = run(db, "create_restock_plan", { seller_id: "S1", skus: top4, seller_confirmed: true }).db;
    db = run(db, "schedule_followup", { seller_id: "S1", in_days: 7, targets: ["4 bestsellers back in stock", "cancellations under 9%"] }).db;
    db = run(db, "save_call_summary", { seller_id: "S1", key_issues: ["Stock-outs"], actions_agreed: ["Paused listings", "Restock plan"], next_steps: ["Restock"], follow_up: "in 7 days" }).db;

    const { db: after, week } = simulateWeek(db, "S1");
    expect(week.cancelReasons.seller_no_stock).toBe(0);
    expect(week.oosCount).toBe(14);

    const h = run(after, "get_account_history", { seller_id: "S1" }).response.message;
    expect(h).toMatch(/Last call/);
    expect(h).toMatch(/Restock 4 products \(about 88 orders a month\) \(owner Seller, executed\)/);
    expect(h).toMatch(/Follow-up targets: 4 bestsellers back in stock/);
    expect(h).toMatch(/orders 270 to \d+/);
  });
});
