import { describe, expect, it } from "vitest";
import seedJson from "@/data/seed.json";
import { diagnose, healthCheck, simulateWeek } from "@/lib/analytics";
import type { Action, DB } from "@/lib/types";

const fresh = (): DB => JSON.parse(JSON.stringify(seedJson));

const action = (sellerId: string, type: Action["type"], payload: Record<string, unknown>): Action => ({
  id: `a-${type}`,
  sellerId,
  type,
  title: type,
  detail: "",
  payload,
  status: "executed",
  owner: "KAM",
  due: "2026-01-01",
  createdAt: "2026-01-01",
});

describe("S1 diagnosis reconciles with the brief", () => {
  const d = diagnose(fresh(), "S1");
  const cause = (k: string) => d.causes.find((c) => c.key === k)!;

  it("headline numbers", () => {
    expect(d.headline.salesDrop).toBe(65000);
    expect(d.headline.salesDropPct).toBe(32.5);
    expect(d.headline.orderDrop).toBe(130);
    expect(d.headline.aspChangePct).toBe(0);
    expect(d.headline.volumeEffectRupees).toBe(65000); // flat ASP -> 100% volume
    expect(d.headline.priceEffectRupees).toBe(0);
  });

  it("realised revenue after cancellations", () => {
    expect(d.headline.realisedRevenueLast).toBe(184000);
    expect(d.headline.realisedRevenueThis).toBe(116100);
    expect(d.headline.realisedRevenueDropPct).toBe(36.9);
  });

  it("stock-outs are the top cause: ~97 orders, ~₹48,500, ~75% of the drop", () => {
    expect(d.causes[0].key).toBe("stockouts");
    const s = cause("stockouts");
    expect(s.impactOrders).toBe(97);
    expect(s.impactRupees).toBe(48500);
    expect(Math.round(s.shareOfDropPct)).toBe(75);
    expect(s.confidence).toBe("high");
  });

  it("the top 4 out-of-stock SKUs account for 88 orders", () => {
    const s = cause("stockouts");
    expect(s.skus!.map((x) => x.sku)).toEqual(["HK-112", "HK-087", "HK-145", "HK-063"]);
    expect(s.skus!.reduce((a, x) => a + x.orders, 0)).toBe(88);
  });

  it("~16 excess cancellations and ~33 unexplained orders", () => {
    expect(cause("cancellations").impactOrders).toBe(16);
    expect(d.unexplainedOrders).toBe(33);
    expect(cause("visibility").impactOrders).toBe(33);
  });

  it("does not flag pricing or dispatch", () => {
    expect(d.causes.find((c) => c.key === "pricing")).toBeUndefined();
    expect(d.causes.find((c) => c.key === "dispatch")).toBeUndefined();
  });

  it("every cause carries questions only the seller can answer", () => {
    for (const c of d.causes) expect(c.unknowns.length).toBeGreaterThan(0);
  });
});

describe("S2 is a pricing problem", () => {
  const d = diagnose(fresh(), "S2");
  it("ranks pricing first, not stock", () => {
    expect(d.causes[0].key).toBe("pricing");
    expect(d.causes.find((c) => c.key === "stockouts")).toBeUndefined();
    expect(d.headline.aspChangePct).toBeCloseTo(17.9, 1);
    expect(d.causes[0].impactOrders).toBe(95);
  });
  it("names the 3 undercut kurtis", () => {
    expect(d.causes[0].skus!.map((s) => s.sku)).toEqual(["PE-201", "PE-118", "PE-305"]);
  });
  it("splits the drop into volume and price effects", () => {
    expect(d.headline.volumeEffectRupees).toBe(110 * 700);
    expect(d.headline.priceEffectRupees).toBe(190 * 125);
    expect(d.headline.volumeEffectRupees - d.headline.priceEffectRupees).toBe(d.headline.salesDrop);
  });
});

describe("S3 is a dispatch problem", () => {
  const d = diagnose(fresh(), "S3");
  it("ranks dispatch first", () => {
    expect(d.causes[0].key).toBe("dispatch");
    expect(d.causes[0].impactOrders).toBe(100);
    expect(d.causes.find((c) => c.key === "stockouts")).toBeUndefined();
    expect(d.causes.find((c) => c.key === "pricing")).toBeUndefined();
  });
  it("cancellations are flagged with delivery delay as the top reason", () => {
    const c = d.causes.find((x) => x.key === "cancellations")!;
    expect(c.impactOrders).toBe(30);
    expect(c.evidence[1]).toMatch(/delivery delay 38/);
  });
});

describe("simulateWeek", () => {
  it("with no actions, nothing improves", () => {
    const { week } = simulateWeek(fresh(), "S1");
    expect(week.orders).toBe(270);
    expect(week.oosCount).toBe(18);
    expect(week.cancelReasons.seller_no_stock).toBe(26);
  });

  it("restock + unavailable listings fix S1's stock problem", () => {
    const db = fresh();
    const top4 = ["HK-112", "HK-087", "HK-145", "HK-063"];
    const tail = db.skus.filter((s) => s.sellerId === "S1" && s.stock === 0 && s.status === "live" && !top4.includes(s.sku));
    tail.forEach((s) => (s.status = "unavailable"));
    db.actions.push(action("S1", "create_restock_plan", { skus: top4 }));
    const { db: next, week } = simulateWeek(db, "S1");
    expect(week.oosCount).toBe(14);
    expect(week.cancelReasons.seller_no_stock).toBe(0);
    expect(week.orders).toBeGreaterThan(270);
    expect(week.cancelRate).toBeLessThan(14);
    expect(week.adsActive).toBe(true);
    expect(next.skus.find((s) => s.sku === "HK-112")!.status).toBe("live");
    expect(next.metrics.filter((m) => m.sellerId === "S1" && m.month === "week+1")).toHaveLength(1);
  });

  it("dispatch SLA cuts S3's delay cancellations", () => {
    const db = fresh();
    db.sellers.find((s) => s.id === "S3")!.dispatchSlaHours = 24;
    const { week } = simulateWeek(db, "S3");
    expect(week.avgDispatchDays).toBe(1);
    expect(week.cancelReasons.delivery_delay).toBe(13);
    expect(week.orders).toBeGreaterThan(380);
  });

  it("a deal lifts orders on that SKU", () => {
    const db = fresh();
    db.deals.push({ id: "d1", sellerId: "S2", sku: "PE-201", discountPct: 21, days: 7, startsWhen: "now" });
    const { week } = simulateWeek(db, "S2");
    expect(week.orders).toBeGreaterThan(190);
    expect(week.asp).toBeLessThan(825);
  });
});

describe("healthCheck", () => {
  it("S1: flags bestsellers out of stock first, with a call reason", () => {
    const h = healthCheck(fresh(), "S1");
    expect(h.anomalies[0].key).toBe("top_sellers_oos");
    expect(h.anomalies[0].skus).toEqual(expect.arrayContaining(["HK-112", "HK-087", "HK-145", "HK-063"]));
    expect(h.anomalies.some((a) => a.key === "low_stock")).toBe(true);
    expect(h.callContext).toMatch(/4 of your bestsellers/);
  });
  it("S3: flags slow dispatch", () => {
    expect(healthCheck(fresh(), "S3").anomalies.some((a) => a.key === "slow_dispatch")).toBe(true);
  });
  it("S2: flags pricing above competitors", () => {
    expect(healthCheck(fresh(), "S2").anomalies.some((a) => a.key === "priced_above_competitor")).toBe(true);
  });
});
