"use client";

// "Asha is calling" screen for calls she starts herself (proactive or 7-day follow-up).

import { useEffect, useRef } from "react";

export interface IncomingCall {
  reason: "proactive" | "followup";
  headline: string; // what the seller sees
  context: string; // what Asha says right after the greeting ({{call_context}})
  details?: string[];
}

export default function IncomingCallModal({
  call,
  sellerName,
  onAccept,
  onDecline,
}: {
  call: IncomingCall;
  sellerName: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const accept = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    accept.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDecline();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDecline]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="incoming-title"
        aria-describedby="incoming-reason"
        className="w-full max-w-sm rounded-2xl bg-plum p-6 text-center text-white shadow-2xl"
      >
        <div aria-hidden className="relative mx-auto size-20 rounded-full bg-[radial-gradient(circle_at_35%_30%,#ff6b9a,#e40046_55%,#7a0026)] orb-speaking" />
        <div className="mt-4 text-[13px] text-white/60">
          {call.reason === "followup" ? "7-day follow-up" : "Incoming call"} for {sellerName.split(" ")[0]}
        </div>
        <h2 id="incoming-title" className="mt-1 text-xl font-semibold">
          📞 Asha from Snapdeal is calling
        </h2>
        <p id="incoming-reason" className="mt-2 text-[15px] leading-snug text-white/90">
          {call.headline}
        </p>
        {call.details && call.details.length > 0 && (
          <ul className="mt-3 space-y-1 text-left text-[13px] text-white/60">
            {call.details.map((d) => (
              <li key={d}>• {d}</li>
            ))}
          </ul>
        )}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button onClick={onDecline} className="rounded-lg border border-white/25 px-4 py-2.5 font-semibold hover:bg-white/10">
            Decline
          </button>
          <button ref={accept} onClick={onAccept} className="rounded-lg bg-gain px-4 py-2.5 font-semibold hover:brightness-110">
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
