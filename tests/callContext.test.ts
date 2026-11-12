import { describe, expect, it } from "vitest";
import seedJson from "@/data/seed.json";
import { healthCheck, simulateWeek } from "@/lib/analytics";
import { followupContext, proactiveContext } from "@/lib/callContext";
import type { DB } from "@/lib/types";

const fresh = (): DB => JSON.parse(JSON.stringify(seedJson));

describe("call openers", () => {
  it("follow-up opener reports the real week-on-week change", () => {
    const db = fresh();
    db.skus.filter((s) => s.sellerId === "S1" && s.stock === 0).forEach((s) => (s.status = "unavailable"));
    db.actions.push({
      id: "a1", sellerId: "S1", type: "create_restock_plan", title: "", detail: "",
      payload: { skus: ["HK-112", "HK-087", "HK-145", "HK-063"] }, status: "proposed", owner: "Seller",
      due: "", createdAt: "",
    });
    const before = db.metrics.find((m) => m.sellerId === "S1" && m.month === "this")!;
    const { week } = simulateWeek(db, "S1");
    const line = followupContext(before, week);
    expect(line).toMatch(new RegExp(`tracking at ${week.orders} a month, up from 270, and cancellations are down to ${week.cancelRate} percent`));
    expect(line).not.toMatch(/[₹%]/);
  });

  it("follow-up opener is honest when nothing improved", () => {
    const db = fresh();
    const before = db.metrics.find((m) => m.sellerId === "S1" && m.month === "this")!;
    const { week } = simulateWeek(db, "S1");
    expect(followupContext(before, week)).toMatch(/flat at 270 a month, with cancellations at 14(\.\d)? percent/);
  });

  it("proactive opener names the anomaly", () => {
    expect(proactiveContext(healthCheck(fresh(), "S1"))).toMatch(/^I'm calling because 4 of your bestsellers are out of stock/);
  });
});
