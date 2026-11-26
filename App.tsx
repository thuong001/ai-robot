/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  AudioLines,
  Loader2,
  Mic,
  MicOff,
  Square,
  Volume2,
} from "lucide-react";
import { RobotCanvas } from "./components/RobotCanvas";
import { LiveVoiceClient } from "./lib/liveVoiceClient";
import type { LiveCaptions, RobotState } from "./types/robot";

const STATE_LABELS: Record<RobotState, string> = {
  idle: "Sẵn sàng",
  connecting: "Đang kết nối...",
  listening: "Đang nghe...",
  thinking: "Đang suy nghĩ...",
  speaking: "Đang nói...",
  error: "Có lỗi kết nối",
};

function StateGlyph({ state }: { state: RobotState }) {
  switch (state) {
    case "connecting":
    case "thinking":
      return (
        <Loader2
          className={`w-4 h-4 animate-spin ${
            state === "thinking" ? "text-amber-400" : "text-sky-400"
          }`}
          aria-hidden="true"
        />
      );
    case "listening":
      return (
        <AudioLines className="w-4 h-4 text-emerald-400" aria-hidden="true" />
      );
    case "speaking":
      return (
        <Volume2 className="w-4 h-4 text-cyan-300" aria-hidden="true" />
      );
    case "error":
      return (
        <AlertCircle className="w-4 h-4 text-rose-400" aria-hidden="true" />
      );
    default:
      return <MicOff className="w-4 h-4 text-slate-400" aria-hidden="true" />;
  }
}

export default function App() {
  const [robotState, setRobotState] = useState<RobotState>("idle");
  const [captions, setCaptions] = useState<LiveCaptions>({
    userText: "",
    robotText: "",
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const voiceClientRef = useRef<LiveVoiceClient | null>(null);

  if (!voiceClientRef.current) {
    voiceClientRef.current = new LiveVoiceClient({
      onStateChange: (nextState) => {
        setRobotState(nextState);
        if (nextState !== "error") {
          setErrorMessage(null);
        }
      },
      onUserTranscript: (text) => {
        setCaptions({ userText: text, robotText: "" });
      },
      onRobotTranscript: (text) => {
        setCaptions((prev) => ({ ...prev, robotText: text }));
      },
      onError: (message) => {
        setErrorMessage(message);
      },
    });
  }

  useEffect(() => {
    const client = voiceClientRef.current;
    return () => {
      client?.stop();
    };
  }, []);

  const getAudioLevels = useCallback(() => {
    return (
      voiceClientRef.current?.getAudioLevels() ?? {
        speechLevel: 0,
        micLevel: 0,
      }
    );
  }, []);

  const isSessionActive =
    robotState === "connecting" ||
    robotState === "listening" ||
    robotState === "thinking" ||
    robotState === "speaking";

  const handleMicToggle = () => {
    const client = voiceClientRef.current;
    if (!client) return;

    if (isSessionActive) {
      client.stop();
      setCaptions({ userText: "", robotText: "" });
      return;
    }

    setErrorMessage(null);
    setCaptions({ userText: "", robotText: "" });
    void client.start();
  };

  return (
    <main className="relative w-full h-[100dvh] overflow-hidden bg-[#060A14] select-none">
      {/* Full-screen 3D Robot Character Viewport */}
      <RobotCanvas robotState={robotState} getAudioLevels={getAudioLevels} />

      {/* Top Minimal Brand & Explicit State Header */}
      <header className="pointer-events-none absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-3 sm:px-8">
        <span className="font-display text-lg sm:text-xl font-bold tracking-tight text-white whitespace-nowrap shrink-0">
          AI ROBOT
        </span>

        <div
          className="flex items-center gap-2 text-xs sm:text-sm font-medium text-slate-200 whitespace-nowrap shrink-0"
          role="status"
          aria-live="polite"
        >
          <StateGlyph state={robotState} />
          <span
            className={
              robotState === "listening"
                ? "text-emerald-300"
                : robotState === "thinking"
                  ? "text-amber-300"
                  : robotState === "speaking"
                    ? "text-cyan-200"
                    : robotState === "error"
                      ? "text-rose-300"
                      : "text-slate-300"
            }
          >
            {STATE_LABELS[robotState]}
          </span>
        </div>
      </header>

      {/* Bottom Ergonomic Thumb Zone: Captions/Errors + Single Large Mic ON/OFF Button */}
      <section className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 flex flex-col items-center gap-4 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-8">
        {/* Live Caption / Error Display */}
        <div className="w-full max-w-md min-h-[3.25rem] flex items-end justify-center">
          {errorMessage ? (
            <div
              role="alert"
              className="pointer-events-auto w-full rounded-2xl bg-[#1C0D14]/92 border border-rose-400/30 px-4 py-3 text-center text-sm leading-relaxed text-rose-100 shadow-lg"
            >
              {errorMessage}
            </div>
          ) : captions.robotText || captions.userText ? (
            <div
              aria-live="polite"
              className="w-full rounded-2xl bg-[#0B1222]/86 border border-white/10 px-4 py-2.5 text-center shadow-lg"
            >
              {captions.userText && (
                <p className="text-xs sm:text-sm text-emerald-200/90 line-clamp-2 leading-snug">
                  {captions.userText}
                </p>
              )}
              {captions.robotText && (
                <p className="mt-1 text-sm sm:text-base font-medium text-white line-clamp-3 leading-snug">
                  {captions.robotText}
                </p>
              )}
            </div>
          ) : (
            <p className="text-center text-xs sm:text-sm text-slate-400 px-4">
              {isSessionActive
                ? robotState === "listening"
                  ? "Hãy nói bằng bất kỳ ngôn ngữ nào..."
                  : robotState === "thinking"
                    ? "AI ROBOT đang hiểu ý bạn..."
                    : robotState === "speaking"
                      ? "AI ROBOT đang trả lời..."
                      : "Đang thiết lập kết nối giọng nói..."
                : "Chạm micro để trò chuyện hoặc dịch tự động"}
            </p>
          )}
        </div>

        {/* ONLY ONE Large Microphone ON/OFF Button */}
        <div className="pointer-events-auto relative flex flex-col items-center gap-2.5">
          <div className="relative flex items-center justify-center">
            {(robotState === "listening" || robotState === "speaking") && (
              <>
                <span
                  aria-hidden="true"
                  className={`animate-ring-expand absolute inset-0 rounded-full border-2 ${
                    robotState === "listening"
                      ? "border-emerald-400/60"
                      : "border-cyan-400/60"
                  }`}
                />
                <span
                  aria-hidden="true"
                  className={`animate-ring-expand-delayed absolute inset-0 rounded-full border ${
                    robotState === "listening"
                      ? "border-emerald-300/40"
                      : "border-cyan-300/40"
                  }`}
                />
              </>
            )}

            <button
              type="button"
              onClick={handleMicToggle}
              aria-pressed={isSessionActive}
              aria-label={
                isSessionActive ? "Tắt micro" : "Bật micro để nói chuyện"
              }
              className={`relative z-10 flex h-20 w-20 sm:h-[88px] sm:w-[88px] items-center justify-center rounded-full transition-transform duration-150 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-400 ${
                isSessionActive
                  ? "bg-gradient-to-b from-rose-500 to-red-600 text-white shadow-[0_12px_36px_rgba(244,63,94,0.45)] border border-rose-300/40"
                  : "bg-gradient-to-b from-cyan-400 to-sky-600 text-slate-950 shadow-[0_12px_36px_rgba(14,165,233,0.45)] border border-cyan-200/50 hover:brightness-105"
              }`}
            >
              {robotState === "connecting" ? (
                <Loader2 className="h-9 w-9 animate-spin" aria-hidden="true" />
              ) : isSessionActive ? (
                <Square className="h-8 w-8 fill-current" aria-hidden="true" />
              ) : (
                <Mic className="h-9 w-9 stroke-[2.25]" aria-hidden="true" />
              )}
            </button>
          </div>

          <span className="text-xs font-medium tracking-wide text-slate-300 whitespace-nowrap">
            {isSessionActive ? "Chạm để dừng" : "Bật micro"}
          </span>
        </div>
      </section>
    </main>
  );
}
