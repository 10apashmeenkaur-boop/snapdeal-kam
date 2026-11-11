import { NextResponse } from "next/server";
import { getDB, updateDB } from "@/lib/store";
import { executeTool, isReadTool, TOOLS, type ToolContext, type ToolResponse } from "@/lib/tools";

export const dynamic = "force-dynamic";

// POST /api/tools/<name>  body: { args: {...tool params}, ctx?: { callId, callReason, transcript } }
export async function POST(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;

  if (!TOOLS[name]) {
    // Loud on purpose: this means the dashboard tool config and agent/tools.json disagree.
    console.error(`[tools] UNKNOWN TOOL "${name}". Check agent/tools.json against the ElevenLabs dashboard.`);
    return NextResponse.json(
      { ok: false, message: `Unknown tool "${name}".`, ui: { kind: "error" } } satisfies ToolResponse,
      { status: 404 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { args?: unknown; ctx?: Record<string, unknown> };
  const ctx: ToolContext = {
    callId: typeof body.ctx?.callId === "string" ? body.ctx.callId : undefined,
    callReason: ["inbound", "proactive", "followup"].includes(body.ctx?.callReason as string)
      ? (body.ctx!.callReason as ToolContext["callReason"])
      : undefined,
    transcript: Array.isArray(body.ctx?.transcript)
      ? (body.ctx!.transcript as ToolContext["transcript"])!.slice(-200)
      : undefined,
  };
  const args = body.args ?? {};

  const response = isReadTool(name)
    ? executeTool(await getDB(), name, args, ctx).response
    : await updateDB((db) => {
        const out = executeTool(db, name, args, ctx);
        return { db: out.db, result: out.response };
      });

  console.log(
    `[tools] ${name}(${JSON.stringify(args)}) -> ${response.ok ? "ok" : "REJECTED"}: ${response.message.slice(0, 140)}`,
  );
  return NextResponse.json(response);
}
