// Deterministic analytics engine. All maths for the agent lives here, so the
// LLM only ever repeats numbers it was given and can't invent figures.
// Every function is pure: it takes a DB snapshot and returns plain data.

import type {
  Anomaly,
  Cause,
  DB,
  Diagnosis,
  HealthCheck,
  MonthKey,
  MonthMetrics,
  SellerId,
  Sku,
} from "./types";

export const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (part: number, whole: number) => (whole === 0 ? 0 : round1((part / whole) * 100));

export function getMetrics(db: DB, sellerId: SellerId, month: MonthKey): MonthMetrics | undefined {
  return db.metrics.find((m) => m.sellerId === sellerId && m.month === month);
}

export function sellerSkus(db: DB, sellerId: SellerId): Sku[] {
  return db.skus.filter((s) => s.sellerId === sellerId);
}

function mustMetrics(db: DB, sellerId: SellerId, month: MonthKey): MonthMetrics {
  const m = getMetrics(db, sellerId, month);
  if (!m) throw new Error(`No ${month} metrics for seller ${sellerId}`);
  return m;
}

/** Revenue actually kept after cancellations: orders × (1 − cancel rate) × ASP. */
export function realisedRevenue(m: MonthMetrics): number {
  return Math.round(m.orders * (1 - m.cancelRate / 100) * m.asp);
}

/** The seller's top N SKUs by last-month orders. */
function topSkuIds(skus: Sku[], n = 10): Set<string> {
  return new Set(
    [...skus]
      .filter((s) => s.ordersLast > 0)
      .sort((a, b) => b.ordersLast - a.ordersLast)
      .slice(0, n)
      .map((s) => s.sku),
  );
}

const isNewlyOos = (s: Sku) => s.stock === 0 && !s.oosLastMonth;
const priceUpPct = (s: Sku) => (s.priceLast ? ((s.price - s.priceLast) / s.priceLast) * 100 : 0);
const competitorGapPct = (s: Sku) =>
  s.competitorPrice ? ((s.price - s.competitorPrice) / s.competitorPrice) * 100 : 0;
const isPricingSku = (s: Sku) => priceUpPct(s) > 10 || competitorGapPct(s) > 5;
const isSlowSku = (s: Sku) => s.dispatchDaysLast > 0 && s.dispatchDays > s.dispatchDaysLast * 1.5;

const UNKNOWNS: Record<Cause["key"], string[]> = {
  stockouts: [
    "Why did these products run out: supplier delay, cash flow, or a demand spike?",
    "When can you restock the bestsellers?",
  ],
  pricing: [
    "Why did you raise prices: did your costs go up?",
    "What is the lowest price or margin you can accept on your top kurtis?",
  ],
  dispatch: [
    "What changed in packing or dispatch: staff, courier pickup, or the warehouse?",
    "How many hours do you realistically need to dispatch an order?",
  ],
  cancellations: ["Are you accepting orders before confirming stock is in hand?"],
  visibility: ["Did you change anything in ads, listings or images this month?"],
};

export function diagnose(db: DB, sellerId: SellerId): Diagnosis {
  const last = mustMetrics(db, sellerId, "last");
  const now = mustMetrics(db, sellerId, "this");
  const skus = sellerSkus(db, sellerId);

  const orderDrop = last.orders - now.orders;
  const salesDrop = last.sales - now.sales;
  const realisedLast = realisedRevenue(last);
  const realisedNow = realisedRevenue(now);
  const realisedDrop = realisedLast - realisedNow;

  const headline: Diagnosis["headline"] = {
    salesLast: last.sales,
    salesThis: now.sales,
    salesDrop,
    salesDropPct: pct(salesDrop, last.sales),
    ordersLast: last.orders,
    ordersThis: now.orders,
    orderDrop,
    aspChangePct: pct(now.asp - last.asp, last.asp),
    // Volume vs price split. If ASP is flat, 100% of the drop is volume.
    volumeEffectRupees: orderDrop * last.asp,
    priceEffectRupees: now.orders * (now.asp - last.asp),
    realisedRevenueLast: realisedLast,
    realisedRevenueThis: realisedNow,
    realisedRevenueDropPct: pct(realisedDrop, realisedLast),
  };

  const causes: Cause[] = [];
  const attributed = new Set<string>(); // each SKU's drop is counted once
  let explainedOrders = 0;
  const top = topSkuIds(skus);

  // 1) Stock-outs: lost orders = last-month orders of SKUs newly out of stock.
  //    (Any orders those SKUs still received this month were cancelled.)
  const oos = skus.filter(isNewlyOos);
  if (oos.length > 0) {
    const lost = oos.reduce((a, s) => a + s.ordersLast, 0);
    const topOos = oos.filter((s) => top.has(s.sku)).sort((a, b) => b.ordersLast - a.ordersLast);
    const topLost = topOos.reduce((a, s) => a + s.ordersLast, 0);
    const liveZero = oos.filter((s) => s.status === "live").length;
    const noStockCancels = now.cancelReasons.seller_no_stock ?? 0;
    const evidence = [
      `${oos.length} products newly out of stock; they had ${lost} orders last month`,
    ];
    if (topOos.length)
      evidence.push(
        `${topOos.length} of them were top sellers (${topOos.map((s) => s.sku).join(", ")}) worth ${topLost} orders a month`,
      );
    if (noStockCancels)
      evidence.push(`${noStockCancels} orders cancelled this month because of no stock`);
    if (liveZero) evidence.push(`${liveZero} out-of-stock listings are still live and taking orders`);
    if (last.adsActive && !now.adsActive)
      evidence.push("Sponsored ads auto-paused when their products went out of stock");

    oos.forEach((s) => attributed.add(s.sku));
    explainedOrders += lost;
    const share = pct(lost, orderDrop);
    causes.push({
      key: "stockouts",
      confidence: share >= 40 ? "high" : share >= 15 ? "med" : "low",
      impactOrders: lost,
      impactRupees: lost * last.asp,
      shareOfDropPct: share,
      evidence,
      unknowns: UNKNOWNS.stockouts,
      skus: (topOos.length ? topOos : oos).slice(0, 5).map((s) => ({
        sku: s.sku,
        name: s.name,
        orders: s.ordersLast,
      })),
    });
  }

  // 2) Pricing: flag when ASP is up >10% and orders are down.
  if (headline.aspChangePct > 10 && orderDrop > 0) {
    const hit = skus.filter((s) => !attributed.has(s.sku) && isPricingSku(s));
    const lost = hit.reduce((a, s) => a + Math.max(0, s.ordersLast - s.ordersThis), 0);
    if (lost > 0) {
      const undercut = hit
        .filter((s) => competitorGapPct(s) > 5 && s.competitorPrice! < s.priceLast)
        .sort((a, b) => b.ordersLast - a.ordersLast);
      const evidence = [
        `Average selling price up ${headline.aspChangePct}% (₹${last.asp} to ₹${now.asp}) while orders fell ${pct(orderDrop, last.orders)}%`,
        `${hit.length} products had price rises over 10% or sit above competitor prices`,
      ];
      undercut.slice(0, 3).forEach((s) =>
        evidence.push(
          `${s.sku} ${s.name}: you ₹${s.price}, competitor ₹${s.competitorPrice} (${round1(competitorGapPct(s))}% higher); orders ${s.ordersLast} to ${s.ordersThis}`,
        ),
      );
      hit.forEach((s) => attributed.add(s.sku));
      explainedOrders += lost;
      const share = pct(lost, orderDrop);
      causes.push({
        key: "pricing",
        confidence: share >= 40 ? "high" : "med",
        impactOrders: lost,
        impactRupees: lost * last.asp,
        shareOfDropPct: share,
        evidence,
        unknowns: UNKNOWNS.pricing,
        skus: (undercut.length ? undercut : hit).slice(0, 5).map((s) => ({
          sku: s.sku,
          name: s.name,
          orders: s.ordersLast - s.ordersThis,
        })),
      });
    }
  }

  // 3) Dispatch: flag when dispatch days up >50% or delay cancellations rose.
  const delayLast = last.cancelReasons.delivery_delay ?? 0;
  const delayNow = now.cancelReasons.delivery_delay ?? 0;
  const dispatchUp = now.avgDispatchDays > last.avgDispatchDays * 1.5;
  const delayUp = delayNow >= 5 && delayNow > delayLast * 1.5;
  if (dispatchUp || delayUp) {
    const slow = skus.filter((s) => !attributed.has(s.sku) && isSlowSku(s));
    let lost = slow.reduce((a, s) => a + Math.max(0, s.ordersLast - s.ordersThis), 0);
    if (lost === 0) lost = Math.max(0, delayNow - delayLast); // fall back to excess delay cancels
    const evidence = [
      `Average dispatch time ${last.avgDispatchDays} to ${now.avgDispatchDays} days`,
      `"Delivery too slow" cancellations ${delayLast} to ${delayNow}`,
    ];
    if (now.rating < last.rating) evidence.push(`Store rating ${last.rating} to ${now.rating}`);
    if (slow.length) evidence.push(`${slow.length} products now take over 1.5x longer to dispatch`);
    slow.forEach((s) => attributed.add(s.sku));
    explainedOrders += lost;
    const share = pct(lost, orderDrop);
    causes.push({
      key: "dispatch",
      confidence: dispatchUp && share >= 40 ? "high" : "med",
      impactOrders: lost,
      impactRupees: lost * last.asp,
      shareOfDropPct: share,
      evidence,
      unknowns: UNKNOWNS.dispatch,
      skus: slow
        .sort((a, b) => b.ordersLast - b.ordersThis - (a.ordersLast - a.ordersThis))
        .slice(0, 5)
        .map((s) => ({ sku: s.sku, name: s.name, orders: s.ordersLast - s.ordersThis })),
    });
  }

  // 4) Cancellations: excess = orders × (rate now − rate last). This hits
  //    realised revenue rather than orders placed, so its share is measured
  //    against the realised-revenue drop.
  const rateUp = now.cancelRate - last.cancelRate;
  if (rateUp >= 2) {
    const excess = Math.round((now.orders * rateUp) / 100);
    const reasons = Object.entries(now.cancelReasons).sort((a, b) => b[1] - a[1]);
    const totalCancels = reasons.reduce((a, [, n]) => a + n, 0);
    causes.push({
      key: "cancellations",
      confidence: rateUp >= 5 ? "high" : "med",
      impactOrders: excess,
      impactRupees: excess * now.asp,
      shareOfDropPct: pct(excess * now.asp, realisedDrop),
      evidence: [
        `Cancellation rate ${last.cancelRate}% to ${now.cancelRate}%: about ${excess} extra cancelled orders`,
        `Top reasons: ${reasons
          .slice(0, 2)
          .map(([k, n]) => `${k.replace(/_/g, " ")} ${n} of ${totalCancels}`)
          .join(", ")}`,
        `Revenue kept after cancellations ₹${realisedLast} to ₹${realisedNow} (${headline.realisedRevenueDropPct}% down)`,
      ],
      unknowns: UNKNOWNS.cancellations,
    });
  }

  // 5) Residual: order drop not explained above goes to visibility/other.
  const unexplainedOrders = Math.max(0, orderDrop - explainedOrders);
  if (unexplainedOrders > 0) {
    const live = skus.filter((s) => !attributed.has(s.sku) && s.status === "live" && s.stock > 0);
    const rankSlip = live.length
      ? round1(live.reduce((a, s) => a + (s.searchRank - s.searchRankLast), 0) / live.length)
      : 0;
    const evidence = [`${unexplainedOrders} lost orders not explained by stock, price or dispatch`];
    if (rankSlip > 0) evidence.push(`In-stock products slipped about ${rankSlip} places in search on average`);
    if (last.adsActive && !now.adsActive) evidence.push("Sponsored ads were active last month and are paused now");
    if (rateUp >= 2) evidence.push("Higher cancellations usually lower search ranking");
    causes.push({
      key: "visibility",
      confidence: rankSlip > 3 || (last.adsActive && !now.adsActive) ? "med" : "low",
      impactOrders: unexplainedOrders,
      impactRupees: unexplainedOrders * last.asp,
      shareOfDropPct: pct(unexplainedOrders, orderDrop),
      evidence,
      unknowns: UNKNOWNS.visibility,
    });
  }

  causes.sort((a, b) => b.impactRupees - a.impactRupees);
  return { sellerId, headline, causes, unexplainedOrders };
}

// ---------------------------------------------------------------- simulate

/**
 * Applies the effects of executed actions and writes `week+1` metrics
 * (expressed as a monthly run-rate so they compare with last/this month).
 * Anything the seller didn't act on stays bad. Returns a new DB.
 */
export function simulateWeek(db: DB, sellerId: SellerId): { db: DB; week: MonthMetrics } {
  const base = mustMetrics(db, sellerId, "this");
  const seller = db.sellers.find((s) => s.id === sellerId);
  const executed = db.actions.filter((a) => a.sellerId === sellerId && a.status === "executed");
  const skusIn = (type: string) =>
    new Set(
      executed
        .filter((a) => a.type === type)
        .flatMap((a) => ((a.payload.skus as string[] | undefined) ?? [])),
    );
  const restocked = skusIn("create_restock_plan");
  const deals = db.deals.filter((d) => d.sellerId === sellerId);
  const slaDays = seller?.dispatchSlaHours ? seller.dispatchSlaHours / 24 : undefined;

  let orders = 0;
  let dealDiscountRupees = 0;
  let noStockCancels = 0;
  let restockedTop = false;
  const top = topSkuIds(sellerSkus(db, sellerId));

  const skus = db.skus.map((orig) => {
    if (orig.sellerId !== sellerId) return orig;
    const s = { ...orig };
    let o = s.ordersThis;

    if (s.stock === 0 && restocked.has(s.sku)) {
      // Seller followed the restock plan: listing back in stock, ranking recovering.
      s.stock = Math.max(10, Math.round(s.avgDailySales * 30));
      s.status = "live";
      s.oosSinceDays = undefined;
      o = Math.round(s.ordersLast * 0.75);
      s.searchRank = Math.round((s.searchRank + s.searchRankLast) / 2);
      if (top.has(s.sku)) restockedTop = true;
    } else if (s.stock === 0) {
      // Still out of stock. If still live, its orders keep getting cancelled.
      o = s.status === "unavailable" ? 0 : s.ordersThis;
      if (s.status === "live") noStockCancels += o;
    }

    const deal = deals.find((d) => d.sku === s.sku);
    if (deal && s.stock > 0 && (deal.startsWhen === "now" || restocked.has(s.sku))) {
      const before = o;
      o = Math.round(o * (1 + (deal.discountPct * 2) / 100)); // ~2% more orders per 1% off
      if (s.competitorPrice && s.price * (1 - deal.discountPct / 100) <= s.competitorPrice)
        o = Math.max(o, Math.round((before + s.ordersLast) / 2)); // matching competitor wins back more
      dealDiscountRupees += o * s.price * (deal.discountPct / 100);
    }

    if (slaDays && s.dispatchDays > slaDays) {
      s.dispatchDays = round1(slaDays);
      o += Math.round(Math.max(0, s.ordersLast - o) * 0.5); // faster delivery restores ranking
    }

    s.ordersThis = o; // becomes the latest observed run-rate
    orders += o;
    return s;
  });

  const scale = base.orders ? orders / base.orders : 1;
  const reasons: Record<string, number> = {};
  for (const [k, v] of Object.entries(base.cancelReasons)) {
    if (k === "seller_no_stock") reasons[k] = noStockCancels;
    else if (k === "delivery_delay" && slaDays) reasons[k] = Math.round(v * 0.35);
    else reasons[k] = Math.round(v * scale);
  }
  const cancels = Object.values(reasons).reduce((a, b) => a + b, 0);
  const asp = Math.round(base.asp - (orders ? dealDiscountRupees / orders : 0));
  const mine = skus.filter((s) => s.sellerId === sellerId);

  const week: MonthMetrics = {
    sellerId,
    month: "week+1",
    orders,
    asp,
    sales: orders * asp,
    cancelRate: orders ? round1((cancels / orders) * 100) : 0,
    oosCount: mine.filter((s) => s.stock === 0).length,
    cancelReasons: reasons,
    avgDispatchDays: slaDays ? Math.min(base.avgDispatchDays, round1(slaDays)) : base.avgDispatchDays,
    rating: slaDays && slaDays < base.avgDispatchDays ? round1(base.rating + 0.1) : base.rating,
    adsActive: base.adsActive || restockedTop,
  };

  const metrics = db.metrics.filter((m) => !(m.sellerId === sellerId && m.month === "week+1"));
  metrics.push(week);
  return { db: { ...db, skus, metrics }, week };
}

// ---------------------------------------------------------------- health

/** Scans current state for problems worth a proactive call. */
export function healthCheck(db: DB, sellerId: SellerId): HealthCheck {
  const now = getMetrics(db, sellerId, "week+1") ?? mustMetrics(db, sellerId, "this");
  const last = mustMetrics(db, sellerId, "last");
  const skus = sellerSkus(db, sellerId);
  const top = topSkuIds(skus);
  const anomalies: Anomaly[] = [];

  const topOos = skus.filter((s) => top.has(s.sku) && s.stock === 0);
  if (topOos.length) {
    const orders = topOos.reduce((a, s) => a + s.ordersLast, 0);
    const live = topOos.filter((s) => s.status === "live").length;
    anomalies.push({
      key: "top_sellers_oos",
      severity: "high",
      message: `${topOos.length} of your bestsellers are out of stock${live ? " and still live, so new orders get cancelled" : ""}; about ${orders} orders a month at risk`,
      skus: topOos.map((s) => s.sku),
    });
  }

  const low = skus.filter(
    (s) => s.status === "live" && s.stock > 0 && s.avgDailySales > 0 && s.stock / s.avgDailySales < 5,
  );
  if (low.length)
    anomalies.push({
      key: "low_stock",
      severity: "med",
      message: `${low.length} more products will run out within 5 days`,
      skus: low.map((s) => s.sku),
    });

  if (now.cancelRate >= 10)
    anomalies.push({
      key: "high_cancellations",
      severity: now.cancelRate >= 12 ? "high" : "med",
      message: `Cancellation rate is ${now.cancelRate}% (was ${last.cancelRate}%)`,
    });

  if (now.avgDispatchDays > last.avgDispatchDays * 1.5)
    anomalies.push({
      key: "slow_dispatch",
      severity: "high",
      message: `Orders now take ${now.avgDispatchDays} days to dispatch (was ${last.avgDispatchDays})`,
    });

  const undercut = skus.filter((s) => top.has(s.sku) && competitorGapPct(s) > 10);
  if (undercut.length)
    anomalies.push({
      key: "priced_above_competitor",
      severity: "high",
      message: `${undercut.length} top products are priced over 10% above competitors`,
      skus: undercut.map((s) => s.sku),
    });

  const rank = { high: 0, med: 1, low: 2 };
  anomalies.sort((a, b) => rank[a.severity] - rank[b.severity]);
  const first = anomalies[0];
  return {
    sellerId,
    anomalies,
    callContext: first
      ? `I'm calling because ${first.message.charAt(0).toLowerCase()}${first.message.slice(1)}. Do you have two minutes?`
      : null,
  };
}
