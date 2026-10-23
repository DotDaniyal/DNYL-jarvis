import "dotenv/config";
import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { initRoots, ROOTS } from "./server/agent/files";
import { listApps } from "./server/agent/apps";
import { integrationStatus, TOOL_DECLARATIONS, executeTool } from "./server/agent/tools";
import { imageFilePath } from "./server/agent/gemini";
import {
  executeCommand,
  resolveConfirmation,
  emergencyStop,
  getTaskHistory,
  getPendingConfirmation,
  TaskRecord,
} from "./server/agent/planner";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const MODEL_NAME = "gemini-3.8-live";

const DNYL_SYSTEM_INSTRUCTION = `You are DNYL, an advanced, futuristic, full laptop control AI assistant created and engineered by Daniyal.

CORE IDENTITY & PERSONALITY:
- Your name is DNYL. You were created and engineered by Daniyal.
- When asked who you are, what your name is, or who created you, clearly and proudly state that you are DNYL, a full laptop control personal AI assistant created by Daniyal.
- You are intelligent, calm, composed, articulate, helpful, confident, and respectful.
- Speak naturally and conversationally, as a real-time voice intelligence.
- Keep simple answers concise and direct (1 to 3 sentences). For complex technical, scientific, or conceptual questions, provide clear, well-structured spoken explanations.
- Avoid robotic filler or repetitive clichés such as "Certainly sir", "Of course sir", or "How may I assist you?" in every single response. Vary your phrasing naturally.
- Never format responses with heavy markdown symbols (like asterisks, code blocks, or bullet characters) that sound unnatural when spoken aloud.

AUTOMATIC LANGUAGE DETECTION & MULTILINGUAL FLUENCY:
- Automatically detect the language the user is speaking in every turn and respond in that same language.
- If the user speaks English (e.g., "Hello DNYL, how are you?"), respond naturally in English.
- If the user speaks Urdu or Roman Urdu (e.g., "Assalam o Alaikum, kya haal hai?" or "Mujhe batao JavaScript kya hai?"), respond naturally and fluently in conversational Urdu.
- If the user mixes Urdu and English (code-switching), respond naturally in the same conversational Urdu/English blend.
- If the user explicitly asks to switch languages (e.g., "Now explain it in English" or "Ab Urdu mein batao"), immediately switch to the requested language while keeping full context of what was just discussed.

OPEN CONVERSATION & CONTEXT RETENTION:
- You can discuss any topic: software engineering, operating system control, science, daily tasks, creative brainstorming, or casual conversation.
- Maintain full context across the conversation session so follow-up references are understood seamlessly.`;

function isApiKeyConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key.trim() !== "" && key !== "MY_GEMINI_API_KEY");
}

function createGenAIClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

async function startServer() {
  // Initialize safe user folders
  await initRoots();

  const app = express();
  const httpServer = createServer(app);

  app.use(express.json());

  // Health & configuration check endpoint
  app.get("/api/status", (_req, res) => {
    const configured = isApiKeyConfigured();
    res.json({
      configured,
      model: MODEL_NAME,
      name: "DNYL",
      creator: "Daniyal",
      message: configured
        ? "DNYL Live neural link & system agent ready."
        : "GEMINI_API_KEY is missing. Please configure GEMINI_API_KEY in the environment / .env file.",
    });
  });

  // System agent status: installed apps, safe roots, pending actions
  app.get("/api/agent/status", async (_req, res) => {
    try {
      const apps = await listApps();
      const integrations = await integrationStatus();
      const pending = getPendingConfirmation();
      res.json({
        ok: true,
        configured: isApiKeyConfigured(),
        roots: ROOTS,
        apps,
        integrations,
        pending,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // Pending sensitive/destructive action check
  app.get("/api/agent/pending", (_req, res) => {
    res.json({ ok: true, pending: getPendingConfirmation() });
  });

  // Recent task execution history
  app.get("/api/agent/history", (_req, res) => {
    res.json({ ok: true, history: getTaskHistory() });
  });

  // Execute a natural-language command (text or voice-to-text)
  app.post("/api/agent/command", async (req, res) => {
    const { command } = req.body || {};
    if (!command || typeof command !== "string" || !command.trim()) {
      return res.status(400).json({ ok: false, error: "Command text is required." });
    }

    try {
      const record = await executeCommand(command.trim());
      res.json({ ok: true, record });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // Confirm or cancel a pending sensitive/destructive action
  app.post("/api/agent/confirm", async (req, res) => {
    const { actionId, confirmed } = req.body || {};
    if (!actionId || typeof confirmed !== "boolean") {
      return res.status(400).json({ ok: false, error: "actionId and confirmed boolean are required." });
    }

    try {
      const result = await resolveConfirmation(actionId, confirmed);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // Emergency stop: terminates active child processes, aborts shutdown, stops media
  app.post("/api/agent/emergency-stop", async (_req, res) => {
    try {
      const result = await emergencyStop();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // Serve generated images securely from Pictures/DNYL
  app.get("/api/agent/image/:fileName", (req, res) => {
    const file = imageFilePath(req.params.fileName);
    if (!file) {
      return res.status(404).json({ ok: false, error: "Image not found." });
    }
    res.sendFile(file);
  });

  // WebSocket server for real-time bidirectional Gemini Live audio streaming & agent events
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      if (url.pathname === "/live") {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit("connection", ws, request);
        });
      }
    } catch {
      socket.destroy();
    }
  });

  wss.on("connection", async (clientWs: WebSocket, request) => {
    const sendToClient = (payload: Record<string, unknown>) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    if (!isApiKeyConfigured()) {
      sendToClient({
        type: "error",
        code: "MISSING_API_KEY",
        message:
          "Missing GEMINI_API_KEY environment variable. Configure your Gemini API key in the .env file.",
      });
      clientWs.close(1008, "Missing API key");
      return;
    }

    const url = new URL(request.url || "/live", `http://${request.headers.host || "localhost"}`);
    const requestedVoice = url.searchParams.get("voice") || "Charon";
    const allowedVoices = new Set(["Puck", "Charon", "Kore", "Fenrir", "Zephyr"]);
    const voiceName = allowedVoices.has(requestedVoice) ? requestedVoice : "Charon";

    let isClosed = false;
    const ai = createGenAIClient();

    let sessionPromise: Promise<any> | null = null;

    try {
      sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: DNYL_SYSTEM_INSTRUCTION,
          tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        },
        callbacks: {
          onopen: () => {
            sendToClient({
              type: "connected",
              model: MODEL_NAME,
              voice: voiceName,
            });
          },
          onmessage: (message: LiveServerMessage) => {
            if (isClosed) return;

            // Handle tool/function calls from Gemini Live
            const toolCall = (message as any).toolCall;
            if (toolCall?.functionCalls && sessionPromise) {
              sessionPromise.then(async (session) => {
                if (isClosed || !session) return;
                const functionResponses: any[] = [];
                for (const fc of toolCall.functionCalls) {
                  const toolName = fc.name;
                  const args = fc.args || {};
                  sendToClient({
                    type: "task_update",
                    task: {
                      id: `live-${Date.now()}`,
                      command: `${toolName}`,
                      timestamp: Date.now(),
                      status: "running",
                      steps: [{
                        toolName,
                        args,
                        description: `Executing ${toolName}`,
                        risk: "low",
                        status: "running",
                      }],
                    },
                  });
                  const result = await executeTool(toolName, args);
                  functionResponses.push({
                    id: fc.id,
                    name: toolName,
                    response: {
                      result: result.ok ? "success" : "failure",
                      message: result.message,
                      data: result.data,
                    },
                  });
                  sendToClient({
                    type: "task_complete",
                    task: {
                      id: `live-${Date.now()}`,
                      command: `${toolName}`,
                      timestamp: Date.now(),
                      status: result.ok ? "completed" : "failed",
                      steps: [{
                        toolName,
                        args,
                        description: `Executed ${toolName}`,
                        risk: "low",
                        status: result.ok ? "done" : "failed",
                        result,
                      }],
                      response: result.message,
                      speechResponse: result.speechResponse,
                    },
                  });
                }
                if (typeof (session as any).sendToolResponse === "function") {
                  (session as any).sendToolResponse({
                    functionResponses,
                  });
                } else if (typeof session.send === "function") {
                  session.send({
                    toolResponse: {
                      functionResponses,
                    },
                  } as any);
                }
              }).catch(() => {});
            }

            const serverContent = message.serverContent;
            if (!serverContent) return;

            // Handle interruption signal immediately
            if (serverContent.interrupted) {
              sendToClient({ type: "interrupted" });
            }

            // Forward audio and text parts from the model turn
            const parts = serverContent.modelTurn?.parts;
            if (parts && Array.isArray(parts)) {
              for (const part of parts) {
                if (part.inlineData?.data) {
                  sendToClient({
                    type: "audio",
                    audio: part.inlineData.data,
                  });
                }
                if (part.text) {
                  sendToClient({
                    type: "model_text",
                    text: part.text,
                  });
                }
              }
            }

            // Forward low-latency interim user speech transcription
            if (serverContent.interimInputTranscription?.text) {
              sendToClient({
                type: "input_transcription",
                text: serverContent.interimInputTranscription.text,
                finished: false,
                isInterim: true,
              });
            }

            // Forward final user speech transcription
            if (serverContent.inputTranscription?.text) {
              sendToClient({
                type: "input_transcription",
                text: serverContent.inputTranscription.text,
                finished: Boolean(serverContent.inputTranscription.finished),
                isInterim: false,
              });
            }

            // Forward DNYL speech transcription
            if (serverContent.outputTranscription?.text) {
              sendToClient({
                type: "output_transcription",
                text: serverContent.outputTranscription.text,
                finished: Boolean(serverContent.outputTranscription.finished),
              });
            }

            // Notify when turn generation is complete
            if (serverContent.turnComplete) {
              sendToClient({ type: "turn_complete" });
            }
          },
          onerror: (err: any) => {
            if (isClosed) return;
            const rawMsg = err?.message || String(err || "Unknown Live API error");
            sendToClient({
              type: "error",
              code: "GEMINI_LIVE_ERROR",
              message: rawMsg.includes("API_KEY") || rawMsg.includes("403")
                ? "Invalid or unauthorized Gemini API key. Check .env file."
                : "Unable to connect to DNYL Live session.",
              details: rawMsg,
            });
          },
          onclose: (event: any) => {
            if (isClosed) return;
            sendToClient({
              type: "session_closed",
              reason: event?.reason || "DNYL Live session closed.",
            });
          },
        },
      });

      await sessionPromise;
    } catch (err: any) {
      const rawMsg = err?.message || String(err || "Connection failed");
      sendToClient({
        type: "error",
        code: "GEMINI_CONNECTION_FAILED",
        message: "Unable to connect to DNYL Live session.",
        details: rawMsg,
      });
      clientWs.close(1011, "Gemini Live connection failed");
      return;
    }

    clientWs.on("message", async (rawData) => {
      if (isClosed) return;
      try {
        const msg = JSON.parse(rawData.toString());

        if (msg.type === "ping") {
          sendToClient({ type: "pong" });
          return;
        }

        // Agent command over WebSocket with real-time streaming progress
        if (msg.type === "agent_command" && typeof msg.command === "string") {
          executeCommand(msg.command, (task: TaskRecord) => {
            sendToClient({ type: "task_update", task });
          }).then((task) => {
            sendToClient({ type: "task_complete", task });
          }).catch((err) => {
            sendToClient({ type: "task_error", error: err?.message || String(err) });
          });
          return;
        }

        // Agent action confirmation over WebSocket
        if (msg.type === "agent_confirm" && typeof msg.actionId === "string") {
          resolveConfirmation(msg.actionId, Boolean(msg.confirmed), (task: TaskRecord) => {
            sendToClient({ type: "task_update", task });
          }).then((res) => {
            sendToClient({ type: "confirm_result", ...res });
          });
          return;
        }

        // Emergency stop over WebSocket
        if (msg.type === "emergency_stop") {
          emergencyStop().then((res) => {
            sendToClient({ type: "emergency_stop_result", ...res });
          });
          return;
        }

        // Audio streaming to Gemini Live
        if (msg.type === "audio" && typeof msg.audio === "string" && sessionPromise) {
          sessionPromise
            .then((session) => {
              if (!isClosed && session) {
                session.sendRealtimeInput({
                  audio: {
                    data: msg.audio,
                    mimeType: "audio/pcm;rate=16000",
                  },
                });
              }
            })
            .catch(() => {});
        } else if (msg.type === "text" && typeof msg.text === "string" && sessionPromise) {
          sessionPromise
            .then((session) => {
              if (!isClosed && session) {
                session.sendRealtimeInput({
                  text: msg.text,
                });
              }
            })
            .catch(() => {});
        }
      } catch {
        // Ignore malformed JSON frames
      }
    });

    const cleanup = () => {
      if (isClosed) return;
      isClosed = true;
      if (sessionPromise) {
        sessionPromise
          .then((session) => {
            try {
              session?.close();
            } catch {
              // Ignore close errors
            }
          })
          .catch(() => {});
      }
    };

    clientWs.on("close", cleanup);
    clientWs.on("error", cleanup);
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`DNYL Live Server & Desktop Agent listening on http://localhost:${PORT} (Created by Daniyal)`);
  });
}

startServer();
