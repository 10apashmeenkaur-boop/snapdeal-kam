# Virtual KAM: submission note
*Pashmeen Kaur · Snapdeal AI First Intern take-home*

**Idea.** Most "AI KAMs" talk *about* actions. Asha, the voice agent, takes ownership: she diagnoses the seller's drop from data, asks only what data can't answer, then **executes the fixes during the call** against a live (mock) seller backend, with the seller's spoken consent. The dashboard changes as she works, and every call ends with a saved summary and a scheduled follow-up with measurable targets.

## Stack
| Layer | Choice | Why |
|---|---|---|
| Voice pipeline | **ElevenLabs Agents** (WebRTC, WebSocket fallback) | Low latency, real turn-taking and barge-in, Indian voices |
| Speech-to-text | ElevenLabs ASR (built into Agents) | English by default; a `language_detection` tool switches the call to Hindi |
| LLM | **Gemini 3.5 Flash**, temperature 0.4 | Fast, reliable tool calling; keeps turns short |
| Text-to-speech | ElevenLabs **Flash v2** (English), **Flash v2.5** (Hindi preset); voice "Anika", Indian English | Lowest-latency models; warm customer-care voice that handles Hinglish |
| App | Next.js + TypeScript, `@elevenlabs/react` (pinned), zod, vitest | One deployable app: UI, tool API and analytics |
| State | JSON file locally; Upstash Redis when deployed | Shared state across serverless instances |

## Workflow on a call
1. **Before speaking**, Asha calls `get_account_history` and `get_diagnosis`. Every number she says comes from a tool.
2. **Headline in one sentence**: what dropped and the biggest cause. For the brief's seller: sales −₹65,000 (−32.5%), all volume since price was flat. 13 products went out of stock, worth 97 orders (~75% of the drop); 4 bestsellers alone are 88 orders. Cancellations rose 8% → 14% (26 of 38 were "no stock").
3. **Discovery**: at most 2–3 questions, only about the diagnosis "unknowns" (why stock ran out, when it can be restocked).
4. **Recommend 2–3 actions with numbers**, split into what Asha does and what the seller does.
5. **Act**: after a spoken "yes", she calls write tools (`mark_listings_unavailable`, `create_restock_plan`, `set_low_stock_alert`, `create_deal`, `update_dispatch_sla`). Rows flash on the dashboard.
6. **Close**: `schedule_followup` (7 days, measurable targets), `save_call_summary`, a short recap, `end_call`. Angry sellers or requests for refunds or exceptions go to `escalate_to_human_kam`.

**Three sellers, three different root causes** (stock-outs, pricing vs a competitor, slow dispatch), so the diagnosis is computed, not scripted. **Simulate 7 days** applies only the actions actually taken and shows the result (S1: orders 270 → 310, cancellations 14% → 4.5%).

## Reliability and safety, in code rather than in the prompt
- A **deterministic analytics engine** (unit-tested against the brief's numbers) does all maths; the LLM only repeats results.
- **Consent guard**: write tools return "NOT EXECUTED" unless `seller_confirmed` is `true`.
- **Deal guard**: discounts are capped at 30% and can't go below cost + 5%; on rejection the tool returns the maximum safe discount, so Asha offers an alternative.
- **API key stays on the server**: the agent is private, and each call uses short-lived credentials from our server. Calls are capped at 4 minutes.
- **The agent config is code** (`agent/` + `npm run agent:sync`); a test fails if tool names drift between the app and the agent.

## Assumptions
Seller profiles, SKU data, cancellation reasons, competitor prices, sellers S2/S3 and the 7-day simulation are mock. Orders = orders placed; Sales = Orders × ASP (matches the brief). Actions change a mock backend; in production they would call Snapdeal seller-panel APIs.

## What I'd build next
Real phone calls via Exotel/Twilio, with outbound calls triggered by anomaly detection. Real seller-panel APIs. More Indian languages (Tamil, Bengali). A human-KAM handoff queue. Evaluation: score every call, track whether sellers acted and how much sales recovered. Per-call cost tracking, and DPDP-compliant recording consent.
