import { NextResponse } from "next/server";
import { simulateWeek } from "@/lib/analytics";
import { updateDB } from "@/lib/store";

export const dynamic = "force-dynamic";

// POST /api/demo/simulate-week  body: { sellerId }
export async function POST(req: Request) {
  const { sellerId = "S1" } = (await req.json().catch(() => ({}))) as { sellerId?: string };
  try {
    const week = await updateDB((db) => {
      const out = simulateWeek(db, sellerId.toUpperCase());
      return { db: out.db, result: out.week };
    });
    return NextResponse.json({ ok: true, week });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
