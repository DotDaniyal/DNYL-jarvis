import { Type, FunctionDeclaration } from "@google/genai";
import { APPS, findApp, launchApp, closeApp, focusApp, listApps, waitForAppWindow, isAppInstalled } from "./apps";
import * as files from "./files";
import * as sys from "./system";
import { generateImage, extractDocumentText, webResearch } from "./gemini";
import { getCurrentWeather, getWeatherForecast } from "./weather";
import {
  browserOpenUrl,
  browserGoogleSearch,
  browserNavigate,
  browserClick,
  browserType,
  browserReadPage,
  browserScroll,
  browserTabAction,
  isBrowserConnected,
  findChromePath,
} from "./browser";
import { playYouTube, controlYouTubePlayback, searchYouTube } from "./youtube";

export type Risk = "low" | "sensitive" | "destructive";

export interface ToolResult {
  ok: boolean;
  message: string;
  data?: unknown;
  speechResponse?: string;
  image?: { fileName: string; filePath: string; model: string; prompt: string };
  blocker?: string;
  recovery?: string;
}

const APP_IDS = APPS.map((a) => a.id);
const TYPING_APPS = APPS.filter((a) => a.allowTyping).map((a) => a.id);
const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: Type.STRING, description, ...extra });
const num = (description: string) => ({ type: Type.NUMBER, description });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: Type.OBJECT, properties, required });

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  // ─── Weather Tools ───
  {
    name: "weather_current",
    description: "Get real-time current weather information (temperature, feels-like, humidity, rain probability, wind speed, condition) for any city or user's current city.",
    parameters: obj(
      {
        location: str("City or location name (e.g. 'Karachi', 'Lahore', 'London'). Leave blank or pass 'current'/'local' for user's city."),
        units: str("Temperature units", { enum: ["metric", "imperial"] }),
      },
      []
    ) as any,
  },
  {
    name: "weather_forecast",
    description: "Get weather forecast for the next 1 to 7 days for a city or current location.",
    parameters: obj(
      {
        location: str("City or location name. Leave blank for user's city."),
        days: num("Number of forecast days (1 to 7, default 3)"),
        units: str("Temperature units", { enum: ["metric", "imperial"] }),
      },
      []
    ) as any,
  },

  // ─── YouTube Music Tools ───
  {
    name: "youtube_play",
    description: "Search for a song/track on YouTube, open the actual video in Google Chrome, initiate playback, handle blockers (consent, autoplay), and verify player status.",
    parameters: obj(
      {
        query: str("Song title or search query (e.g. 'Tajdar-e-Haram', 'Atif Aslam song', 'Believer')"),
        artist: str("Optional artist name to prefer official track"),
      },
      ["query"]
    ) as any,
  },
  {
    name: "youtube_control",
    description: "Control active YouTube playback in Google Chrome (play, pause, toggle, mute).",
    parameters: obj(
      {
        action: str("Player action to perform", { enum: ["play", "pause", "toggle", "mute"] }),
      },
      ["action"]
    ) as any,
  },

  // ─── Google Chrome Browser Automation Tools ───
  {
    name: "browser_search",
    description: "Perform a Google search in Google Chrome, navigate to the search page, extract top organic search results (title, URL, snippet), and display them.",
    parameters: obj(
      {
        query: str("Google search query (e.g. 'latest AI news', 'Karachi weather', 'Node.js documentation')"),
      },
      ["query"]
    ) as any,
  },
  {
    name: "browser_open",
    description: "Open any website URL directly in Google Chrome.",
    parameters: obj(
      {
        url: str("http(s) URL or domain name to open in Chrome"),
      },
      ["url"]
    ) as any,
  },
  {
    name: "browser_navigate",
    description: "Navigate current Chrome tab to a new URL.",
    parameters: obj(
      {
        url: str("Destination URL"),
      },
      ["url"]
    ) as any,
  },
  {
    name: "browser_click",
    description: "Click an interactive element (button, link) in Google Chrome by visible text or CSS selector.",
    parameters: obj(
      {
        target: str("Visible text of button/link or CSS selector"),
      },
      ["target"]
    ) as any,
  },
  {
    name: "browser_type",
    description: "Type text into an input field or search bar in Google Chrome.",
    parameters: obj(
      {
        text: str("Text to type"),
        selector: str("Optional CSS selector for the input element"),
      },
      ["text"]
    ) as any,
  },
  {
    name: "browser_read",
    description: "Read accessible text content of the currently open webpage in Google Chrome.",
    parameters: obj(
      {
        max_chars: num("Maximum characters to read (default 8000)"),
      },
      []
    ) as any,
  },
  {
    name: "browser_scroll",
    description: "Scroll the active page in Google Chrome up or down.",
    parameters: obj(
      {
        direction: str("Scroll direction", { enum: ["up", "down"] }),
        amount: num("Scroll distance in pixels (default 600)"),
      },
      ["direction"]
    ) as any,
  },
  {
    name: "browser_tabs",
    description: "Manage tabs in Google Chrome (list active tabs, switch tab, close tab, or open new tab).",
    parameters: obj(
      {
        action: str("Tab action", { enum: ["list", "switch", "close", "new"] }),
        tab_index: num("Index of tab to switch to or close"),
      },
      ["action"]
    ) as any,
  },

  // ─── Desktop Applications ───
  { name: "open_app", description: "Open an installed application on the laptop.", parameters: obj({ app: str("Application id", { enum: APP_IDS }) }, ["app"]) as any },
  { name: "close_app", description: "Close an application's windows gracefully (user may be prompted to save).", parameters: obj({ app: str("Application id", { enum: APP_IDS }) }, ["app"]) as any },
  { name: "switch_to_app", description: "Bring a running application to the foreground.", parameters: obj({ app: str("Application id", { enum: APP_IDS }) }, ["app"]) as any },
  { name: "list_apps", description: "List supported applications and whether each is installed.", parameters: obj({}) as any },

  // ─── Legacy Web & Fallback ───
  { name: "open_url", description: "Open a website in the default or specified browser.", parameters: obj({ url: str("http(s) URL or domain"), browser: str("Browser to use", { enum: ["default", "chrome", "edge"] }) }, ["url"]) as any },
  { name: "google_search", description: "Open Google search in the browser.", parameters: obj({ query: str("Search query"), browser: str("Browser", { enum: ["default", "chrome", "edge"] }) }, ["query"]) as any },
  { name: "youtube_search", description: "Search YouTube and show results.", parameters: obj({ query: str("Search query") }, ["query"]) as any },
  { name: "read_webpage", description: "Fetch a public web page and return its readable text.", parameters: obj({ url: str("http(s) URL") }, ["url"]) as any },
  { name: "web_research", description: "Search the web (Google Search grounding) for factual information.", parameters: obj({ query: str("What to research") }, ["query"]) as any },

  // ─── Media Control ───
  { name: "spotify_play", description: "Open Spotify and search for a song, artist, album or playlist.", parameters: obj({ query: str("Song/artist/album to search"), kind: str("Type of item", { enum: ["any", "track", "artist", "album", "playlist"] }) }, ["query"]) as any },
  { name: "media_control", description: "Control system media playback (Spotify, YouTube, video players) and volume.", parameters: obj({ action: str("Media action", { enum: ["play_pause", "next", "previous", "stop", "volume_up", "volume_down", "mute"] }), steps: num("For volume: number of steps (1-25)") }, ["action"]) as any },

  // ─── File System ───
  { name: "open_folder", description: "Open a permitted folder in File Explorer (Downloads, Documents, Desktop, etc.).", parameters: obj({ path: str("Folder name or path") }, ["path"]) as any },
  { name: "list_files", description: "List files in a permitted folder (newest first).", parameters: obj({ path: str("Folder name or path") }, ["path"]) as any },
  { name: "search_files", description: "Search permitted folders for files by name and/or extension.", parameters: obj({ query: str("Part of file name"), folder: str("Optional folder"), extension: str("Optional extension (pdf, docx)") }, ["query"]) as any },
  { name: "open_file", description: "Open a file with its default application.", parameters: obj({ path: str("File path") }, ["path"]) as any },
  { name: "read_file", description: "Read text content of a document.", parameters: obj({ path: str("File path") }, ["path"]) as any },
  { name: "create_folder", description: "Create a new folder.", parameters: obj({ path: str("New folder path") }, ["path"]) as any },
  { name: "rename_file", description: "Rename a file or folder.", parameters: obj({ path: str("Existing path"), new_name: str("New name") }, ["path", "new_name"]) as any },
  { name: "move_file", description: "Move a file or folder.", parameters: obj({ path: str("Source path"), destination_folder: str("Destination folder") }, ["path", "destination_folder"]) as any },
  { name: "copy_file", description: "Copy a file or folder.", parameters: obj({ path: str("Source path"), destination_folder: str("Destination folder") }, ["path", "destination_folder"]) as any },
  { name: "delete_file", description: "Move a file or folder to the Recycle Bin.", parameters: obj({ path: str("Path to delete") }, ["path"]) as any },

  // ─── System & Desktop ───
  { name: "type_text", description: "Type text into an application.", parameters: obj({ app: str("Target application", { enum: TYPING_APPS }), text: str("Text to type") }, ["app", "text"]) as any },
  { name: "press_keys", description: `Press an allowlisted key or shortcut. Allowed: ${sys.ALLOWED_KEYS.join(", ")}`, parameters: obj({ keys: str("Key combo", { enum: sys.ALLOWED_KEYS }), app: str("Optional app", { enum: APP_IDS }), times: num("Repeat count") }, ["keys"]) as any },
  { name: "mouse_action", description: "Move/click/scroll the mouse.", parameters: obj({ action: str("Mouse action", { enum: ["move", "click", "right_click", "double_click", "scroll_up", "scroll_down"] }), x: num("X"), y: num("Y"), amount: num("Scroll notches") }, ["action"]) as any },
  { name: "power_action", description: "Shut down, restart, sleep or lock the laptop, or cancel pending shutdown.", parameters: obj({ action: str("Power action", { enum: ["shutdown", "restart", "sleep", "lock", "cancel_shutdown"] }) }, ["action"]) as any },
  { name: "system_info", description: "Get basic system information (OS, CPU, memory, battery, disk, uptime).", parameters: obj({}) as any },
  { name: "generate_image", description: "Generate an image from a prompt.", parameters: obj({ prompt: str("Image prompt") }, ["prompt"]) as any },
];

const TOOL_NAMES = new Set(TOOL_DECLARATIONS.map((t) => t.name));
export const isKnownTool = (name: string) => TOOL_NAMES.has(name);

/** Permission model: classify each call before it runs. */
export function classifyRisk(name: string, args: Record<string, any>): Risk {
  switch (name) {
    case "power_action":
      return ["lock", "cancel_shutdown"].includes(args.action) ? "low" : "destructive";
    case "delete_file":
      return "destructive";
    case "close_app":
    case "rename_file":
    case "move_file":
    case "mouse_action":
      return "sensitive";
    default:
      return "low";
  }
}

/** Human-readable description of what a call will do (shown in confirmations/history). */
export function describeCall(name: string, a: Record<string, any>): string {
  const app = (id: string) => findApp(id)?.name || id;
  switch (name) {
    case "weather_current":
      return `Check current weather${a.location ? ` in ${a.location}` : " for current location"}`;
    case "weather_forecast":
      return `Get ${a.days || 3}-day weather forecast${a.location ? ` for ${a.location}` : ""}`;
    case "youtube_play":
      return `Play on YouTube: "${a.query}"${a.artist ? ` by ${a.artist}` : ""}`;
    case "youtube_control":
      return `YouTube player: ${a.action}`;
    case "browser_search":
      return `Google search in Chrome: "${a.query}"`;
    case "browser_open":
      return `Open in Chrome: ${a.url}`;
    case "browser_navigate":
      return `Navigate Chrome to ${a.url}`;
    case "browser_click":
      return `Click "${a.target}" in Chrome`;
    case "browser_type":
      return `Type into Chrome: "${String(a.text).slice(0, 40)}"`;
    case "browser_read":
      return "Read current Chrome page";
    case "browser_scroll":
      return `Scroll Chrome page ${a.direction || "down"}`;
    case "browser_tabs":
      return `Chrome tabs: ${a.action}`;
    case "open_app":
      return `Open ${app(a.app)}`;
    case "close_app":
      return `Close ${app(a.app)} (unsaved work may prompt)`;
    case "switch_to_app":
      return `Switch to ${app(a.app)}`;
    case "list_apps":
      return "Check installed applications";
    case "open_url":
      return `Open ${a.url}`;
    case "google_search":
      return `Google search: "${a.query}"`;
    case "youtube_search":
      return `YouTube search: "${a.query}"`;
    case "read_webpage":
      return `Read web page ${a.url}`;
    case "web_research":
      return `Research the web: "${a.query}"`;
    case "spotify_play":
      return `Spotify: search "${a.query}"`;
    case "media_control":
      return `Media: ${String(a.action).replace("_", " ")}`;
    case "open_folder":
      return `Open folder ${a.path}`;
    case "list_files":
      return `List files in ${a.path}`;
    case "search_files":
      return `Search files "${a.query || "*"}"${a.extension ? ` (.${a.extension})` : ""}${a.folder ? ` in ${a.folder}` : ""}`;
    case "open_file":
      return `Open file ${a.path}`;
    case "read_file":
      return `Read file ${a.path}`;
    case "create_folder":
      return `Create folder ${a.path}`;
    case "rename_file":
      return `Rename ${a.path} → ${a.new_name}`;
    case "move_file":
      return `Move ${a.path} → ${a.destination_folder}`;
    case "copy_file":
      return `Copy ${a.path} → ${a.destination_folder}`;
    case "delete_file":
      return `Move ${a.path} to the Recycle Bin`;
    case "type_text":
      return `Type into ${app(a.app)}: "${String(a.text).slice(0, 60)}${String(a.text).length > 60 ? "…" : ""}"`;
    case "press_keys":
      return `Press ${a.keys}${a.app ? ` in ${app(a.app)}` : ""}`;
    case "mouse_action":
      return `Mouse ${a.action}${a.x != null ? ` at (${a.x}, ${a.y})` : ""}`;
    case "power_action":
      return (
        {
          shutdown: "Shut down the laptop (60s grace period)",
          restart: "Restart the laptop (60s grace period)",
          sleep: "Put the laptop to sleep",
          lock: "Lock the screen",
          cancel_shutdown: "Cancel pending shutdown/restart",
        }[a.action as string] || `Power: ${a.action}`
      );
    case "system_info":
      return "Read system information";
    case "generate_image":
      return `Generate image: "${String(a.prompt).slice(0, 70)}"`;
    default:
      return name;
  }
}

function requireApp(id: string) {
  const app = findApp(id);
  if (!app) throw new Error(`"${id}" is not a supported application. Supported: ${APP_IDS.join(", ")}.`);
  return app;
}

/** Executes a validated tool call. Never runs arbitrary shell text. */
export async function executeTool(name: string, a: Record<string, any>): Promise<ToolResult> {
  try {
    switch (name) {
      // ─── Weather ───
      case "weather_current": {
        const res = await getCurrentWeather(a.location, a.units || "metric");
        return {
          ok: res.ok,
          message: res.message,
          data: res.data,
          speechResponse: res.speechResponse,
        };
      }
      case "weather_forecast": {
        const res = await getWeatherForecast(a.location, a.days ?? 3, a.units || "metric");
        return {
          ok: res.ok,
          message: res.message,
          data: res.data,
          speechResponse: res.speechResponse,
        };
      }

      // ─── YouTube Music ───
      case "youtube_play": {
        const res = await playYouTube(a.query, a.artist);
        return {
          ok: res.ok,
          message: res.message,
          data: res,
          speechResponse: res.speechResponse,
          blocker: res.blocker,
          recovery: res.recovery,
        };
      }
      case "youtube_control": {
        const res = await controlYouTubePlayback(a.action || "toggle");
        return {
          ok: res.ok,
          message: res.message,
          data: res,
        };
      }

      // ─── Google Chrome Automation ───
      case "browser_search": {
        const res = await browserGoogleSearch(a.query);
        return {
          ok: res.ok,
          message: res.message,
          data: res.results,
        };
      }
      case "browser_open": {
        const res = await browserOpenUrl(a.url);
        return {
          ok: res.ok,
          message: res.message,
          data: res,
        };
      }
      case "browser_navigate": {
        return await browserNavigate(a.url);
      }
      case "browser_click": {
        return await browserClick(a.target || a.selector);
      }
      case "browser_type": {
        return await browserType(a.selector || "input", a.text);
      }
      case "browser_read": {
        const res = await browserReadPage(a.max_chars ?? 8000);
        return {
          ok: res.ok,
          message: res.message,
          data: res,
        };
      }
      case "browser_scroll": {
        return await browserScroll(a.direction || "down", a.amount ?? 600);
      }
      case "browser_tabs": {
        const res = await browserTabAction(a.action || "list", a.tab_index);
        return {
          ok: res.ok,
          message: res.message,
          data: res.tabs,
        };
      }

      // ─── Applications ───
      case "open_app":
        return await launchApp(requireApp(a.app));
      case "close_app":
        return await closeApp(requireApp(a.app));
      case "switch_to_app":
        return await focusApp(requireApp(a.app));
      case "list_apps": {
        const apps = await listApps();
        return {
          ok: true,
          message: `Installed: ${apps.filter((x) => x.installed).map((x) => x.name).join(", ")}. Not found: ${
            apps.filter((x) => !x.installed).map((x) => x.name).join(", ") || "none"
          }.`,
          data: apps,
        };
      }

      // ─── Web & Fallback ───
      case "open_url":
        return await sys.openUrl(a.url, a.browser || "default");
      case "google_search": {
        // Prefer Chrome search when Chrome is target or available
        if (a.browser === "chrome" || a.browser === "default") {
          const res = await browserGoogleSearch(a.query);
          return { ok: res.ok, message: res.message, data: res.results };
        }
        return await sys.openUrl(`https://www.google.com/search?q=${encodeURIComponent(a.query)}`, a.browser || "default");
      }
      case "youtube_search": {
        const results = await searchYouTube(a.query, 5);
        if (results.length > 0) {
          // Also open search page in browser so user sees it
          await sys.openUrl(`https://www.youtube.com/results?search_query=${encodeURIComponent(a.query)}`);
          return {
            ok: true,
            message: `Found ${results.length} YouTube results for "${a.query}":\n` +
              results.map((r, i) => `${i + 1}. ${r.title} (${r.channel})`).join("\n") +
              "\nOpened YouTube search page in browser.",
            data: results,
          };
        }
        return await sys.openUrl(`https://www.youtube.com/results?search_query=${encodeURIComponent(a.query)}`);
      }
      case "read_webpage": {
        const page = await sys.readWebpage(a.url);
        return { ok: true, message: `Read "${page.title || page.url}" (${page.content.length} chars).`, data: page };
      }
      case "spotify_play":
        return await sys.spotifySearch(a.query, a.kind || "any");
      case "web_research": {
        const r = await webResearch(a.query);
        return { ok: true, message: `Researched "${a.query}" (${r.sources.length} sources).`, data: r };
      }
      case "media_control":
        return await sys.mediaKey(a.action, a.steps ?? 5);

      // ─── Files ───
      case "open_folder": {
        const r = await files.openPath(a.path);
        return { ok: true, message: `Opened ${r.path}.` };
      }
      case "list_files": {
        const r = await files.listDir(a.path);
        return { ok: true, message: `${r.total} item(s) in ${r.path}.`, data: r };
      }
      case "search_files": {
        const r = await files.searchFiles(a.query, a.folder, a.extension);
        return {
          ok: true,
          message: r.total ? `Found ${r.total} match(es); newest: ${r.results[0].name}.` : "No matching files found.",
          data: r,
        };
      }
      case "open_file": {
        const r = await files.openPath(a.path);
        return { ok: true, message: `Opened ${r.path}.` };
      }
      case "read_file": {
        const r: any = await files.readFileContent(a.path);
        if (r.binary) {
          const text = await extractDocumentText(r.path, r.size);
          return { ok: true, message: `Read ${r.path}.`, data: { path: r.path, content: text } };
        }
        return { ok: true, message: `Read ${r.path}${r.truncated ? " (truncated)" : ""}.`, data: r };
      }
      case "create_folder": {
        const r = await files.createFolder(a.path);
        return { ok: true, message: `Created folder ${r.path}.` };
      }
      case "rename_file": {
        const r = await files.renamePath(a.path, a.new_name);
        return { ok: true, message: `Renamed to ${r.to}.` };
      }
      case "move_file": {
        const r = await files.movePath(a.path, a.destination_folder);
        return { ok: true, message: `Moved to ${r.to}.` };
      }
      case "copy_file": {
        const r = await files.movePath(a.path, a.destination_folder, true);
        return { ok: true, message: `Copied to ${r.to}.` };
      }
      case "delete_file": {
        const r = await files.recyclePath(a.path);
        return { ok: true, message: `Moved ${r.path} to the Recycle Bin (restorable).` };
      }

      // ─── Input & System ───
      case "type_text": {
        const app = requireApp(a.app);
        if (!app.allowTyping) return { ok: false, message: `Typing into ${app.name} is not permitted.` };
        let focused = await focusApp(app);
        if (!focused.ok) {
          const l = await launchApp(app);
          if (!l.ok) return l;
          if (!(await waitForAppWindow(app)))
            return { ok: false, message: `${app.name} opened but its window could not be focused, so nothing was typed.` };
        }
        await new Promise((r) => setTimeout(r, 500));
        const t = await sys.typeText(a.text);
        return t.ok ? { ok: true, message: `Typed ${String(a.text).length} characters into ${app.name}.` } : t;
      }
      case "press_keys": {
        if (a.app) {
          const app = requireApp(a.app);
          const f = await focusApp(app);
          if (!f.ok) return f;
          await new Promise((r) => setTimeout(r, 300));
        }
        return await sys.pressKeys(a.keys, a.times ?? 1);
      }
      case "mouse_action":
        return await sys.mouseAction(a.action, a.x, a.y, a.amount ?? 3);
      case "power_action":
        return await sys.powerAction(a.action);
      case "system_info": {
        const info = await sys.systemInfo();
        return {
          ok: true,
          message: `${info.os}, ${info.freeMemoryGB}/${info.totalMemoryGB} GB RAM free${
            info.batteryPercent != null ? `, battery ${info.batteryPercent}%` : ""
          }.`,
          data: info,
        };
      }
      case "generate_image": {
        const img = await generateImage(a.prompt);
        return {
          ok: true,
          message: `Image generated with ${img.model} and saved to ${img.filePath}.`,
          image: { ...img, prompt: a.prompt },
        };
      }
      default:
        return { ok: false, message: `Unknown tool "${name}".` };
    }
  } catch (e: any) {
    return { ok: false, message: e?.message || String(e) };
  }
}

export async function integrationStatus() {
  const spotify = findApp("spotify")!;
  const chromePath = findChromePath();
  return {
    spotifyDesktop: await isAppInstalled(spotify),
    chromeInstalled: Boolean(chromePath),
    chromeConnected: isBrowserConnected(),
    weatherProvider: "Open-Meteo API (Active, Geolocation enabled)",
  };
}
