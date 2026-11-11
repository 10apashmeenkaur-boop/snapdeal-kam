import { NextResponse } from "next/server";
import { TOOLS } from "@/lib/tools";

// GET /api/tools: list the tools the backend knows, for checking against the dashboard.
export function GET() {
  return NextResponse.json(Object.entries(TOOLS).map(([name, t]) => ({ name, kind: t.kind })));
}
