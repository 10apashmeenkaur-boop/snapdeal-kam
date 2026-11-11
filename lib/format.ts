// Voice-friendly number formatting (Indian system, no currency symbols).

/** 135000 -> "1.35 lakh rupees", 48500 -> "48,500 rupees". */
export function inr(n: number): string {
  const abs = Math.abs(Math.round(n));
  if (abs >= 1e7) return `${Math.round(abs / 1e5) / 100} crore rupees`;
  if (abs >= 1e5) return `${Math.round(abs / 1e3) / 100} lakh rupees`;
  return `${abs.toLocaleString("en-IN")} rupees`;
}

/** Signed percent change, e.g. -32.5 -> "down 32.5%". */
export function change(from: number, to: number): string {
  if (from === 0) return "no change";
  const p = Math.round(((to - from) / from) * 1000) / 10;
  if (p === 0) return "flat";
  return `${p > 0 ? "up" : "down"} ${Math.abs(p)}%`;
}

export const humanReason = (k: string) => k.replace(/_/g, " ");
