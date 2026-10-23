import os from "os";
import dns from "dns/promises";
import net from "net";
import { runPowerShell, USER32_TYPE } from "./ps";

// ───────────────────────── Power management ─────────────────────────
export type PowerAction = "shutdown" | "restart" | "sleep" | "lock" | "cancel_shutdown";
export const SHUTDOWN_DELAY_SECONDS = 60;

export async function powerAction(action: PowerAction) {
  const scripts: Record<PowerAction, string> = {
    // 60s delay gives the user a last chance to save work or cancel (Emergency Stop runs shutdown /a).
    shutdown: `shutdown.exe /s /t ${SHUTDOWN_DELAY_SECONDS} /c "DNYL: shutting down in ${SHUTDOWN_DELAY_SECONDS} seconds. Save your work."`,
    restart: `shutdown.exe /r /t ${SHUTDOWN_DELAY_SECONDS} /c "DNYL: restarting in ${SHUTDOWN_DELAY_SECONDS} seconds. Save your work."`,
    sleep: `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false) | Out-Null`,
    lock: `rundll32.exe user32.dll,LockWorkStation`,
    cancel_shutdown: `shutdown.exe /a; if ($LASTEXITCODE -eq 1116) { 'none' } elseif ($LASTEXITCODE -ne 0) { throw "shutdown /a failed ($LASTEXITCODE)" } else { 'cancelled' }`,
  };
  const r = await runPowerShell(scripts[action]);
  if (r.code !== 0) return { ok: false, message: `Power action "${action}" failed: ${r.stderr}` };
  const messages: Record<PowerAction, string> = {
    shutdown: `Shutdown scheduled in ${SHUTDOWN_DELAY_SECONDS} seconds. Say "cancel shutdown" or press Emergency Stop to abort.`,
    restart: `Restart scheduled in ${SHUTDOWN_DELAY_SECONDS} seconds. Say "cancel shutdown" or press Emergency Stop to abort.`,
    sleep: "Sleep command sent.",
    lock: "Screen locked.",
    cancel_shutdown: r.stdout.includes("none") ? "There was no pending shutdown or restart." : "Pending shutdown/restart cancelled.",
  };
  return { ok: true, message: messages[action] };
}

// ───────────────────────── System info ─────────────────────────
export async function systemInfo() {
  const r = await runPowerShell(
    `$b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
     $c = Get-PSDrive -Name C -ErrorAction SilentlyContinue
     @{ battery = if ($b) { $b.EstimatedChargeRemaining } else { $null }; charging = if ($b) { $b.BatteryStatus -eq 2 } else { $null };
        diskFreeGB = if ($c) { [math]::Round($c.Free/1GB,1) } else { $null }; diskUsedGB = if ($c) { [math]::Round($c.Used/1GB,1) } else { $null } } | ConvertTo-Json -Compress`
  );
  let extra: Record<string, unknown> = {};
  try {
    extra = JSON.parse(r.stdout);
  } catch {
    /* ignore */
  }
  return {
    os: `${os.type()} ${os.release()}`,
    hostname: os.hostname(),
    cpu: os.cpus()[0]?.model,
    cores: os.cpus().length,
    totalMemoryGB: +(os.totalmem() / 1073741824).toFixed(1),
    freeMemoryGB: +(os.freemem() / 1073741824).toFixed(1),
    uptimeHours: +(os.uptime() / 3600).toFixed(1),
    batteryPercent: extra.battery ?? null,
    charging: extra.charging ?? null,
    diskFreeGB: extra.diskFreeGB ?? null,
    diskUsedGB: extra.diskUsedGB ?? null,
    localTime: new Date().toString(),
  };
}

// ───────────────────────── Media keys ─────────────────────────
export type MediaAction = "play_pause" | "next" | "previous" | "stop" | "volume_up" | "volume_down" | "mute";
const VK: Record<MediaAction, number> = { play_pause: 0xb3, next: 0xb0, previous: 0xb1, stop: 0xb2, volume_up: 0xaf, volume_down: 0xae, mute: 0xad };

export async function mediaKey(action: MediaAction, steps = 1) {
  const n = action.startsWith("volume") ? Math.max(1, Math.min(25, Math.round(steps))) : 1;
  const r = await runPowerShell(`${USER32_TYPE} for ($i=0; $i -lt [int]$env:DNYL_N; $i++) { [DnylNative]::Key([byte]$env:DNYL_VK); Start-Sleep -Milliseconds 40 }`, {
    DNYL_VK: String(VK[action]),
    DNYL_N: String(n),
  });
  if (r.code !== 0) return { ok: false, message: `Media key failed: ${r.stderr}` };
  return { ok: true, message: `Sent system media key "${action}"${n > 1 ? ` x${n} (~${n * 2}%)` : ""}. This controls whichever app owns media playback (e.g. Spotify).` };
}

// ───────────────────────── Keyboard & mouse ─────────────────────────
const KEY_COMBOS: Record<string, string> = {
  enter: "{ENTER}", tab: "{TAB}", escape: "{ESC}", backspace: "{BACKSPACE}", delete: "{DEL}", space: " ",
  up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}", home: "{HOME}", end: "{END}",
  page_up: "{PGUP}", page_down: "{PGDN}", f5: "{F5}", f11: "{F11}",
  "ctrl+c": "^c", "ctrl+v": "^v", "ctrl+x": "^x", "ctrl+a": "^a", "ctrl+z": "^z", "ctrl+y": "^y",
  "ctrl+s": "^s", "ctrl+f": "^f", "ctrl+n": "^n", "ctrl+t": "^t", "ctrl+w": "^w", "ctrl+l": "^l",
  "ctrl+tab": "^{TAB}", "ctrl+shift+tab": "^+{TAB}", "alt+tab": "%{TAB}", "ctrl+plus": "^{ADD}", "ctrl+minus": "^{SUBTRACT}",
};
export const ALLOWED_KEYS = Object.keys(KEY_COMBOS);

export async function pressKeys(combo: string, times = 1) {
  const seq = KEY_COMBOS[combo.toLowerCase().replace(/\s+/g, "")];
  if (!seq) return { ok: false, message: `Key combination "${combo}" is not on the allowlist. Allowed: ${ALLOWED_KEYS.join(", ")}` };
  const n = Math.max(1, Math.min(20, Math.round(times)));
  const r = await runPowerShell(
    `Add-Type -AssemblyName System.Windows.Forms; for ($i=0; $i -lt [int]$env:DNYL_N; $i++) { [System.Windows.Forms.SendKeys]::SendWait($env:DNYL_K); Start-Sleep -Milliseconds 60 }`,
    { DNYL_K: seq, DNYL_N: String(n) }
  );
  if (r.code !== 0) return { ok: false, message: `Key press failed: ${r.stderr}` };
  return { ok: true, message: `Pressed ${combo}${n > 1 ? ` x${n}` : ""}.` };
}

export async function typeText(text: string) {
  const t = String(text || "").slice(0, 4000);
  // Escape SendKeys metacharacters so text is typed literally.
  const escaped = t.replace(/[+^%~(){}[\]]/g, (c) => `{${c}}`).replace(/\r?\n/g, "{ENTER}");
  const r = await runPowerShell(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait($env:DNYL_T)`, { DNYL_T: escaped }, 60000);
  if (r.code !== 0) return { ok: false, message: `Typing failed: ${r.stderr}` };
  return { ok: true, message: `Typed ${t.length} characters.` };
}

export type MouseAction = "move" | "click" | "right_click" | "double_click" | "scroll_up" | "scroll_down";
export async function mouseAction(action: MouseAction, x?: number, y?: number, amount = 3) {
  const r = await runPowerShell(
    `${USER32_TYPE}
     if ($env:DNYL_X -ne '') { [DnylNative]::SetCursorPos([int]$env:DNYL_X, [int]$env:DNYL_Y) | Out-Null; Start-Sleep -Milliseconds 80 }
     switch ($env:DNYL_A) {
       'click' { [DnylNative]::mouse_event(0x02,0,0,0,[UIntPtr]::Zero); [DnylNative]::mouse_event(0x04,0,0,0,[UIntPtr]::Zero) }
       'double_click' { 1..2 | % { [DnylNative]::mouse_event(0x02,0,0,0,[UIntPtr]::Zero); [DnylNative]::mouse_event(0x04,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 90 } }
       'right_click' { [DnylNative]::mouse_event(0x08,0,0,0,[UIntPtr]::Zero); [DnylNative]::mouse_event(0x10,0,0,0,[UIntPtr]::Zero) }
       'scroll_up' { [DnylNative]::mouse_event(0x0800,0,0, 120*[int]$env:DNYL_AM,[UIntPtr]::Zero) }
       'scroll_down' { [DnylNative]::mouse_event(0x0800,0,0, -120*[int]$env:DNYL_AM,[UIntPtr]::Zero) }
     }`,
    {
      DNYL_A: action,
      DNYL_X: Number.isFinite(x) ? String(Math.round(x!)) : "",
      DNYL_Y: Number.isFinite(y) ? String(Math.round(y!)) : "0",
      DNYL_AM: String(Math.max(1, Math.min(20, Math.round(amount)))),
    }
  );
  if (r.code !== 0) return { ok: false, message: `Mouse action failed: ${r.stderr}` };
  return { ok: true, message: `Mouse ${action.replace("_", " ")}${Number.isFinite(x) ? ` at (${x}, ${y})` : ""} done.` };
}

// ───────────────────────── Browser & web ─────────────────────────
export function validateHttpUrl(raw: string): string {
  let s = String(raw || "").trim();
  if (!/^[a-z]+:\/\//i.test(s)) s = "https://" + s;
  const u = new URL(s);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http(s) URLs are allowed.");
  return u.toString();
}

export async function openUrl(raw: string, browser: "default" | "chrome" | "edge" = "default") {
  const url = validateHttpUrl(raw);
  const target = browser === "chrome" ? "chrome" : browser === "edge" ? "msedge" : "";
  const r = target
    ? await runPowerShell(`Start-Process -FilePath $env:DNYL_B -ArgumentList $env:DNYL_U`, { DNYL_B: target, DNYL_U: url })
    : await runPowerShell(`Start-Process -FilePath $env:DNYL_U`, { DNYL_U: url });
  if (r.code !== 0) return { ok: false, message: `Could not open the browser: ${r.stderr}` };
  return { ok: true, message: `Opened ${url} in ${browser === "default" ? "the default browser" : browser}.`, url };
}

function isPrivateIp(ip: string) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const l = ip.toLowerCase();
  return l === "::1" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || l.startsWith("::ffff:127.") || l === "::";
}

/** Fetches a public web page and extracts readable text (blocks localhost/private networks). */
export async function readWebpage(raw: string, maxChars = 8000) {
  const url = validateHttpUrl(raw);
  const host = new URL(url).hostname;
  const addrs = await dns.lookup(host, { all: true });
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error("Refusing to read local/private network addresses.");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) DNYL-Assistant/1.0", Accept: "text/html,text/plain;q=0.9,*/*;q=0.5" },
    });
    if (!res.ok) throw new Error(`The site responded with HTTP ${res.status}.`);
    const type = res.headers.get("content-type") || "";
    if (!/text\/|json|xml/.test(type)) throw new Error(`Unsupported content type: ${type}`);
    const html = (await res.text()).slice(0, 2_000_000);
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
    const text = html
      .replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n")
      .trim();
    return { url: res.url, title, content: text.slice(0, maxChars), truncated: text.length > maxChars };
  } finally {
    clearTimeout(timer);
  }
}

// ───────────────────────── Spotify ─────────────────────────
export async function spotifySearch(query: string, kind: "any" | "track" | "artist" | "album" | "playlist" = "any") {
  const q = String(query || "").trim().slice(0, 200);
  if (!q) return { ok: false, message: "No search query given." };
  const hasDesktop = (await runPowerShell(`if (Test-Path "Registry::HKEY_CLASSES_ROOT\\spotify") { 'yes' } else { 'no' }`)).stdout === "yes";
  if (hasDesktop) {
    const r = await runPowerShell(`Start-Process -FilePath ("spotify:search:" + [uri]::EscapeDataString($env:DNYL_Q))`, { DNYL_Q: q });
    if (r.code === 0) {
      return {
        ok: true,
        opened: "desktop",
        message: `Opened Spotify desktop and searched for "${q}"${kind !== "any" ? ` (${kind})` : ""}. Playback is NOT verified: choose a result (or say "play") to start it.`,
      };
    }
  }
  const url = `https://open.spotify.com/search/${encodeURIComponent(q)}${kind !== "any" ? `/${kind}s` : ""}`;
  const r = await openUrl(url);
  return r.ok
    ? { ok: true, opened: "web", message: `Spotify desktop app unavailable, opened Spotify Web search for "${q}". You may need to log in. Playback is not verified.` }
    : r;
}
