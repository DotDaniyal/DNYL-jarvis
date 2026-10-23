import { GoogleGenAI, GenerateContentConfig } from "@google/genai";
import {
  TOOL_DECLARATIONS,
  executeTool,
  classifyRisk,
  describeCall,
  Risk,
  ToolResult,
} from "./tools";
import { AGENT_MODELS, explainGeminiError, geminiKeyConfigured } from "./gemini";
import { killAllActiveProcesses } from "./ps";
import { powerAction, mediaKey } from "./system";
import { routeDirectIntent, detectLanguage } from "./router";

export interface PendingAction {
  id: string;
  toolName: string;
  args: Record<string, any>;
  risk: Risk;
  description: string;
  createdAt: number;
  command: string;
}

export interface TaskStep {
  toolName: string;
  args: Record<string, any>;
  description: string;
  risk: Risk;
  result?: ToolResult;
  status: "pending" | "running" | "done" | "failed" | "awaiting_confirmation" | "cancelled";
}

export interface TaskRecord {
  id: string;
  command: string;
  timestamp: number;
  status: "running" | "awaiting_confirmation" | "completed" | "failed" | "cancelled";
  steps: TaskStep[];
  response?: string;
  speechResponse?: string;
  image?: { fileName: string; filePath: string; model: string; prompt: string };
  error?: string;
}

const taskHistory: TaskRecord[] = [];
let pendingConfirmation: PendingAction | null = null;
const DEDUP_WINDOW_MS = 4500;

export function getTaskHistory(limit = 30): TaskRecord[] {
  return taskHistory.slice(-limit);
}

export function clearTaskHistoryForTest(): void {
  taskHistory.length = 0;
  pendingConfirmation = null;
}

export function isDuplicateCommand(
  command: string,
  windowMs = DEDUP_WINDOW_MS
): { isDuplicate: boolean; previousTask?: TaskRecord } {
  const norm = command.trim().toLowerCase();
  if (!norm) return { isDuplicate: false };
  const now = Date.now();
  for (let i = taskHistory.length - 1; i >= 0; i--) {
    const prev = taskHistory[i];
    if (now - prev.timestamp > windowMs) break;
    if (prev.command.trim().toLowerCase() === norm) {
      return { isDuplicate: true, previousTask: prev };
    }
  }
  return { isDuplicate: false };
}

export function getPendingConfirmation(): PendingAction | null {
  return pendingConfirmation;
}

export async function emergencyStop(): Promise<{ ok: boolean; message: string; killed: number }> {
  const killed = killAllActiveProcesses();
  pendingConfirmation = null;
  // Attempt to cancel any pending Windows shutdown
  await powerAction("cancel_shutdown").catch(() => {});
  // Stop media playback
  await mediaKey("stop").catch(() => {});

  const rec: TaskRecord = {
    id: `stop-${Date.now()}`,
    command: "EMERGENCY_STOP",
    timestamp: Date.now(),
    status: "completed",
    steps: [],
    response: `Emergency Stop activated. ${killed} background process(es) terminated, pending shutdown cancelled, media halted.`,
    speechResponse: "Emergency Stop activated. All background tasks and media halted.",
  };
  taskHistory.push(rec);

  return {
    ok: true,
    message: rec.response!,
    killed,
  };
}

const DNYL_SYSTEM_INSTRUCTION = `You are JARVIS / DNYL, an advanced, system-level Personal AI Assistant running locally on the user's laptop, created and engineered by Daniyal.

CORE OBJECTIVE:
You act as an operating system agent that automates tasks, controls hardware, launches applications, manages media, searches the web, organizes files, and assists the user seamlessly on their Windows laptop.

CRITICAL RULES:
1. ACTION OVER EXPLANATION:
When the user gives a command (e.g. "Play a song", "YouTube par Atif Aslam ka gaana chalao", "What is the weather right now", "Aaj Karachi ka weather batao", "Open Chrome and search for latest AI news", "Open my Downloads folder", "Shut down my laptop"), call the appropriate tool IMMEDIATELY.
DO NOT tell the user how to do it manually. Execute the task using the real integrations:
- For weather requests, call weather_current or weather_forecast.
- For YouTube/music requests, call youtube_play or spotify_play.
- For Chrome searches or browsing, call browser_search or browser_open.

2. MULTI-STEP REASONING:
If a user request requires multiple steps (e.g. "Open Chrome and search for gaming laptops", or "Open notepad and write a draft"), call the required tools in logical order.

3. SAFETY & POWER MANAGEMENT:
For destructive actions like shutdown and restart, the system will automatically require user confirmation before execution. Clearly acknowledge the request and warn the user.

4. MULTILINGUAL FLUENCY:
Respond in the language the user used (English, Urdu, or Roman Urdu).
Examples:
- "YouTube par Atif Aslam ka gaana chalao" -> Call youtube_play with query "Atif Aslam", and respond in natural conversational Urdu.
- "Aaj Karachi ka weather batao" -> Call weather_current with location "Karachi".
- "Chrome kholo aur Google par search karo" -> Call browser_search with the search query.

5. CONCISE & POLITE:
Keep spoken and textual responses natural, confident, composed, and concise. Never say music is playing unless verified.`;

/**
 * Generates an appropriate spoken/textual response in the user's language based on tool execution.
 */
function formatNaturalResponse(
  toolName: string,
  result: ToolResult,
  lang: "en" | "ur" | "roman_ur",
  command: string
): { response: string; speechResponse: string } {
  if (result.speechResponse) {
    return {
      response: result.message,
      speechResponse: result.speechResponse,
    };
  }

  if (!result.ok) {
    const errorMsg = result.message || "Action could not be completed.";
    const speech = lang === "en"
      ? `Sorry, ${errorMsg}`
      : `Maaf kijiye, ye kaam mukammal nahi ho saka: ${errorMsg}`;
    return { response: errorMsg, speechResponse: speech };
  }

  // Success responses tailored to language
  if (lang === "ur" || lang === "roman_ur") {
    switch (toolName) {
      case "weather_current":
        return {
          response: result.message,
          speechResponse: `Mausam ki tafseel haasil kar li gayi hai.`,
        };
      case "youtube_play":
        return {
          response: result.message,
          speechResponse: `YouTube par gaana chala diya gaya hai.`,
        };
      case "browser_search":
        return {
          response: result.message,
          speechResponse: `Maine Google par search kar diya hai.`,
        };
      case "open_app":
        return {
          response: result.message,
          speechResponse: `Application khol di gayi hai.`,
        };
      case "open_folder":
        return {
          response: result.message,
          speechResponse: `Folder open kar diya gaya hai.`,
        };
      case "power_action":
        return {
          response: result.message,
          speechResponse: result.message,
        };
      default:
        return {
          response: result.message,
          speechResponse: result.message,
        };
    }
  }

  return {
    response: result.message,
    speechResponse: result.message,
  };
}

/**
 * Executes a user command using the hybrid intent-router and function-calling agent engine.
 */
export async function executeCommand(
  command: string,
  onProgress?: (task: TaskRecord) => void
): Promise<TaskRecord> {
  // Deduplicate rapid identical dispatches within 4.5 seconds
  const dedup = isDuplicateCommand(command);
  if (dedup.isDuplicate && dedup.previousTask) {
    onProgress?.(dedup.previousTask);
    return dedup.previousTask;
  }

  const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const record: TaskRecord = {
    id: taskId,
    command: command.trim(),
    timestamp: Date.now(),
    status: "running",
    steps: [],
  };
  taskHistory.push(record);
  onProgress?.(record);

  const lang = detectLanguage(command);

  // ───────────────────────── STEP 1: Direct High-Accuracy Intent Routing ─────────────────────────
  // Evaluates high-priority and clear commands (weather, youtube, chrome, system, apps) immediately
  const directMatch = routeDirectIntent(command);

  if (directMatch) {
    const toolName = directMatch.toolName;
    const args = directMatch.args;
    const risk = classifyRisk(toolName, args);
    const description = describeCall(toolName, args);

    const step: TaskStep = {
      toolName,
      args,
      description,
      risk,
      status: "running",
    };
    record.steps.push(step);
    onProgress?.(record);

    // Destructive actions MUST receive user confirmation first
    if (risk === "destructive") {
      const actionId = `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      pendingConfirmation = {
        id: actionId,
        toolName,
        args,
        risk,
        description,
        createdAt: Date.now(),
        command,
      };
      step.status = "awaiting_confirmation";
      record.status = "awaiting_confirmation";
      record.response = `Confirmation required: ${description}. Please confirm or cancel to proceed.`;
      record.speechResponse = lang === "en"
        ? `Confirmation required: ${description}. Please confirm to proceed.`
        : `Confirmation darkaar hai: ${description}. Kya aap aage barhna chahte hain?`;
      onProgress?.(record);
      return record;
    }

    // Execute direct tool
    const result = await executeTool(toolName, args);
    step.result = result;
    step.status = result.ok ? "done" : "failed";

    if (result.image) {
      record.image = result.image;
    }

    const { response, speechResponse } = formatNaturalResponse(toolName, result, lang, command);
    record.response = response;
    record.speechResponse = speechResponse;
    record.status = result.ok ? "completed" : "failed";
    if (!result.ok) {
      record.error = result.message;
    }
    onProgress?.(record);
    return record;
  }

  // ───────────────────────── STEP 2: Multi-step Reasoning via Gemini Function Calling ─────────────────────────
  if (!geminiKeyConfigured()) {
    record.status = "failed";
    record.error = "GEMINI_API_KEY is not configured in the environment / .env file.";
    record.response = "Please configure your GEMINI_API_KEY in the .env file to enable smart reasoning.";
    record.speechResponse = "Gemini API key is missing. Please configure it in the environment.";
    onProgress?.(record);
    return record;
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const contents: any[] = [{ role: "user", parts: [{ text: command }] }];

  const config: GenerateContentConfig = {
    systemInstruction: DNYL_SYSTEM_INSTRUCTION,
    tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
  };

  let chosenModel = AGENT_MODELS[0];
  let loopCount = 0;
  const MAX_LOOPS = 6;

  try {
    while (loopCount < MAX_LOOPS) {
      loopCount++;

      let response: any = null;
      let lastError: any = null;

      // Try available models in order
      for (const model of AGENT_MODELS) {
        try {
          response = await ai.models.generateContent({
            model,
            contents,
            config,
          });
          chosenModel = model;
          break;
        } catch (err) {
          lastError = err;
        }
      }

      if (!response) {
        throw new Error(explainGeminiError(lastError));
      }

      const candidate = response.candidates?.[0];
      const content = candidate?.content;
      if (!content) {
        break;
      }

      contents.push(content);

      const functionCalls = response.functionCalls;
      if (!functionCalls || functionCalls.length === 0) {
        const text = response.text || "";
        record.response = text.trim();
        record.speechResponse = text.trim();
        record.status = "completed";
        onProgress?.(record);
        break;
      }

      // Execute each tool call proposed by the model
      const toolResponses: any[] = [];

      for (const fc of functionCalls) {
        const toolName = fc.name;
        const args = (fc.args || {}) as Record<string, any>;
        const risk = classifyRisk(toolName, args);
        const description = describeCall(toolName, args);

        const step: TaskStep = {
          toolName,
          args,
          description,
          risk,
          status: "running",
        };
        record.steps.push(step);
        onProgress?.(record);

        // Destructive actions MUST receive user confirmation first
        if (risk === "destructive") {
          const actionId = `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          pendingConfirmation = {
            id: actionId,
            toolName,
            args,
            risk,
            description,
            createdAt: Date.now(),
            command,
          };
          step.status = "awaiting_confirmation";
          record.status = "awaiting_confirmation";
          record.response = `Confirmation required: ${description}. Please confirm or cancel to proceed.`;
          record.speechResponse = `Confirmation required: ${description}.`;
          onProgress?.(record);
          return record;
        }

        // Execute safe or sensitive action
        const result = await executeTool(toolName, args);
        step.result = result;
        step.status = result.ok ? "done" : "failed";

        if (result.image) {
          record.image = result.image;
        }

        if (result.speechResponse && !record.speechResponse) {
          record.speechResponse = result.speechResponse;
        }

        toolResponses.push({
          name: toolName,
          response: {
            result: result.ok ? "success" : "failure",
            message: result.message,
            data: result.data,
          },
        });
        onProgress?.(record);
      }

      // Supply tool results back to the model for next turn/summary
      contents.push({
        role: "user",
        parts: toolResponses.map((tr) => ({
          functionResponse: tr,
        })),
      });
    }

    if (record.status === "running") {
      record.status = "completed";
      if (!record.response && record.steps.length > 0) {
        const lastStep = record.steps[record.steps.length - 1];
        record.response = lastStep.result?.message || "Task completed successfully.";
        record.speechResponse = lastStep.result?.speechResponse || record.response;
      }
      onProgress?.(record);
    }
  } catch (err: any) {
    record.status = "failed";
    record.error = err?.message || String(err);
    record.response = `Task could not be completed: ${record.error}`;
    record.speechResponse = "Task could not be completed.";
    onProgress?.(record);
  }

  return record;
}

/**
 * Handles confirmation / cancellation of a pending sensitive/destructive action.
 */
export async function resolveConfirmation(
  actionId: string,
  confirmed: boolean,
  onProgress?: (task: TaskRecord) => void
): Promise<{ ok: boolean; message: string; record?: TaskRecord }> {
  if (!pendingConfirmation || pendingConfirmation.id !== actionId) {
    return { ok: false, message: "No matching pending confirmation found or it has already expired." };
  }

  const action = pendingConfirmation;
  pendingConfirmation = null;

  // Find corresponding task record
  const record = taskHistory.find((t) => t.status === "awaiting_confirmation") || {
    id: `task-${Date.now()}`,
    command: action.command,
    timestamp: Date.now(),
    status: "running",
    steps: [],
  };

  const pendingStep = record.steps.find((s) => s.status === "awaiting_confirmation");

  if (!confirmed) {
    if (pendingStep) pendingStep.status = "cancelled";
    record.status = "cancelled";
    record.response = `Action "${action.description}" was cancelled by the user.`;
    record.speechResponse = "Action cancelled.";
    onProgress?.(record);
    return { ok: true, message: record.response, record };
  }

  // Execute the confirmed action
  if (pendingStep) pendingStep.status = "running";
  record.status = "running";
  onProgress?.(record);

  const result = await executeTool(action.toolName, action.args);
  if (pendingStep) {
    pendingStep.result = result;
    pendingStep.status = result.ok ? "done" : "failed";
  }

  record.status = result.ok ? "completed" : "failed";
  record.response = result.message;
  record.speechResponse = result.speechResponse || result.message;
  onProgress?.(record);

  return { ok: result.ok, message: result.message, record };
}
