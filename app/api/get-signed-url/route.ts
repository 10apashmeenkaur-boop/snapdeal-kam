import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Mints short-lived credentials for the private ElevenLabs agent, so the API key
// never reaches the browser. Returns a WebRTC conversation token (preferred for
// voice: echo cancellation, lower latency) and a WebSocket signed URL as fallback.
// Neither starts a conversation or uses minutes on its own.

const API = "https://api.elevenlabs.io/v1/convai/conversation";

// Light abuse guard for a public demo link: a few sessions per IP per hour.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 12;
const hits = new Map<string, number[]>();

function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

export async function GET(req: Request) {
  const key = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.NEXT_PUBLIC_AGENT_ID;
  if (!key || !agentId)
    return NextResponse.json(
      { error: "Voice isn't configured: set ELEVENLABS_API_KEY and NEXT_PUBLIC_AGENT_ID in .env.local." },
      { status: 500 },
    );

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (limited(ip))
    return NextResponse.json({ error: "Too many calls from this network. Try again in an hour." }, { status: 429 });

  const q = `agent_id=${encodeURIComponent(agentId)}`;
  const headers = { "xi-api-key": key };
  const [tokenRes, urlRes] = await Promise.allSettled([
    fetch(`${API}/token?${q}`, { headers, cache: "no-store" }),
    fetch(`${API}/get-signed-url?${q}`, { headers, cache: "no-store" }),
  ]);

  const out: { conversationToken?: string; signedUrl?: string } = {};
  if (tokenRes.status === "fulfilled" && tokenRes.value.ok) out.conversationToken = (await tokenRes.value.json()).token;
  if (urlRes.status === "fulfilled" && urlRes.value.ok) out.signedUrl = (await urlRes.value.json()).signed_url;

  if (!out.conversationToken && !out.signedUrl) {
    const status = tokenRes.status === "fulfilled" ? tokenRes.value.status : 502;
    console.error(`[get-signed-url] ElevenLabs refused both credential requests (status ${status})`);
    return NextResponse.json({ error: `ElevenLabs refused the request (status ${status}). Check the API key and agent id.` }, { status: 502 });
  }
  return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
}
