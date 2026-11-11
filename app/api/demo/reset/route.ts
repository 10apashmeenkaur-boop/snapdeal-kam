import { NextResponse } from "next/server";
import { resetDB } from "@/lib/store";

export const dynamic = "force-dynamic";

// POST /api/demo/reset: restore data/seed.json.
export async function POST() {
  await resetDB();
  return NextResponse.json({ ok: true });
}
