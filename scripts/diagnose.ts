/**
 * DNYL diagnostics: verifies the configured Gemini key, lists models the key can
 * use, and probes the configured agent + live models. Never prints the API key.
 *
 *   npm run diagnose
 */
import "dotenv/config";
import { GoogleGenAI, Modality } from "@google/genai";

const key = process.env.GEMINI_API_KEY || "";
const mask = (s: string) => (s ? `${s.slice(0, 4)}…(${s.length} chars)` : "<missing>");

async function listModels() {
  const out: { name: string; methods: string[] }[] = [];
  let pageToken = "";
  do {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const res = await fetch(url, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`ListModels HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json: any = await res.json();
    for (const m of json.models || []) out.push({ name: String(m.name).replace(/^models\//, ""), methods: m.supportedGenerationMethods || [] });
    pageToken = json.nextPageToken || "";
  } while (pageToken);
  return out;
}

async function probeGenerate(ai: GoogleGenAI, model: string) {
  const t = Date.now();
  try {
    const r = await ai.models.generateContent({ model, contents: "Reply with the single word: pong" });
    return `OK (${Date.now() - t} ms): ${(r.text || "").trim().slice(0, 40)}`;
  } catch (e: any) {
    return `FAIL: ${String(e?.message || e).slice(0, 200)}`;
  }
}

async function probeLive(ai: GoogleGenAI, model: string) {
  return new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve("FAIL: timed out after 12s"), 12000);
    ai.live
      .connect({
        model,
        config: { responseModalities: [Modality.AUDIO] },
        callbacks: {
          onopen: () => {},
          onmessage: () => {},
          onerror: (e: any) => {
            clearTimeout(timer);
            resolve(`FAIL (onerror): ${String(e?.message || e).slice(0, 200)}`);
          },
          onclose: (e: any) => {
            clearTimeout(timer);
            resolve(`CLOSED: code=${e?.code} reason=${String(e?.reason || "").slice(0, 200)}`);
          },
        },
      })
      .then((session) => {
        // Give the server a moment to reject the setup message (invalid model closes the socket).
        setTimeout(() => {
          clearTimeout(timer);
          try { session.close(); } catch { /* closing probe session */ }
          resolve("OK: session established");
        }, 2500);
      })
      .catch((e: any) => {
        clearTimeout(timer);
        resolve(`FAIL: ${String(e?.message || e).slice(0, 200)}`);
      });
  });
}

async function main() {
  console.log(`GEMINI_API_KEY: ${mask(key)}`);
  if (!key || key === "MY_GEMINI_API_KEY") {
    console.log("No usable key configured. Set GEMINI_API_KEY in .env.");
    process.exit(1);
  }
  const ai = new GoogleGenAI({ apiKey: key });

  let models: { name: string; methods: string[] }[] = [];
  try {
    models = await listModels();
    const gen = models.filter((m) => m.methods.includes("generateContent")).map((m) => m.name);
    const live = models.filter((m) => m.methods.includes("bidiGenerateContent")).map((m) => m.name);
    console.log(`\nModels with generateContent (${gen.length}):\n  ${gen.join("\n  ")}`);
    console.log(`\nModels with bidiGenerateContent / Live (${live.length}):\n  ${live.join("\n  ") || "(none)"}`);
  } catch (e: any) {
    console.log(`ListModels failed: ${e?.message || e}`);
  }

  const agentModels = (process.env.DNYL_AGENT_MODELS || process.argv[2] || "").split(",").map((s) => s.trim()).filter(Boolean);
  const candidates = agentModels.length
    ? agentModels
    : ["gemini-3.5-flash", "gemini-flash-lite-latest", "gemini-3.8-flash", "gemini-flash-latest", "gemini-2.5-flash"];
  console.log("\nProbing generateContent:");
  for (const m of candidates) console.log(`  ${m}: ${await probeGenerate(ai, m)}`);

  const liveModel = process.env.DNYL_LIVE_MODEL || "gemini-3.8-live";
  console.log(`\nProbing Live API with ${liveModel}:`);
  console.log(`  ${await probeLive(ai, liveModel)}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Diagnostics crashed:", e?.message || e);
  process.exit(1);
});
