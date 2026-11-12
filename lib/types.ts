// Core data model for the Virtual KAM mock backend.
// Field names follow the take-home's data model; a few extra fields (marked "extra")
// carry the last-month values the analytics engine needs to explain a drop.

export type SellerId = string;
export type MonthKey = "last" | "this" | "week+1";

export interface Seller {
  id: SellerId;
  name: string;
  store: string;
  category: string;
  city: string;
  since: string; // year the seller joined
  phone_pref_lang: "en" | "hi";
  dispatchSlaHours?: number; // extra: set by update_dispatch_sla
}

export interface Sku {
  sku: string;
  sellerId: SellerId;
  name: string;
  price: number;
  cost: number;
  stock: number;
  avgDailySales: number; // demand estimate (units/day) when in stock
  status: "live" | "unavailable";
  searchRank: number;
  rating: number;
  dispatchDays: number;
  // extra
  priceLast: number;
  ordersLast: number;
  ordersThis: number;
  searchRankLast: number;
  dispatchDaysLast: number;
  oosLastMonth: boolean; // was already out of stock last month
  oosSinceDays?: number; // days since it went out of stock
  competitorPrice?: number; // lowest comparable competitor price
}

export interface MonthMetrics {
  sellerId: SellerId;
  month: MonthKey;
  sales: number;
  orders: number;
  cancelRate: number; // percent, e.g. 14 = 14%
  asp: number;
  oosCount: number;
  cancelReasons: Record<string, number>;
  avgDispatchDays: number;
  rating: number;
  adsActive: boolean; // extra: sponsored campaign running?
}

export type ActionType =
  | "mark_listings_unavailable"
  | "set_low_stock_alert"
  | "create_restock_plan"
  | "create_deal"
  | "update_dispatch_sla"
  | "escalate_to_human_kam";

export interface Action {
  id: string;
  sellerId: SellerId;
  type: ActionType;
  title: string;
  detail: string;
  payload: Record<string, unknown>;
  status: "proposed" | "executed" | "failed";
  owner: "KAM" | "Seller";
  due: string; // ISO date
  createdAt: string;
  callId?: string;
}

export interface Alert {
  id: string;
  sellerId: SellerId;
  sku: string;
  type: "low_stock";
  thresholdDays: number;
  active: boolean;
}

export interface Deal {
  id: string;
  sellerId: SellerId;
  sku: string;
  discountPct: number;
  days: number;
  startsWhen: "now" | "after_restock";
}

export interface FollowUp {
  id: string;
  sellerId: SellerId;
  dueInDays: number;
  targets: string[];
  status: "scheduled" | "done";
  createdAt: string;
}

export interface Escalation {
  id: string;
  sellerId: SellerId;
  reason: string;
  createdAt: string;
  status: "open" | "closed";
}

export interface TranscriptLine {
  role: "agent" | "user";
  text: string;
}

export interface CallLog {
  id: string;
  sellerId: SellerId;
  startedAt: string;
  reason: "inbound" | "proactive" | "followup";
  summary: string;
  keyIssues: string[];
  actionsAgreed: string[];
  nextSteps: string[];
  followUp?: string;
  transcript: TranscriptLine[];
}

export interface DB {
  sellers: Seller[];
  skus: Sku[];
  metrics: MonthMetrics[];
  actions: Action[];
  alerts: Alert[];
  deals: Deal[];
  followUps: FollowUp[];
  escalations: Escalation[];
  callLogs: CallLog[];
}

// ---------- Analytics outputs ----------

export type CauseKey =
  | "stockouts"
  | "pricing"
  | "dispatch"
  | "cancellations"
  | "visibility";

export interface Cause {
  key: CauseKey;
  confidence: "high" | "med" | "low";
  impactOrders: number;
  impactRupees: number;
  shareOfDropPct: number;
  evidence: string[];
  unknowns: string[];
  skus?: { sku: string; name: string; orders: number }[];
}

export interface Diagnosis {
  sellerId: SellerId;
  headline: {
    salesLast: number;
    salesThis: number;
    salesDrop: number;
    salesDropPct: number;
    ordersLast: number;
    ordersThis: number;
    orderDrop: number;
    aspChangePct: number;
    volumeEffectRupees: number;
    priceEffectRupees: number;
    realisedRevenueLast: number;
    realisedRevenueThis: number;
    realisedRevenueDropPct: number;
  };
  causes: Cause[];
  unexplainedOrders: number;
}

export interface Anomaly {
  key: string;
  severity: "high" | "med" | "low";
  message: string;
  skus?: string[];
}

export interface HealthCheck {
  sellerId: SellerId;
  anomalies: Anomaly[];
  callContext: string | null; // one-line reason for a proactive call
}
