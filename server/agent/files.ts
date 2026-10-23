import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { runPowerShell } from "./ps";

/**
 * File & folder assistant restricted to user-authorized roots
 * (Desktop, Documents, Downloads, Pictures, Music, Videos + DNYL_ALLOWED_DIRS).
 */
export const ROOTS: Record<string, string> = {};

const SENSITIVE_NAME = /(password|passwd|credential|secret|\.env$|\.env\.|id_rsa|id_ed25519|\.pem$|\.key$|\.kdbx$|\.pfx$|wallet|token)/i;
const BLOCKED_SEGMENTS = new Set(["appdata", ".ssh", ".gnupg", ".aws", ".azure", ".git"]);
const EXECUTABLE_EXT = new Set([".exe", ".bat", ".cmd", ".ps1", ".psm1", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh", ".msi", ".msp", ".lnk", ".scr", ".com", ".reg", ".hta", ".jar", ".cpl", ".pif", ".url"]);
const TEXT_EXT = new Set([".txt", ".md", ".json", ".csv", ".log", ".xml", ".yaml", ".yml", ".ini", ".html", ".css", ".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".c", ".cpp", ".cs", ".go", ".rs", ".sql", ".sh", ".toml"]);

export async function initRoots() {
  const r = await runPowerShell(
    `$o = [ordered]@{
      desktop = [Environment]::GetFolderPath('Desktop');
      documents = [Environment]::GetFolderPath('MyDocuments');
      downloads = (New-Object -ComObject Shell.Application).Namespace('shell:Downloads').Self.Path;
      pictures = [Environment]::GetFolderPath('MyPictures');
      music = [Environment]::GetFolderPath('MyMusic');
      videos = [Environment]::GetFolderPath('MyVideos') }; $o | ConvertTo-Json -Compress`
  );
  const home = os.homedir();
  const fallback: Record<string, string> = {
    desktop: path.join(home, "Desktop"),
    documents: path.join(home, "Documents"),
    downloads: path.join(home, "Downloads"),
    pictures: path.join(home, "Pictures"),
    music: path.join(home, "Music"),
    videos: path.join(home, "Videos"),
  };
  let parsed: Record<string, string> = {};
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    /* use fallback */
  }
  for (const k of Object.keys(fallback)) ROOTS[k] = parsed[k] || fallback[k];
  const extra = (process.env.DNYL_ALLOWED_DIRS || "").split(";").map((s) => s.trim()).filter(Boolean);
  extra.forEach((dir, i) => (ROOTS[`custom${i + 1}`] = path.resolve(dir)));
}

const ALIASES: Record<string, string> = {
  desktop: "desktop", "my desktop": "desktop",
  documents: "documents", document: "documents", "my documents": "documents", docs: "documents",
  downloads: "downloads", download: "downloads", "my downloads": "downloads",
  pictures: "pictures", photos: "pictures", images: "pictures",
  music: "music", videos: "videos", video: "videos",
};

const norm = (p: string) => path.resolve(p).toLowerCase();

/** Resolves a user/AI-supplied path to an absolute path inside an allowed root, or throws. */
export function resolveSafePath(input: string): string {
  let raw = String(input || "").trim().replace(/^["']|["']$/g, "");
  if (!raw) throw new Error("No path was provided.");
  raw = raw.replace(/^~[\\/]?/, os.homedir() + path.sep);

  let abs: string;
  if (path.isAbsolute(raw)) {
    abs = path.resolve(raw);
  } else {
    const [first, ...rest] = raw.split(/[\\/]/);
    const key = ALIASES[first.toLowerCase()] || (ROOTS[first.toLowerCase()] ? first.toLowerCase() : undefined);
    if (!key) throw new Error(`Relative paths must start with an allowed folder (${Object.keys(ROOTS).join(", ")}).`);
    abs = path.resolve(ROOTS[key], ...rest);
  }

  // Resolve symlinks/junctions for existing paths to prevent escaping the sandbox.
  let real = abs;
  try {
    real = fs.realpathSync.native(abs);
  } catch {
    try {
      real = path.join(fs.realpathSync.native(path.dirname(abs)), path.basename(abs));
    } catch {
      /* parent may not exist yet */
    }
  }

  const inside = Object.values(ROOTS).some((root) => {
    const r = norm(root);
    const n = norm(real);
    return n === r || n.startsWith(r + path.sep);
  });
  if (!inside) throw new Error(`Access denied: "${abs}" is outside the folders DNYL is permitted to use.`);

  const segments = real.split(/[\\/]/).map((s) => s.toLowerCase());
  if (segments.some((s) => BLOCKED_SEGMENTS.has(s)) || SENSITIVE_NAME.test(path.basename(real))) {
    throw new Error("Access denied: this location looks like it may contain credentials or private system data.");
  }
  return real;
}

export function isExecutable(p: string) {
  return EXECUTABLE_EXT.has(path.extname(p).toLowerCase());
}

export async function listDir(input: string, limit = 60) {
  const dir = resolveSafePath(input);
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const items = [];
  for (const e of entries) {
    if (SENSITIVE_NAME.test(e.name) || e.name.startsWith(".")) continue;
    let size = 0;
    let modified = "";
    try {
      const st = await fsp.stat(path.join(dir, e.name));
      size = st.size;
      modified = st.mtime.toISOString();
    } catch {
      /* ignore */
    }
    items.push({ name: e.name, type: e.isDirectory() ? "folder" : "file", size, modified });
  }
  items.sort((a, b) => (b.modified > a.modified ? 1 : -1));
  return { path: dir, total: items.length, items: items.slice(0, limit) };
}

export async function searchFiles(query: string, folder?: string, extension?: string, limit = 25) {
  const roots = folder ? [resolveSafePath(folder)] : Object.values(ROOTS).filter((r) => fs.existsSync(r));
  const q = String(query || "").toLowerCase().trim();
  const ext = extension ? "." + extension.replace(/^\./, "").toLowerCase() : "";
  const results: { name: string; path: string; size: number; modified: string }[] = [];
  let visited = 0;
  const MAX_VISITS = 40000;

  async function walk(dir: string, depth: number) {
    if (depth > 7 || visited > MAX_VISITS) return;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      visited++;
      const lower = e.name.toLowerCase();
      if (e.name.startsWith(".") || lower === "node_modules" || BLOCKED_SEGMENTS.has(lower) || SENSITIVE_NAME.test(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full, depth + 1);
      } else if ((!q || lower.includes(q)) && (!ext || lower.endsWith(ext))) {
        try {
          const st = await fsp.stat(full);
          results.push({ name: e.name, path: full, size: st.size, modified: st.mtime.toISOString() });
        } catch {
          /* ignore */
        }
      }
    }
  }
  for (const r of roots) await walk(r, 0);
  results.sort((a, b) => (b.modified > a.modified ? 1 : -1));
  return { query, extension: ext || null, searched: roots, total: results.length, truncatedScan: visited > MAX_VISITS, results: results.slice(0, limit) };
}

export async function openPath(input: string) {
  const p = resolveSafePath(input);
  if (!fs.existsSync(p)) throw new Error(`Not found: ${p}`);
  if (isExecutable(p)) throw new Error("For safety, DNYL will not open executables, scripts or shortcuts.");
  const r = await runPowerShell(`Start-Process -FilePath $env:DNYL_P`, { DNYL_P: p });
  if (r.code !== 0) throw new Error(r.stderr || "Failed to open.");
  return { path: p };
}

export async function readFileContent(input: string, maxChars = 12000) {
  const p = resolveSafePath(input);
  const st = await fsp.stat(p);
  if (st.isDirectory()) throw new Error("That is a folder. Use list_files instead.");
  const ext = path.extname(p).toLowerCase();
  if (ext === ".pdf" || ext === ".docx") return { path: p, binary: true, ext, size: st.size };
  if (!TEXT_EXT.has(ext)) throw new Error(`Reading "${ext || "this"}" files is not supported. Supported: text, code, markdown, CSV, JSON, PDF, DOCX.`);
  if (st.size > 2 * 1024 * 1024) throw new Error("File is larger than 2 MB; refusing to read it fully.");
  const text = await fsp.readFile(p, "utf8");
  return { path: p, content: text.slice(0, maxChars), truncated: text.length > maxChars };
}

export async function createFolder(input: string) {
  const p = resolveSafePath(input);
  if (fs.existsSync(p)) throw new Error(`Already exists: ${p}`);
  await fsp.mkdir(p, { recursive: true });
  return { path: p };
}

export async function renamePath(input: string, newName: string) {
  const p = resolveSafePath(input);
  if (!fs.existsSync(p)) throw new Error(`Not found: ${p}`);
  if (/[\\/:*?"<>|]/.test(newName) || !newName.trim()) throw new Error("Invalid new name.");
  const dest = resolveSafePath(path.join(path.dirname(p), newName));
  if (fs.existsSync(dest)) throw new Error(`A file named "${newName}" already exists. Not overwriting.`);
  await fsp.rename(p, dest);
  return { from: p, to: dest };
}

export async function movePath(input: string, destFolder: string, copy = false) {
  const src = resolveSafePath(input);
  if (!fs.existsSync(src)) throw new Error(`Not found: ${src}`);
  const destDir = resolveSafePath(destFolder);
  if (!fs.existsSync(destDir) || !fs.statSync(destDir).isDirectory()) throw new Error(`Destination folder not found: ${destDir}`);
  const dest = resolveSafePath(path.join(destDir, path.basename(src)));
  if (fs.existsSync(dest)) throw new Error(`"${path.basename(src)}" already exists in the destination. Not overwriting.`);
  if (copy) {
    await fsp.cp(src, dest, { recursive: true, errorOnExist: true, force: false });
  } else {
    try {
      await fsp.rename(src, dest);
    } catch (e: any) {
      if (e?.code !== "EXDEV") throw e;
      await fsp.cp(src, dest, { recursive: true, errorOnExist: true, force: false });
      await fsp.rm(src, { recursive: true });
    }
  }
  return { from: src, to: dest };
}

/** Deletes by sending to the Recycle Bin (recoverable), never permanent deletion. */
export async function recyclePath(input: string) {
  const p = resolveSafePath(input);
  if (!fs.existsSync(p)) throw new Error(`Not found: ${p}`);
  if (Object.values(ROOTS).some((r) => norm(r) === norm(p))) throw new Error("Refusing to delete a top-level user folder.");
  const isDir = fs.statSync(p).isDirectory();
  const r = await runPowerShell(
    `Add-Type -AssemblyName Microsoft.VisualBasic;
     if ($env:DNYL_D -eq '1') { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($env:DNYL_P, 'OnlyErrorDialogs', 'SendToRecycleBin') }
     else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($env:DNYL_P, 'OnlyErrorDialogs', 'SendToRecycleBin') }`,
    { DNYL_P: p, DNYL_D: isDir ? "1" : "0" }
  );
  if (r.code !== 0) throw new Error(r.stderr || "Delete failed.");
  return { path: p, recycled: true };
}
