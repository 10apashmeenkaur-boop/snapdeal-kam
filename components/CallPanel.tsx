"use client";

// Centre column: the live call. Orb (driven by call status), start/end, transcript, tool feed.
// Presentational: the voice wiring passes status, transcript and handlers in.

import { useEffect, useRef } from "react";
import type { TranscriptLine } from "@/lib/types";
import ToolFeed from "./ToolFeed";

export type CallStatus = "idle" | "connecting" | "listening" | "speaking";

const STATUS_TEXT: Record<CallStatus, string> = {
  idle: "Not on a call",
  connecting: "Connecting…",
  listening: "Listening",
  speaking: "Asha is speaking",
};

export default function CallPanel({
  sellerName,
  status,
  transcript,
  onStart,
  onEnd,
  notice,
  resetKey,
}: {
  sellerName: string;
  status: CallStatus;
  transcript: TranscriptLine[];
  onStart?: () => void;
  onEnd?: () => void;
  notice?: string | null;
  resetKey: string;
}) {
  const live = status !== "idle";
  const lastLine = useRef<HTMLLIElement>(null);
  useEffect(() => {
    lastLine.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [transcript.length]);
  return (
    <aside className="flex flex-col gap-5 rounded-xl bg-plum p-5 text-white lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
      <div className="flex flex-col items-center gap-3 pt-2 text-center">
        <div
          aria-hidden
          className={`relative size-28 rounded-full bg-[radial-gradient(circle_at_35%_30%,#ff6b9a,#e40046_55%,#7a0026)] shadow-[0_0_60px_-10px_#e40046] ${
            status === "listening" ? "orb-listening" : status === "speaking" ? "orb-speaking" : status === "connecting" ? "orb-connecting" : "opacity-60 grayscale-[35%]"
          }`}
        />
        <div>
          <div className="text-lg font-semibold">Asha</div>
          <div className="text-[13px] text-white/60">Snapdeal account manager</div>
        </div>
        <div role="status" className="text-sm text-white/80">
          {STATUS_TEXT[status]}
        </div>
        {live ? (
          <button
            onClick={onEnd}
            className="w-full rounded-lg bg-white px-4 py-2.5 font-semibold text-plum hover:bg-white/90"
          >
            End call
          </button>
        ) : (
          <button
            onClick={onStart}
            disabled={!onStart}
            className="w-full rounded-lg bg-accent px-4 py-2.5 font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Talk to Asha as {sellerName.split(" ")[0]}
          </button>
        )}
        {notice && <p className="text-[13px] text-white/70">{notice}</p>}
      </div>

      <section aria-label="Transcript" className="border-t border-plum-rule pt-4">
        <h3 className="text-sm font-semibold text-white/90">Transcript</h3>
        {transcript.length === 0 ? (
          <p className="mt-2 text-[13px] text-white/50">The conversation appears here, line by line, once the call starts.</p>
        ) : (
          <ol className="mt-2 space-y-2 text-[14px]" aria-live="polite">
            {transcript.map((t, i) => (
              <li key={i} ref={i === transcript.length - 1 ? lastLine : undefined} className={t.role === "agent" ? "pr-6" : "pl-6 text-right"}>
                <span className={`inline-block rounded-lg px-3 py-1.5 ${t.role === "agent" ? "bg-plum-2" : "bg-white/10"}`}>
                  {t.text}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="border-t border-plum-rule pt-4">
        <ToolFeed resetKey={resetKey} />
      </div>
    </aside>
  );
}
