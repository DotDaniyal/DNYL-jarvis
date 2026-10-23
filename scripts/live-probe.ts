/**
 * Live pipeline probe: streams a 16 kHz mono PCM WAV to ws://localhost:3000/live
 * exactly like the browser does, then logs every message type the server returns.
 *
 *   npx tsx scripts/live-probe.ts path/to/speech.wav [seconds]
 */
import fs from "fs";
import WebSocket from "ws";

const wavPath = process.argv[2];
const waitSec = Number(process.argv[3] || 25);
if (!wavPath) {
  console.error("Usage: npx tsx scripts/live-probe.ts <16k-mono-wav> [seconds]");
  process.exit(1);
}

const buf = fs.readFileSync(wavPath);
const dataIdx = buf.indexOf(Buffer.from("data"));
const pcm = buf.subarray(dataIdx + 8);
const ws = new WebSocket("ws://localhost:3000/live?voice=Charon");
const t0 = Date.now();
const log = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
const counts: Record<string, number> = {};

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  counts[msg.type] = (counts[msg.type] || 0) + 1;
  if (msg.type === "audio") {
    if (counts.audio === 1) log("audio (first chunk)");
    return;
  }
  const brief = JSON.stringify(msg).slice(0, 260);
  log(brief);
  if (msg.type === "connected") streamAudio();
});
ws.on("close", (c, r) => log(`ws closed ${c} ${r}`));
ws.on("error", (e) => log(`ws error ${e.message}`));

async function streamAudio() {
  const chunk = 2048 * 2; // 2048 samples, 16-bit
  for (let i = 0; i < pcm.length; i += chunk) {
    ws.send(JSON.stringify({ type: "audio", audio: pcm.subarray(i, i + chunk).toString("base64") }));
    await new Promise((r) => setTimeout(r, 128));
  }
  // trailing silence so server-side VAD detects end of turn
  const silence = Buffer.alloc(chunk).toString("base64");
  for (let i = 0; i < 20; i++) {
    ws.send(JSON.stringify({ type: "audio", audio: silence }));
    await new Promise((r) => setTimeout(r, 128));
  }
  log("finished streaming audio");
}

setTimeout(() => {
  log(`summary: ${JSON.stringify(counts)}`);
  ws.close();
  process.exit(0);
}, waitSec * 1000);
