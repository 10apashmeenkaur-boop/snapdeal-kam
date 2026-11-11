// Sample arguments for the dev tool panel, per seller.

const TOP: Record<string, string[]> = {
  S1: ["HK-112", "HK-087", "HK-145", "HK-063"],
  S2: ["PE-201", "PE-118", "PE-305"],
  S3: ["GH-501", "GH-322", "GH-417"],
};
const LOW: Record<string, string[]> = {
  S1: ["HK-016", "HK-022", "HK-028"],
  S2: ["PE-201"],
  S3: ["GH-501"],
};

export function sampleArgs(tool: string, sellerId: string): Record<string, unknown> {
  const seller_id = sellerId;
  const top = TOP[sellerId] ?? [];
  switch (tool) {
    case "get_sku_details":
      return { seller_id, filter: sellerId === "S1" ? "out_of_stock" : "top_sellers" };
    case "mark_listings_unavailable":
      return { seller_id, skus: top, seller_confirmed: true };
    case "set_low_stock_alert":
      return { seller_id, skus: LOW[sellerId], threshold_days: 7, seller_confirmed: true };
    case "create_restock_plan":
      return { seller_id, skus: top, seller_confirmed: true };
    case "create_deal":
      return sellerId === "S2"
        ? { seller_id, sku: "PE-201", discount_pct: 40, days: 7, start: "now", seller_confirmed: true }
        : { seller_id, sku: top[0], discount_pct: 10, days: 7, start: sellerId === "S1" ? "after_restock" : "now", seller_confirmed: true };
    case "update_dispatch_sla":
      return { seller_id, target_hours: 24, seller_confirmed: true };
    case "schedule_followup":
      return { seller_id, in_days: 7, targets: ["Cancellation rate below 9 percent", "Top sellers back in stock"] };
    case "escalate_to_human_kam":
      return { seller_id, reason: "Seller asked for compensation for lost sales" };
    case "save_call_summary":
      return {
        seller_id,
        key_issues: ["Sales down 32.5 percent, mainly stock-outs on 4 bestsellers"],
        actions_agreed: ["Paused out-of-stock listings", "Restock plan for 4 bestsellers"],
        next_steps: ["Seller restocks within 3 days", "Follow-up call in 7 days"],
        follow_up: "in 7 days",
      };
    default:
      return { seller_id };
  }
}
