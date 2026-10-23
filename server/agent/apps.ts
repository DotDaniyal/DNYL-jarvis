import { runPowerShell, USER32_TYPE } from "./ps";

/**
 * Allowlisted applications. The AI can only reference these IDs; it can never
 * supply an arbitrary executable path.
 */
export interface AppDef {
  id: string;
  name: string;
  aliases: string[];
  /** Launch target passed to Start-Process (exe name resolvable via App Paths/PATH, or URI). */
  launch: string;
  /** Process names (without .exe) used for close/switch. */
  processes: string[];
  detect: { type: "uri"; scheme: string } | { type: "exe"; exe: string } | { type: "builtin" } | { type: "command"; command: string };
  /** Whether DNYL may type text into this app. Terminals are excluded on purpose. */
  allowTyping?: boolean;
}

export const APPS: AppDef[] = [
  { id: "spotify", name: "Spotify", aliases: ["spotify"], launch: "spotify:", processes: ["Spotify"], detect: { type: "uri", scheme: "spotify" } },
  { id: "chrome", name: "Google Chrome", aliases: ["chrome", "google chrome"], launch: "chrome", processes: ["chrome"], detect: { type: "exe", exe: "chrome.exe" }, allowTyping: true },
  { id: "edge", name: "Microsoft Edge", aliases: ["edge", "microsoft edge"], launch: "msedge", processes: ["msedge"], detect: { type: "exe", exe: "msedge.exe" }, allowTyping: true },
  { id: "vscode", name: "Visual Studio Code", aliases: ["vs code", "vscode", "visual studio code", "code"], launch: "code", processes: ["Code"], detect: { type: "command", command: "code" }, allowTyping: true },
  { id: "notepad", name: "Notepad", aliases: ["notepad"], launch: "notepad.exe", processes: ["Notepad", "notepad"], detect: { type: "builtin" }, allowTyping: true },
  { id: "calculator", name: "Calculator", aliases: ["calculator", "calc"], launch: "calc.exe", processes: ["CalculatorApp", "Calculator"], detect: { type: "builtin" } },
  { id: "explorer", name: "File Explorer", aliases: ["file explorer", "explorer", "files"], launch: "explorer.exe", processes: [], detect: { type: "builtin" } },
  { id: "settings", name: "Windows Settings", aliases: ["settings", "windows settings"], launch: "ms-settings:", processes: ["SystemSettings"], detect: { type: "builtin" } },
  { id: "task_manager", name: "Task Manager", aliases: ["task manager"], launch: "taskmgr.exe", processes: ["Taskmgr"], detect: { type: "builtin" } },
  { id: "paint", name: "Paint", aliases: ["paint", "mspaint"], launch: "mspaint.exe", processes: ["mspaint"], detect: { type: "builtin" } },
  { id: "word", name: "Microsoft Word", aliases: ["word", "ms word"], launch: "winword", processes: ["WINWORD"], detect: { type: "exe", exe: "winword.exe" }, allowTyping: true },
  { id: "excel", name: "Microsoft Excel", aliases: ["excel"], launch: "excel", processes: ["EXCEL"], detect: { type: "exe", exe: "excel.exe" } },
  { id: "powerpoint", name: "Microsoft PowerPoint", aliases: ["powerpoint"], launch: "powerpnt", processes: ["POWERPNT"], detect: { type: "exe", exe: "powerpnt.exe" } },
  { id: "whatsapp", name: "WhatsApp", aliases: ["whatsapp"], launch: "whatsapp:", processes: ["WhatsApp"], detect: { type: "uri", scheme: "whatsapp" } },
  { id: "camera", name: "Camera", aliases: ["camera"], launch: "microsoft.windows.camera:", processes: ["WindowsCamera"], detect: { type: "builtin" } },
  { id: "terminal", name: "Windows Terminal", aliases: ["terminal", "windows terminal"], launch: "wt.exe", processes: ["WindowsTerminal"], detect: { type: "command", command: "wt" } },
];

export function findApp(idOrName: string): AppDef | undefined {
  const q = String(idOrName || "").trim().toLowerCase();
  return APPS.find((a) => a.id === q || a.aliases.includes(q) || a.name.toLowerCase() === q);
}

const availabilityCache = new Map<string, boolean>();

export async function isAppInstalled(app: AppDef): Promise<boolean> {
  if (availabilityCache.has(app.id)) return availabilityCache.get(app.id)!;
  let ok = false;
  const d = app.detect;
  if (d.type === "builtin") ok = true;
  else if (d.type === "uri") {
    const r = await runPowerShell(`if (Test-Path ("Registry::HKEY_CLASSES_ROOT\\" + $env:DNYL_V)) { 'yes' } else { 'no' }`, { DNYL_V: d.scheme });
    ok = r.stdout === "yes";
  } else if (d.type === "exe") {
    const r = await runPowerShell(
      `$k='SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\' + $env:DNYL_V; if ((Test-Path "HKLM:\\$k") -or (Test-Path "HKCU:\\$k") -or (Get-Command $env:DNYL_V -ErrorAction SilentlyContinue)) { 'yes' } else { 'no' }`,
      { DNYL_V: d.exe }
    );
    ok = r.stdout === "yes";
  } else if (d.type === "command") {
    const r = await runPowerShell(`if (Get-Command $env:DNYL_V -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }`, { DNYL_V: d.command });
    ok = r.stdout === "yes";
  }
  availabilityCache.set(app.id, ok);
  return ok;
}

export async function listApps() {
  const out = [];
  for (const a of APPS) out.push({ id: a.id, name: a.name, installed: await isAppInstalled(a) });
  return out;
}

export async function launchApp(app: AppDef, args: string[] = []) {
  if (!(await isAppInstalled(app))) {
    return { ok: false, message: `${app.name} does not appear to be installed on this laptop.` };
  }
  const vars: Record<string, string> = { DNYL_T: app.launch };
  let script = `Start-Process -FilePath $env:DNYL_T`;
  if (args.length) {
    vars.DNYL_ARGS = JSON.stringify(args);
    script = `$a = $env:DNYL_ARGS | ConvertFrom-Json; Start-Process -FilePath $env:DNYL_T -ArgumentList $a`;
  }
  if (app.id === "vscode") script += " -WindowStyle Hidden"; // code.cmd launcher window
  const r = await runPowerShell(script, vars);
  if (r.code !== 0) return { ok: false, message: `Failed to launch ${app.name}: ${r.stderr || "unknown error"}` };
  return { ok: true, message: `${app.name} launched.` };
}

export async function closeApp(app: AppDef) {
  if (!app.processes.length) return { ok: false, message: `${app.name} cannot be closed this way.` };
  // CloseMainWindow is graceful: apps can still prompt the user to save work.
  const r = await runPowerShell(
    `$names = $env:DNYL_P | ConvertFrom-Json; $p = Get-Process -Name $names -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 };
     $n = 0; foreach ($x in $p) { if ($x.CloseMainWindow()) { $n++ } }; $n`,
    { DNYL_P: JSON.stringify(app.processes) }
  );
  const n = parseInt(r.stdout, 10) || 0;
  if (r.code !== 0) return { ok: false, message: `Could not close ${app.name}: ${r.stderr}` };
  if (n === 0) return { ok: false, message: `${app.name} is not running (no open windows found).` };
  return { ok: true, message: `Asked ${n} ${app.name} window(s) to close. Apps with unsaved work may show a save prompt.` };
}

/** Brings an app window to the foreground. Returns false if no window exists. */
export async function focusApp(app: AppDef) {
  if (!app.processes.length) return { ok: false, message: `${app.name} cannot be focused.` };
  const r = await runPowerShell(
    `${USER32_TYPE}
     $names = $env:DNYL_P | ConvertFrom-Json
     $p = Get-Process -Name $names -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
     if (-not $p) { 'none'; exit 0 }
     if ([DnylNative]::IsIconic($p.MainWindowHandle)) { [DnylNative]::ShowWindowAsync($p.MainWindowHandle, 9) | Out-Null }
     [DnylNative]::Key(0x12)
     [DnylNative]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
     (New-Object -ComObject WScript.Shell).AppActivate($p.Id) | Out-Null
     'ok'`,
    { DNYL_P: JSON.stringify(app.processes) }
  );
  if (r.stdout.endsWith("none")) return { ok: false, message: `${app.name} is not running.` };
  if (r.code !== 0) return { ok: false, message: `Could not switch to ${app.name}: ${r.stderr}` };
  return { ok: true, message: `Switched to ${app.name}.` };
}

export async function waitForAppWindow(app: AppDef, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await focusApp(app);
    if (r.ok) return true;
    await new Promise((res) => setTimeout(res, 700));
  }
  return false;
}
