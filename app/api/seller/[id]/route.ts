import { NextResponse } from "next/server";
import { sellerState } from "@/lib/state";
import { getDB } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = sellerState(await getDB(), id.toUpperCase());
  if (!state) return NextResponse.json({ error: `Unknown seller ${id}` }, { status: 404 });
  return NextResponse.json(state);
}
