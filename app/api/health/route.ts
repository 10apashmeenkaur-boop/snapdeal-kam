import { NextResponse } from "next/server";
import { storeMode } from "@/lib/store";

export const dynamic = "force-dynamic";

// GET /api/health: which storage backend is active (upstash | file | memory) and whether voice is configured.
export function GET() {
  return NextResponse.json({
    ok: true,
    store: storeMode,
    voiceConfigured: Boolean(process.env.ELEVENLABS_API_KEY && process.env.NEXT_PUBLIC_AGENT_ID),
  });
}
