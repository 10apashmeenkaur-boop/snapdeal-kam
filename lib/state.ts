// Everything the dashboard needs about one seller, in one payload.

import { diagnose, getMetrics, healthCheck, sellerSkus } from "./analytics";
import type { DB } from "./types";

export function sellerState(db: DB, sellerId: string) {
  const seller = db.sellers.find((s) => s.id === sellerId);
  if (!seller) return null;
  const mine = <T extends { sellerId: string }>(xs: T[]) => xs.filter((x) => x.sellerId === sellerId);
  return {
    seller,
    sellers: db.sellers.map((s) => ({ id: s.id, name: s.name, store: s.store })),
    metrics: {
      last: getMetrics(db, sellerId, "last")!,
      this: getMetrics(db, sellerId, "this")!,
      week: getMetrics(db, sellerId, "week+1") ?? null,
    },
    skus: sellerSkus(db, sellerId),
    diagnosis: diagnose(db, sellerId),
    health: healthCheck(db, sellerId),
    actions: mine(db.actions),
    alerts: mine(db.alerts),
    deals: mine(db.deals),
    followUps: mine(db.followUps),
    escalations: mine(db.escalations),
    callLogs: mine(db.callLogs).sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
  };
}

export type SellerState = NonNullable<ReturnType<typeof sellerState>>;
