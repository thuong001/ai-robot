import "dotenv/config";
import express from "express";
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Modality, type LiveServerMessage } from "@google/genai";
import { WebSocket, WebSocketServer } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === "production";

const ROBOT_SYSTEM_INSTRUCTION = `You are AI ROBOT, a charming, warm, expressive, and intelligent 3D voice assistant and automatic multilingual interpreter.

CORE VOICE & LANGUAGE RULES:
1. AUTOMATIC LANGUAGE DETECTION: Always listen closely and automatically detect the spoken language (supports Vietnamese, English, Chinese/Mandarin, Japanese, Korean, Thai, French, German, Spanish, and other major world languages).
2. SINGLE-SPEAKER CONVERSATION: When a user speaks to you (asking questions, chatting, requesting help or information), always reply naturally, warmly, and concisely in the EXACT SAME language they just spoke.
3. AUTOMATIC TWO-PERSON TRANSLATION (NO BUTTON NEEDED): You can hear multiple people in the room. If two people are speaking DIFFERENT languages to each other in the conversation (for example, one person speaks Vietnamese and another person replies in English, Japanese, Korean, Chinese, Thai, French, German, or Spanish), OR if someone speaks to another person across a language barrier, seamlessly and automatically translate each utterance into the other person's language!
   - When translating between two speakers, speak the translated meaning directly, naturally, and politely in the listener's language so both people immediately understand each other.
   - Do not add robotic meta-commentary unless helpful; keep the flow effortless and human-like.
4. NATURAL SPEECH STYLE: Your responses are spoken aloud as human-like speech. Never read markdown symbols, asterisks, bullet points, or URLs. Keep replies clear, friendly, and conversational.`;

function getFriendlyErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/API_KEY_INVALID|API key not valid|401|403|PERMISSION_DENIED/i.test(msg)) {
    return "Khóa API Gemini chưa hợp lệ hoặc thiếu quyền truy cập. Vui lòng kiểm tra phần Settings > Secrets.";
  }
  if (/RESOURCE_EXHAUSTED|429|quota/i.test(msg)) {
    return "Hệ thống đang quá tải hoặc hết hạn mức truy cập. Vui lòng thử lại sau ít phút.";
  }
  if (/NOT_FOUND|404/i.test(msg)) {
    return "Không tìm thấy dịch vụ AI phù hợp. Vui lòng thử lại sau.";
  }
  return "Không thể kết nối với AI ROBOT. Vui lòng kiểm tra kết nối mạng và thử lại.";
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      hasKey: Boolean(process.env.GEMINI_API_KEY),
    });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const urlPath = req.url ? req.url.split("?")[0] : "";
    if (urlPath === "/api/live") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else if (IS_PROD) {
      socket.destroy();
    }
    // In dev mode, Vite handles its own HMR upgrades if enabled
  });

  wss.on("connection", async (clientWs: WebSocket) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      clientWs.send(
        JSON.stringify({
          type: "error",
          message:
            "Chưa cấu hình GEMINI_API_KEY. Vui lòng thêm khóa trong Settings > Secrets.",
        })
      );
      clientWs.close(1011, "Missing API key");
      return;
    }

    const ai = new GoogleGenAI({
      apiKey,
      apiVersion: "v1alpha",
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });

    let liveSession: Awaited<ReturnType<typeof ai.live.connect>> | null = null;
    let isClosed = false;

    const safeSend = (payload: Record<string, unknown>) => {
      if (!isClosed && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    const pingInterval = setInterval(() => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.ping();
      }
    }, 20000);

    try {
      liveSession = await ai.live.connect({
        model: "gemini-3.8-live",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Zephyr" },
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: ROBOT_SYSTEM_INSTRUCTION,
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            const content = message.serverContent;
            if (!content) return;

            if (content.inputTranscription?.text) {
              safeSend({
                type: "inputTranscript",
                text: content.inputTranscription.text,
              });
            }

            if (content.outputTranscription?.text) {
              safeSend({
                type: "outputTranscript",
                text: content.outputTranscription.text,
              });
            }

            for (const part of content.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                safeSend({
                  type: "audio",
                  data: part.inlineData.data,
                });
              }
            }

            if (content.interrupted) {
              safeSend({ type: "interrupted" });
            }

            if (content.turnComplete) {
              safeSend({ type: "turnComplete" });
            }
          },
          onerror: (err: unknown) => {
            console.error("Gemini Live error:", err);
            if (liveSession) {
              safeSend({
                type: "error",
                message: getFriendlyErrorMessage(err),
              });
            }
          },
          onclose: () => {
            if (!isClosed && liveSession) {
              safeSend({ type: "closed" });
            }
          },
        },
      });

      if (isClosed || clientWs.readyState !== WebSocket.OPEN) {
        liveSession.close();
        liveSession = null;
        return;
      }
      safeSend({ type: "ready" });
    } catch (err) {
      console.error("Failed to connect Gemini Live:", err);
      safeSend({
        type: "error",
        message: getFriendlyErrorMessage(err),
      });
      clearInterval(pingInterval);
      clientWs.close(1011, "Gemini Live connection failed");
      return;
    }

    clientWs.on("message", (raw) => {
      if (isClosed || !liveSession) return;
      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          audio?: string;
          text?: string;
        };
        if (msg.type === "audio" && typeof msg.audio === "string" && msg.audio.length > 0) {
          liveSession.sendRealtimeInput({
            audio: {
              data: msg.audio,
              mimeType: "audio/pcm;rate=16000",
            },
          });
        } else if (msg.type === "text" && typeof msg.text === "string" && msg.text.trim()) {
          liveSession.sendRealtimeInput({
            text: msg.text.trim(),
          });
        }
      } catch (err) {
        console.error("Invalid client message:", err);
      }
    });

    const cleanup = () => {
      if (isClosed) return;
      isClosed = true;
      clearInterval(pingInterval);
      try {
        liveSession?.close();
      } catch {
        // Ignore close errors
      }
      liveSession = null;
    };

    clientWs.on("close", cleanup);
    clientWs.on("error", cleanup);
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, "dist");
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get("*", (_req, res) => {
        res.sendFile(path.join(distDir, "index.html"));
      });
    }
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`AI ROBOT server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Fatal server startup error:", err);
  process.exit(1);
});
