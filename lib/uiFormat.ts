// Display formatting for the dashboard (the voice side uses lib/format.ts).

export const rupee = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export const pctOf = (n: number) => `${Math.round(n * 10) / 10}%`;

/** Percent change from a to b, rounded to one decimal. */
export const pctChange = (a: number, b: number) => (a === 0 ? 0 : Math.round(((b - a) / a) * 1000) / 10);

/** Signed label like "−32.5%" (true minus sign). */
export const signed = (p: number) => (p === 0 ? "0%" : `${p > 0 ? "+" : "−"}${Math.abs(p)}%`);

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export const humanize = (k: string) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
