import { describe, expect, it, vi } from "vitest";
import { AGENT_TOOL_NAMES, buildClientTools } from "@/lib/agentClientTools";
import { TOOL_NAMES } from "@/lib/tools";

describe("browser client tools", () => {
  it("registers exactly the tools the backend knows", () => {
    expect([...AGENT_TOOL_NAMES].sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("posts to /api/tools/<name>, fills seller_id, passes call context, returns the message", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, message: "Done. Test.", ui: { kind: "sku", skus: ["HK-112"] } })));
    vi.stubGlobal("fetch", fetchMock);
    const tools = buildClientTools(() => ({
      sellerId: "S1",
      callId: "conv_1",
      callReason: "inbound",
      transcript: [{ role: "user", text: "hi" }],
    }));
    const out = await tools.save_call_summary({ key_issues: ["x"] });
    expect(out).toBe("Done. Test.");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/tools/save_call_summary");
    const body = JSON.parse(init.body as string);
    expect(body.args).toEqual({ seller_id: "S1", key_issues: ["x"] });
    expect(body.ctx).toMatchObject({ callId: "conv_1", callReason: "inbound", transcript: [{ role: "user", text: "hi" }] });
    vi.unstubAllGlobals();
  });
});
