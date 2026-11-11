"use client";

// Voice wiring: ElevenLabs React SDK → CallPanel.
// - Mic permission is requested explicitly before connecting.
// - Credentials come from our server (/api/get-signed-url); the API key never reaches the browser.
// - WebRTC first; if it fails before connecting, retry once over WebSocket.
// - Every agent tool call runs in the browser (client tools) and hits /api/tools/<name>.

import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildClientTools, reportUnknownTool, type CallContext } from "@/lib/agentClientTools";
import type { TranscriptLine } from "@/lib/types";
import CallPanel, { type CallStatus } from "./CallPanel";

export interface CallRequest {
  id: number; // change it to start a new call (used by proactive / follow-up calls)
  reason: CallContext["callReason"];
  context: string;
}

interface Props {
  sellerId: string;
  sellerName: string;
  resetKey: string;
  request?: CallRequest | null;
  onCallEnd?: () => void;
}

export default function VoiceCall(props: Props) {
  return (
    <ConversationProvider>
      <VoiceCallInner {...props} />
    </ConversationProvider>
  );
}

const INBOUND_CONTEXT = "How can I help you today?";

function VoiceCallInner({ sellerId, sellerName, resetKey, request, onCallEnd }: Props) {
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  const ctx = useRef<CallContext>({ sellerId, callReason: "inbound", transcript: [] });
  const connected = useRef(false);
  const fallback = useRef<null | (() => void)>(null);

  useEffect(() => {
    ctx.current.sellerId = sellerId;
  }, [sellerId]);

  const clientTools = useMemo(() => buildClientTools(() => ctx.current), []);

  const conversation = useConversation({
    clientTools,
    onConnect: ({ conversationId }) => {
      connected.current = true;
      fallback.current = null;
      ctx.current.callId = conversationId;
      setNotice(null);
    },
    onDisconnect: (d) => {
      // WebRTC couldn't connect: try the WebSocket route once.
      if (!connected.current && d.reason === "error" && fallback.current) {
        const retry = fallback.current;
        fallback.current = null;
        retry();
        return;
      }
      const wasLive = connected.current;
      connected.current = false;
      setPreparing(false);
      if (d.reason === "error") setNotice(`The call dropped: ${d.message}`);
      else if (d.reason === "agent") setNotice("Asha ended the call.");
      else setNotice(wasLive ? "Call ended." : null);
      if (wasLive) onCallEnd?.();
    },
    onMessage: ({ message, role }) => {
      if (!message?.trim()) return;
      setTranscript((t) => {
        const next = [...t, { role, text: message }];
        ctx.current.transcript = next;
        return next;
      });
    },
    onError: (message) => {
      console.error("[voice]", message);
      setNotice(`Voice error: ${message}`);
    },
    onUnhandledClientToolCall: (call) => reportUnknownTool(call.tool_name, call.parameters),
  });
  // `conversation` is a fresh object each render; these two are stable references.
  const { startSession, endSession } = conversation;

  const start = useCallback(
    async (reason: CallContext["callReason"], context: string) => {
      setNotice(null);
      setPreparing(true);
      setTranscript([]);
      connected.current = false;
      ctx.current = { sellerId, callReason: reason, transcript: [] };

      // 1. Ask for the mic up front, with a clear message if it's blocked.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        setPreparing(false);
        setNotice("Microphone is blocked. Allow it from the icon in Chrome's address bar, then press the button again.");
        return;
      }

      // 2. Short-lived credentials from our server.
      let creds: { conversationToken?: string; signedUrl?: string; error?: string };
      try {
        const res = await fetch("/api/get-signed-url", { cache: "no-store" });
        creds = await res.json();
        if (!res.ok) throw new Error(creds.error ?? `status ${res.status}`);
      } catch (e) {
        setPreparing(false);
        setNotice(`Couldn't start the call: ${(e as Error).message}`);
        return;
      }

      // 3. Start the session with the seller's details as dynamic variables.
      const dynamicVariables = {
        seller_id: sellerId,
        seller_name: sellerName.split(" ")[0],
        call_reason: reason,
        call_context: context,
      };
      const viaSocket = creds.signedUrl
        ? () => startSession({ signedUrl: creds.signedUrl!, connectionType: "websocket", dynamicVariables })
        : null;
      if (creds.conversationToken) {
        fallback.current = viaSocket;
        startSession({ conversationToken: creds.conversationToken, connectionType: "webrtc", dynamicVariables });
      } else {
        viaSocket?.();
      }
    },
    [startSession, sellerId, sellerName],
  );

  // Proactive / follow-up calls arrive as a request object (Phase 5 incoming-call flow).
  const lastRequest = useRef<number | null>(null);
  useEffect(() => {
    if (request && request.id !== lastRequest.current) {
      lastRequest.current = request.id;
      start(request.reason, request.context);
    }
  }, [request, start]);

  // Clear the transcript when the demo resets or the seller changes (not mid-call).
  useEffect(() => {
    if (conversation.status === "disconnected") {
      setTranscript([]);
      setNotice(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // End the call if this component unmounts (e.g. page navigation).
  useEffect(() => () => endSession(), [endSession]);

  const status: CallStatus =
    conversation.status === "connected"
      ? conversation.isSpeaking
        ? "speaking"
        : "listening"
      : conversation.status === "connecting" || (preparing && conversation.status !== "error")
        ? "connecting"
        : "idle";

  // Once connected, the SDK owns the status; drop our local "preparing" flag.
  useEffect(() => {
    if (conversation.status === "connected" || (conversation.status === "error" && !fallback.current)) setPreparing(false);
  }, [conversation.status]);

  return (
    <CallPanel
      sellerName={sellerName}
      status={status}
      transcript={transcript}
      onStart={() => start("inbound", INBOUND_CONTEXT)}
      onEnd={() => {
        fallback.current = null;
        setPreparing(false);
        endSession();
      }}
      notice={notice}
      resetKey={resetKey}
    />
  );
}
