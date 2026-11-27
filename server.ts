
import "dotenv/config";
import express from "express";
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import {
  GoogleGenAI,
  Modality,
  type LiveServerMessage,
} from "@google/genai";
import { WebSocket, WebSocketServer } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === "production";

const ROBOT_SYSTEM_INSTRUCTION = `
You are AI ROBOT, a warm, friendly, intelligent multilingual voice assistant and interpreter.

LANGUAGE RULES:

1. Automatically detect the language being spoken.
Support Vietnamese, English, Chinese, Japanese, Korean, Thai, French, German, Spanish, and other major languages.

2. When one person speaks to you, reply naturally in exactly the same language.

3. When two people speak different languages to each other, automatically translate their conversation into the other person's language.

4. Preserve the meaning, tone, and politeness of each speaker.

5. Speak naturally and concisely. Do not read markdown symbols, URLs, or formatting aloud.

6. Do not ask users to select a language. Detect it automatically.
`;

function getFriendlyErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);

  if (
    /API_KEY_INVALID|API key not valid|401|403|PERMISSION_DENIED/i.test(msg)
  ) {
    return "Khóa API Gemini chưa hợp lệ hoặc thiếu quyền truy cập. Vui lòng kiểm tra GEMINI_API_KEY trên Render.";
  }

  if (/RESOURCE_EXHAUSTED|429|quota/i.test(msg)) {
    return "Gemini đang quá tải hoặc đã hết hạn mức. Vui lòng thử lại sau.";
  }

  if (/NOT_FOUND|404/i.test(msg)) {
    return "Không tìm thấy model AI. Vui lòng kiểm tra cấu hình Gemini.";
  }

  return "Không thể kết nối với AI ROBOT. Vui lòng kiểm tra mạng và thử lại.";
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
  });

  wss.on("connection", async (clientWs: WebSocket) => {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      clientWs.send(
        JSON.stringify({
          type: "error",
          message:
            "Chưa cấu hình GEMINI_API_KEY. Vui lòng thêm khóa API trên Render.",
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

    let liveSession:
      | Awaited<ReturnType<typeof ai.live.connect>>
      | null = null;

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

    try {
      liveSession = await ai.live.connect({
        model: "gemini-3.8-live",

        config: {
          responseModalities: [Modality.AUDIO],

          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Zephyr",
              },
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
              safeSend({
                type: "interrupted",
              });
            }

            if (content.turnComplete) {
              safeSend({
                type: "turnComplete",
              });
            }
          },

          onerror: (err: unknown) => {
            console.error("Gemini Live error:", err);

            safeSend({
              type: "error",
              message: getFriendlyErrorMessage(err),
            });
          },

          onclose: () => {
            if (!isClosed) {
              safeSend({
                type: "closed",
              });
            }
          },
        },
      });

      if (
        isClosed ||
        clientWs.readyState !== WebSocket.OPEN
      ) {
        liveSession.close();
        liveSession = null;
        return;
      }

      safeSend({
        type: "ready",
      });
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

        if (
          msg.type === "audio" &&
          typeof msg.audio === "string" &&
          msg.audio.length > 0
        ) {
          liveSession.sendRealtimeInput({
            audio: {
              data: msg.audio,
              mimeType: "audio/pcm;rate=16000",
            },
          });
        } else if (
          msg.type === "text" &&
          typeof msg.text === "string" &&
          msg.text.trim()
        ) {
          liveSession.sendRealtimeInput({
            text: msg.text.trim(),
          });
        }
      } catch (err) {
        console.error("Invalid client message:", err);
      }
    });
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import("vite");

    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
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
    console.log(
      `AI ROBOT server listening on http://0.0.0.0:${PORT}`
    );
  });
}

startServer().catch((err) => {
  console.error("Fatal server startup error:", err);
  process.exit(1);
});
