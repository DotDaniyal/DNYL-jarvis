import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import { ROOTS } from "./files";

export function geminiKeyConfigured() {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key.trim() !== "" && key !== "MY_GEMINI_API_KEY");
}

export function genai() {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

export const IMAGE_MODELS = (process.env.DNYL_IMAGE_MODELS || "gemini-3.1-flash-image,gemini-2.5-flash-image,gemini-3-pro-image")
  .split(",").map((s) => s.trim()).filter(Boolean);

export function imageDir() {
  return path.join(ROOTS.pictures || process.cwd(), "DNYL");
}

/** Turns raw Gemini API errors into user-friendly explanations. */
export function explainGeminiError(err: unknown): string {
  const msg = String((err as any)?.message || err || "");
  if (/RESOURCE_EXHAUSTED|429|quota/i.test(msg)) {
    if (/limit: 0/.test(msg)) return "Your Gemini API key has no quota for this model (free tier limit is 0). Enable billing for the key in Google AI Studio to use it.";
    return "Gemini API quota exceeded. Wait for the quota to reset or enable billing in Google AI Studio.";
  }
  if (/API_KEY|403|permission|unauth/i.test(msg)) return "The Gemini API key is invalid or not authorized for this model.";
  if (/503|overloaded|high demand|UNAVAILABLE/i.test(msg)) return "The Gemini model is temporarily overloaded. Try again in a moment.";
  if (/404|not found/i.test(msg)) return "This Gemini model is not available to your API key.";
  return msg.slice(0, 240) || "Unknown Gemini error.";
}

export const AGENT_MODELS = (process.env.DNYL_AGENT_MODELS || "gemini-3.5-flash,gemini-flash-lite-latest,gemini-3.8-flash")
  .split(",").map((s) => s.trim()).filter(Boolean);

export async function webResearch(query: string) {
  if (!geminiKeyConfigured()) throw new Error("Web research requires GEMINI_API_KEY. Use google_search to open results in the browser instead.");
  let lastErr: unknown;
  for (const model of AGENT_MODELS) {
    try {
      const r = await genai().models.generateContent({
        model,
        contents: `Research this using Google Search and give a concise, factual summary with key points: ${query}`,
        config: { tools: [{ googleSearch: {} }] },
      });
      const chunks = r.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const sources = chunks.map((c) => ({ title: c.web?.title || "", url: c.web?.uri || "" })).filter((s) => s.url).slice(0, 8);
      return { summary: (r.text || "").slice(0, 6000), sources };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Web research failed: ${explainGeminiError(lastErr)}`);
}

export async function generateImage(prompt: string) {
  if (!geminiKeyConfigured()) throw new Error("GEMINI_API_KEY is not configured, so image generation is unavailable.");
  const ai = genai();
  const errors: string[] = [];
  for (const model of IMAGE_MODELS) {
    try {
      const r = await ai.models.generateContent({ model, contents: `Generate an image: ${prompt}` });
      const parts = r.candidates?.[0]?.content?.parts || [];
      const img = parts.find((p) => p.inlineData?.data && p.inlineData.mimeType?.startsWith("image/"));
      if (!img?.inlineData?.data) {
        errors.push(`${model}: no image returned`);
        continue;
      }
      const ext = img.inlineData.mimeType === "image/jpeg" ? "jpg" : "png";
      const dir = imageDir();
      await fsp.mkdir(dir, { recursive: true });
      const fileName = `dnyl-${Date.now()}.${ext}`;
      const filePath = path.join(dir, fileName);
      await fsp.writeFile(filePath, Buffer.from(img.inlineData.data, "base64"));
      const caption = parts.find((p) => p.text)?.text?.trim();
      return { model, fileName, filePath, caption };
    } catch (e) {
      errors.push(`${model}: ${explainGeminiError(e)}`);
    }
  }
  throw new Error(`Image generation failed with every configured model. ${errors.join(" | ")}`);
}

export function imageFilePath(fileName: string): string | null {
  if (!/^dnyl-\d+\.(png|jpg)$/.test(fileName)) return null;
  const p = path.join(imageDir(), fileName);
  return fs.existsSync(p) ? p : null;
}

/** Extracts text from a PDF/DOCX using Gemini document understanding. */
export async function extractDocumentText(filePath: string, size: number) {
  if (!geminiKeyConfigured()) throw new Error("Reading PDF/DOCX requires GEMINI_API_KEY.");
  if (size > 15 * 1024 * 1024) throw new Error("Document is larger than 15 MB.");
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = ext === ".pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const data = (await fsp.readFile(filePath)).toString("base64");
  let lastErr: unknown;
  for (const model of AGENT_MODELS) {
    try {
      const r = await genai().models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ inlineData: { mimeType, data } }, { text: "Extract the readable text of this document (max ~8000 characters). Output only the text." }] }],
      });
      return (r.text || "").slice(0, 10000);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(explainGeminiError(lastErr));
}
