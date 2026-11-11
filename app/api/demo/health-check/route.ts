import { NextResponse } from "next/server";
import { healthCheck } from "@/lib/analytics";
import { getDB } from "@/lib/store";

export const dynamic = "force-dynamic";

// POST /api/demo/health-check  body: { sellerId }  -> anomalies + a one-line proactive call reason
export async function POST(req: Request) {
  const { sellerId = "S1" } = (await req.json().catch(() => ({}))) as { sellerId?: string };
  try {
    return NextResponse.json(healthCheck(await getDB(), sellerId.toUpperCase()));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
