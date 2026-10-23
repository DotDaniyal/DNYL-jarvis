/**
 * Centralized Intent Recognition and Tool Router for JARVIS / DNYL
 * Supports natural commands in English, Urdu, and Roman Urdu.
 * Provides deterministic tool selection, argument validation, and fallback to LLM.
 */

import { extractMusicIntent } from "./youtube";

export interface RoutedAction {
  toolName: string;
  args: Record<string, any>;
  confidence: number;
  reasoning: string;
  language: "en" | "ur" | "roman_ur";
}

/**
 * Normalizes input text for multi-lingual intent matching.
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[؟?.,!۔]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Detects whether the text is English, Urdu script, or Roman Urdu.
 */
export function detectLanguage(text: string): "en" | "ur" | "roman_ur" {
  // Check for Arabic/Urdu Unicode script range (0600-06FF, 0750-077F)
  if (/[\u0600-\u06FF\u0750-\u077F]/.test(text)) {
    return "ur";
  }

  const romanUrduKeywords = [
    "kholo", "batao", "chalao", "sunao", "karo", "karna", "kaise", "kya",
    "mausam", "gaana", "gana", "aaj", "kal", "shahar", "shehar", "ilaka",
    "awaz", "barhao", "kam", "band", "roko", "lagao", "bajao", "par", "pe",
    "mein", "aur", "ye", "yeh", "woh", "hai", "hain", "mera", "meri", "mere",
    "mujhe", "bhai", "yaar"
  ];

  const words = text.toLowerCase().split(/\s+/);
  const matchCount = words.filter((w) => romanUrduKeywords.includes(w)).length;

  if (matchCount >= 1) {
    return "roman_ur";
  }

  return "en";
}

/**
 * Fast deterministic intent router.
 * Evaluates high-frequency commands (weather, youtube, chrome, apps, power, system).
 */
export function routeDirectIntent(command: string): RoutedAction | null {
  const norm = normalizeText(command);
  const lang = detectLanguage(command);

  // ───────────────────────── 1. WEATHER INTENTS ─────────────────────────
  const isWeatherQuery =
    /weather|forecast|rain|temperature|mausam|موسم|بارش|درجہ حرارت/.test(norm);

  if (isWeatherQuery) {
    // Check if forecast is requested
    const isForecast =
      /tomorrow|forecast|next \d+ days|week|kal ka|aane wale|پیشگوئی|کل کا/.test(norm);

    // Extract city name
    let city: string | undefined;

    // Urdu script extraction
    const urduCityMatch = norm.match(/(?:کا|کی|کے)\s+موسم|موسم\s+(?:کا|کی|کے)\s+([^\s]+)/);
    if (urduCityMatch && urduCityMatch[1]) {
      city = urduCityMatch[1];
    }

    // Roman Urdu / English patterns
    if (!city) {
      const cityMatches = [
        /(?:in|for|at|of)\s+([a-zA-Z]+)(?:\s+(?:today|tomorrow|now))?[?.]*$/i,
        /(?:weather|forecast)\s+(?:in|for|at|of)\s+([a-zA-Z\s]+?)(?:\s+(?:today|tomorrow|now))?[?.]*$/i,
        /([a-zA-Z]+)\s+(?:ka|ki|ke)\s+weather/i,
        /([a-zA-Z]+)\s+(?:ka|ki|ke)\s+mausam/i,
        /weather\s+([a-zA-Z]+)/i,
        /aaj\s+([a-zA-Z]+)\s+ka\s+weather/i,
        /aaj\s+([a-zA-Z]+)\s+ka\s+mausam/i,
      ];

      for (const rx of cityMatches) {
        const m = norm.match(rx);
        if (m && m[1]) {
          const candidate = m[1].replace(/today|now|tomorrow|batao|kaisa hai|aaj/g, "").trim();
          if (candidate && candidate.length > 2 && !["mere", "mera", "apna", "my", "the"].includes(candidate)) {
            city = candidate;
            break;
          }
        }
      }
    }

    // Capitalize city
    if (city) {
      city = city.charAt(0).toUpperCase() + city.slice(1);
    }

    if (isForecast) {
      return {
        toolName: "weather_forecast",
        args: { location: city || "", days: 3 },
        confidence: 0.95,
        reasoning: "Recognized weather forecast intent.",
        language: lang,
      };
    }

    return {
      toolName: "weather_current",
      args: { location: city || "" },
      confidence: 0.98,
      reasoning: "Recognized current weather retrieval intent.",
      language: lang,
    };
  }

  // ───────────────────────── 2. MEDIA CONTROLS & VOLUME ─────────────────────────
  if (/^(pause|roko|ruk jao|stop\s+music|stop\s+the\s+music|stop\s+playback|gaana\s+roko|pause\s+video|pause\s+playback|pause\s+the\s+music)$/i.test(norm)) {
    return {
      toolName: "youtube_control",
      args: { action: "pause" },
      confidence: 0.95,
      reasoning: "Recognized media pause command.",
      language: lang,
    };
  }
  if (/^(resume|play\s+karo|gaana\s+chalao\s+dobara|unpause|resume\s+playback|continue\s+playback|continue\s+playing)$/i.test(norm)) {
    return {
      toolName: "youtube_control",
      args: { action: "play" },
      confidence: 0.95,
      reasoning: "Recognized media resume command.",
      language: lang,
    };
  }
  if (/^(next\s+track|next\s+song|agla\s+gaana|skip\s+track|skip\s+song)$/i.test(norm)) {
    return {
      toolName: "media_control",
      args: { action: "next" },
      confidence: 0.95,
      reasoning: "Recognized next track command.",
      language: lang,
    };
  }
  if (/^(previous\s+track|prev\s+track|previous\s+song|pechla\s+gaana|pichhla\s+gaana)$/i.test(norm)) {
    return {
      toolName: "media_control",
      args: { action: "previous" },
      confidence: 0.95,
      reasoning: "Recognized previous track command.",
      language: lang,
    };
  }
  if (/volume up|awaz barhao|sound increase|awaz zyada karo/i.test(norm)) {
    return {
      toolName: "media_control",
      args: { action: "volume_up", steps: 5 },
      confidence: 0.95,
      reasoning: "Recognized volume up command.",
      language: lang,
    };
  }
  if (/volume down|awaz kam karo|sound decrease/i.test(norm)) {
    return {
      toolName: "media_control",
      args: { action: "volume_down", steps: 5 },
      confidence: 0.95,
      reasoning: "Recognized volume down command.",
      language: lang,
    };
  }
  if (/mute|awaz band karo/i.test(norm)) {
    return {
      toolName: "media_control",
      args: { action: "mute" },
      confidence: 0.95,
      reasoning: "Recognized mute command.",
      language: lang,
    };
  }

  // ───────────────────────── 3. YOUTUBE MUSIC INTENTS ─────────────────────────
  const musicIntent = extractMusicIntent(command);
  const mentionsYouTube = /youtube|یوٹیوب/.test(norm);

  if (musicIntent.isMusicIntent || mentionsYouTube) {
    // If it's a search command without play intent (e.g. "search youtube for tutorials")
    if (mentionsYouTube && /search|dhundo|dhoondo|talash|سرچ/.test(norm) && !/play|chalao|sunao|gaana|gana|song/.test(norm)) {
      const q = norm.replace(/^(search\s+on\s+youtube|youtube\s+par\s+search\s+karo|search\s+youtube\s+for|youtube\s+search)\s+/i, "");
      return {
        toolName: "youtube_search",
        args: { query: q || norm },
        confidence: 0.9,
        reasoning: "Recognized YouTube search intent.",
        language: lang,
      };
    }

    // Music playback intent
    if (musicIntent.cleanedQuery || musicIntent.artist || musicIntent.song) {
      return {
        toolName: "youtube_play",
        args: {
          query: musicIntent.cleanedQuery || (musicIntent.artist ? `${musicIntent.artist} song` : norm),
          artist: musicIntent.artist,
        },
        confidence: 0.98,
        reasoning: "Recognized YouTube music playback request.",
        language: lang,
      };
    }

    // Bare "play a song" / "gaana chalao"
    return {
      toolName: "youtube_play",
      args: { query: "top hit song" },
      confidence: 0.85,
      reasoning: "Recognized general music playback request.",
      language: lang,
    };
  }

  // ───────────────────────── 4. CHROME & GOOGLE SEARCH INTENTS ─────────────────────────
  // E.g. "Chrome kholo aur Google par search karo", "Open Chrome and search for latest AI news", "کروم کھولو اور گوگل پر سرچ کرو"
  if (/chrome|کروم/.test(norm) && /search|گوگل|google|dhundo|talash|سرچ/.test(norm)) {
    let query = command
      .replace(/^.*?(?:search\s+for|search\s+karo|search|par\s+search\s+karo|google\s+par|پر\s+سرچ\s+کرو)\s*/i, "")
      .trim();

    if (!query || query === "karo" || query === "ye cheez" || query === "ye cheez search karo") {
      query = "latest news";
    }

    return {
      toolName: "browser_search",
      args: { query },
      confidence: 0.96,
      reasoning: "Recognized Chrome Google search intent.",
      language: lang,
    };
  }

  // Direct Google search without explicitly mentioning Chrome
  if (/^google\s+(par|pe)?\s*search\s+karo/i.test(norm) || /^google\s+search\s+/i.test(norm) || /گوگل پر سرچ کرو/.test(norm)) {
    const q = command.replace(/^.*?search(?:\s+for|\s+karo)?\s*/i, "").trim();
    return {
      toolName: "browser_search",
      args: { query: q || "latest updates" },
      confidence: 0.95,
      reasoning: "Recognized Google search intent.",
      language: lang,
    };
  }

  // Open Chrome / browser directly
  if (/^(open\s+chrome|chrome\s+kholo|launch\s+chrome|کروم کھولو)$/i.test(norm)) {
    return {
      toolName: "open_app",
      args: { app: "chrome" },
      confidence: 0.98,
      reasoning: "Recognized launch Chrome intent.",
      language: lang,
    };
  }

  // ───────────────────────── 5. POWER MANAGEMENT ─────────────────────────
  if (/cancel\s+shutdown|stop\s+shutdown|shutdown\s+cancel\s+karo/.test(norm)) {
    return {
      toolName: "power_action",
      args: { action: "cancel_shutdown" },
      confidence: 0.99,
      reasoning: "Recognized cancel shutdown intent.",
      language: lang,
    };
  }
  if (/shut\s*down|laptop\s+band\s+karo|turn\s*off\s*(my\s*)?(laptop|pc|computer)|بند کرو/.test(norm)) {
    return {
      toolName: "power_action",
      args: { action: "shutdown" },
      confidence: 0.99,
      reasoning: "Recognized system shutdown intent.",
      language: lang,
    };
  }
  if (/restart\s*(laptop|pc|computer)?|laptop\s+restart\s+karo/.test(norm)) {
    return {
      toolName: "power_action",
      args: { action: "restart" },
      confidence: 0.99,
      reasoning: "Recognized system restart intent.",
      language: lang,
    };
  }
  if (/lock\s*(laptop|pc|screen)?|screen\s+lock\s+karo/.test(norm)) {
    return {
      toolName: "power_action",
      args: { action: "lock" },
      confidence: 0.99,
      reasoning: "Recognized lock screen intent.",
      language: lang,
    };
  }

  // ───────────────────────── 6. APPS & FOLDERS ─────────────────────────
  if (/notepad\s+kholo|open\s+notepad/i.test(norm)) {
    return {
      toolName: "open_app",
      args: { app: "notepad" },
      confidence: 0.98,
      reasoning: "Recognized open Notepad intent.",
      language: lang,
    };
  }
  if (/calculator\s+kholo|calc\s+kholo|open\s+calculator/i.test(norm)) {
    return {
      toolName: "open_app",
      args: { app: "calculator" },
      confidence: 0.98,
      reasoning: "Recognized open Calculator intent.",
      language: lang,
    };
  }
  if (/vs\s*code\s+kholo|open\s+(vs\s*code|vscode|code)/i.test(norm)) {
    return {
      toolName: "open_app",
      args: { app: "vscode" },
      confidence: 0.98,
      reasoning: "Recognized open VS Code intent.",
      language: lang,
    };
  }
  if (/downloads\s+(folder\s+)?kholo|open\s+downloads(\s+folder)?/i.test(norm)) {
    return {
      toolName: "open_folder",
      args: { path: "Downloads" },
      confidence: 0.98,
      reasoning: "Recognized open Downloads folder intent.",
      language: lang,
    };
  }
  if (/documents\s+(folder\s+)?kholo|open\s+documents(\s+folder)?/i.test(norm)) {
    return {
      toolName: "open_folder",
      args: { path: "Documents" },
      confidence: 0.98,
      reasoning: "Recognized open Documents folder intent.",
      language: lang,
    };
  }

  // ───────────────────────── 7. SYSTEM TELEMETRY ─────────────────────────
  if (/system\s*info|specs|battery|ram|laptop\s+ki\s+detail/i.test(norm)) {
    return {
      toolName: "system_info",
      args: {},
      confidence: 0.95,
      reasoning: "Recognized system info intent.",
      language: lang,
    };
  }

  return null;
}
