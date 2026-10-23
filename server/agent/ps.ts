import { spawn, ChildProcess } from "child_process";

/**
 * Runs a FIXED PowerShell script. User-provided values are NEVER interpolated into
 * the script text; they are passed through environment variables (DNYL_*) and read
 * inside the script via $env:DNYL_*. This prevents command injection.
 */
const activeProcesses = new Set<ChildProcess>();

export interface PsResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runPowerShell(
  script: string,
  vars: Record<string, string> = {},
  timeoutMs = 20000
): Promise<PsResult> {
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const [k, v] of Object.entries(vars)) {
      if (!/^DNYL_[A-Z0-9_]+$/.test(k)) throw new Error(`Invalid variable name ${k}`);
      env[k] = v;
    }
    const encoded = Buffer.from(
      `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; ${script}`,
      "utf16le"
    ).toString("base64");
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { env, windowsHide: true }
    );
    activeProcesses.add(child);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      stderr += "\nTimed out.";
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d) => (stderr += d.toString("utf8")));
    child.on("error", (err) => {
      clearTimeout(timer);
      activeProcesses.delete(child);
      resolve({ code: -1, stdout, stderr: String(err.message) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      activeProcesses.delete(child);
      resolve({ code: code ?? -1, stdout: stdout.trim(), stderr: cleanPsError(stderr) });
    });
  });
}

/** Strips PowerShell CLIXML noise and keeps the first meaningful error line. */
function cleanPsError(s: string): string {
  const text = s
    .replace(/#< CLIXML[\s\S]*?<\/Objs>/g, "")
    .replace(/_x000D__x000A_/g, " ")
    .trim();
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0) || "";
  return line.trim();
}

/** Emergency stop: kills every in-flight PowerShell action. */
export function killAllActiveProcesses(): number {
  let n = 0;
  for (const p of activeProcesses) {
    try {
      p.kill();
      n++;
    } catch {
      /* ignore */
    }
  }
  activeProcesses.clear();
  return n;
}

/** Shared C# helpers for keyboard/media/window control via user32.dll. */
export const USER32_TYPE = `
if (-not ('DnylNative' -as [type])) {
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class DnylNative {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);
  public static void Key(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); keybd_event(vk, 0, 2, UIntPtr.Zero); }
}
"@
}
`;
