"use client";

// Loads one seller's full state and works out what changed since the last load,
// so the UI can flash exactly the rows a tool touched.

import { useCallback, useEffect, useRef, useState } from "react";
import type { SellerState } from "@/lib/state";
import { onToolEvent } from "@/lib/uiBus";

export interface Changed {
  skus: Set<string>;
  ids: Set<string>; // actions, alerts, deals, follow-ups, calls, escalations
  metrics: boolean;
}

const EMPTY: Changed = { skus: new Set(), ids: new Set(), metrics: false };

function diff(prev: SellerState, next: SellerState, hint: string[]): Changed {
  const skus = new Set(hint);
  const before = new Map(prev.skus.map((s) => [s.sku, s]));
  for (const s of next.skus) {
    const p = before.get(s.sku);
    if (p && (p.status !== s.status || p.stock !== s.stock || p.searchRank !== s.searchRank || p.ordersThis !== s.ordersThis))
      skus.add(s.sku);
  }
  const ids = new Set<string>();
  const oldIds = new Set(
    [...prev.actions, ...prev.alerts, ...prev.deals, ...prev.followUps, ...prev.callLogs, ...prev.escalations].map((x) => x.id),
  );
  for (const x of [...next.actions, ...next.alerts, ...next.deals, ...next.followUps, ...next.callLogs, ...next.escalations])
    if (!oldIds.has(x.id)) ids.add(x.id);
  next.alerts.filter((a) => ids.has(a.id)).forEach((a) => skus.add(a.sku));
  next.deals.filter((d) => ids.has(d.id)).forEach((d) => skus.add(d.sku));
  const metrics = JSON.stringify(prev.metrics) !== JSON.stringify(next.metrics);
  return { skus, ids, metrics };
}

export function useSellerState(sellerId: string) {
  const [state, setState] = useState<SellerState | null>(null);
  const [changed, setChanged] = useState<Changed>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const prev = useRef<SellerState | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(
    async (hint: string[] = []) => {
      try {
        const res = await fetch(`/api/seller/${sellerId}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`Couldn't load seller ${sellerId} (${res.status})`);
        const next = (await res.json()) as SellerState;
        if (prev.current && prev.current.seller.id === next.seller.id) {
          setChanged(diff(prev.current, next, hint));
          if (clearTimer.current) clearTimeout(clearTimer.current);
          clearTimer.current = setTimeout(() => setChanged(EMPTY), 2600);
        }
        prev.current = next;
        setState(next);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [sellerId],
  );

  useEffect(() => {
    prev.current = null;
    setChanged(EMPTY);
    refresh();
  }, [refresh]);

  // Any tool call (voice agent or dev panel) refreshes the dashboard.
  useEffect(
    () =>
      onToolEvent((e) => {
        const hint = e.response.ok && e.response.ui.kind !== "read" ? (e.response.ui.skus ?? []) : [];
        refresh(hint);
      }),
    [refresh],
  );

  return { state, changed, error, refresh };
}
