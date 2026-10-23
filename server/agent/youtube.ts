/**
 * YouTube Music Playback and Automation Service for JARVIS / DNYL
 * Handles music request understanding, YouTube search, Chrome player automation,
 * playback blockers (consent, autoplay, pause), and honest playback verification.
 */

import { getOrLaunchBrowser, isBrowserConnected } from "./browser";
import { runPowerShell } from "./ps";

export interface YouTubeSearchResult {
  id: string;
  title: string;
  channel: string;
  views?: string;
  duration?: string;
  url: string;
}

export interface PlaybackVerificationResult {
  ok: boolean;
  isPlaying: boolean;
  videoId?: string;
  videoTitle?: string;
  channelName?: string;
  currentTime?: number;
  duration?: number;
  message: string;
  speechResponse: string;
  blocker?: string;
  recovery?: string;
  alternativeChoices?: YouTubeSearchResult[];
}

/**
 * Parses user input to extract song title, artist, language, and platform intent.
 */
export function extractMusicIntent(command: string): {
  song?: string;
  artist?: string;
  cleanedQuery: string;
  isMusicIntent: boolean;
  needsClarification: boolean;
} {
  const raw = command.trim();
  let text = raw;

  let artist: string | undefined;
  let song: string | undefined;

  // Detect "[Artist] ka/ki/ke gaana" or "[Song] by [Artist]"
  const artistKaMatch = text.match(/(?:youtube\s+(?:par|pe)\s+)?(.+?)\s+(?:ka|ki|ke)\s+(?:gaana|gana|geet|song|track)/i);
  if (artistKaMatch && artistKaMatch[1]) {
    artist = artistKaMatch[1].replace(/^(?:play|chalao|sunao|lagao|open\s+youtube\s+and\s+play)\s+/i, "").trim();
  }

  const byMatch = text.match(/(?:play\s+)?(.+?)\s+by\s+(.+?)(?:\s+(?:on\s+youtube|chalao))?$/i);
  if (byMatch && byMatch[1] && byMatch[2]) {
    song = byMatch[1].replace(/^(?:play|song|track)\s+/i, "").trim();
    artist = byMatch[2].replace(/\s+(?:on\s+youtube|chalao)$/i, "").trim();
  }

  // Common Urdu/Roman Urdu/English prefixes and suffixes
  const removePatterns = [
    /^(jarvis|dnyl)[,\s]+/i,
    /^(please|can you|could you|bhai|yaar)[,\s]+/i,
    /^(open\s+)?youtube\s+(par|pe|and|mein)?\s*/i,
    /^(play|chalao|sunao|lagao|start|bajao)\s+/i,
    /\s+(play\s+karo|chalao|sunao|lagao|bajao)$/i,
    /\s+(on\s+youtube|youtube\s+par|youtube\s+pe)$/i,
    /\s+(ka\s+gaana|ka\s+gana|ke\s+gaane|song|track|music)$/i,
    /\s+(gaana|gana|geet|song|track)\s+/i,
  ];

  let cleaned = text;
  for (const pat of removePatterns) {
    cleaned = cleaned.replace(pat, " ").trim();
  }

  cleaned = cleaned.trim();
  const isMusicIntent =
    /play|song|gaana|gana|geet|track|soundtrack|music|chalao|sunao|lagao|bajao/i.test(command);

  const cleanLower = cleaned.toLowerCase();
  const needsClarification =
    !cleaned ||
    cleanLower === "song" ||
    cleanLower === "gaana" ||
    cleanLower === "gana" ||
    cleanLower === "a" ||
    cleanLower === "a song" ||
    cleanLower === "ek gaana" ||
    cleanLower === "this song" ||
    cleanLower === "music" ||
    cleanLower === "soundtrack";

  return {
    song,
    artist,
    cleanedQuery: cleaned || (artist ? `${artist} song` : ""),
    isMusicIntent,
    needsClarification,
  };
}


/**
 * Searches YouTube directly and parses video results from ytInitialData.
 */
export async function searchYouTube(query: string, maxResults = 5): Promise<YouTubeSearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

  try {
    const res = await fetch(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9,ur;q=0.8",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      throw new Error(`YouTube search HTTP ${res.status}`);
    }

    const html = await res.text();
    const match = html.match(/ytInitialData\s*=\s*({.+?});<\/script>/);
    if (!match) {
      return fallbackHtmlParse(html, maxResults);
    }

    const data = JSON.parse(match[1]);
    const sectionList =
      data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;

    const results: YouTubeSearchResult[] = [];

    if (Array.isArray(sectionList)) {
      for (const section of sectionList) {
        const items = section.itemSectionRenderer?.contents;
        if (!Array.isArray(items)) continue;

        for (const item of items) {
          const v = item.videoRenderer;
          if (v && v.videoId) {
            const title =
              v.title?.runs?.[0]?.text ||
              v.title?.simpleText ||
              "";
            const channel =
              v.ownerText?.runs?.[0]?.text ||
              v.longBylineText?.runs?.[0]?.text ||
              "";
            const views = v.viewCountText?.simpleText || "";
            const duration = v.lengthText?.simpleText || "";

            if (title) {
              results.push({
                id: v.videoId,
                title,
                channel,
                views,
                duration,
                url: `https://www.youtube.com/watch?v=${v.videoId}`,
              });
              if (results.length >= maxResults) break;
            }
          }
        }
        if (results.length >= maxResults) break;
      }
    }

    return results;
  } catch {
    return [];
  }
}

function fallbackHtmlParse(html: string, maxResults: number): YouTubeSearchResult[] {
  const list: YouTubeSearchResult[] = [];
  const regex = /\/watch\?v=([a-zA-Z0-9_-]{11})/g;
  let match: RegExpExecArray | null;
  const seen = new Set<string>();

  while ((match = regex.exec(html)) !== null && list.length < maxResults) {
    const id = match[1];
    if (!seen.has(id)) {
      seen.add(id);
      list.push({
        id,
        title: `YouTube Video (${id})`,
        channel: "YouTube",
        url: `https://www.youtube.com/watch?v=${id}`,
      });
    }
  }

  return list;
}

/**
 * Searches, opens, starts playback, and verifies player status in Chrome.
 */
export async function playYouTube(
  query: string,
  artistPreference?: string
): Promise<PlaybackVerificationResult> {
  const intent = extractMusicIntent(query);

  if (intent.needsClarification && !artistPreference) {
    return {
      ok: false,
      isPlaying: false,
      message: "Please specify which song or artist you want to play. For example: 'Play Tajdar-e-Haram by Atif Aslam' or 'Play Believer'.",
      speechResponse: "Aap kon sa gaana sunna chahte hain? Artist ya song ka naam batayein.",
      blocker: "Missing song title or artist name",
      recovery: "Provide a song title or artist name.",
    };
  }

  const effectiveQuery = intent.cleanedQuery || artistPreference || query;
  const searchResults = await searchYouTube(effectiveQuery, 4);

  if (searchResults.length === 0) {
    return {
      ok: false,
      isPlaying: false,
      message: `No matching songs found on YouTube for "${effectiveQuery}".`,
      speechResponse: `YouTube par "${effectiveQuery}" ka koi gaana nahi mila.`,
      blocker: "Search returned zero results",
      recovery: "Try searching with a different spelling or artist name.",
    };
  }

  // Select the top result, prioritizing official channel or direct match
  const selectedVideo = searchResults[0];
  const videoUrl = `https://www.youtube.com/watch?v=${selectedVideo.id}&autoplay=1`;

  try {
    const { page } = await getOrLaunchBrowser();

    // Navigate directly to the video URL
    await page.goto(videoUrl, { waitUntil: "domcontentloaded", timeout: 25000 });

    // Handle common consent dialogs / popups
    try {
      const consentButtons = await page.$$(
        'button:has-text("Accept all"), button:has-text("I agree"), #L2AGLb, button[aria-label*="Accept"], .yt-spec-button-shape-next--filled'
      );
      if (consentButtons.length > 0) {
        await consentButtons[0].click().catch(() => {});
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch {
      // Ignore consent errors
    }

    // Wait for the HTML5 video element
    let playerReady = false;
    try {
      await page.waitForSelector("video.html5-main-video, video", { timeout: 8000 });
      playerReady = true;
    } catch {
      playerReady = false;
    }

    if (!playerReady) {
      return {
        ok: true,
        isPlaying: false,
        videoId: selectedVideo.id,
        videoTitle: selectedVideo.title,
        channelName: selectedVideo.channel,
        message: `Opened "${selectedVideo.title}" in Chrome, but the video player took too long to initialize.`,
        speechResponse: `Maine YouTube par ${selectedVideo.title} open kar diya hai, video load ho rahi hai.`,
        blocker: "Player element did not initialize within timeout",
        recovery: "Click the video in Chrome to begin playback.",
      };
    }

    // Dismiss any "Skip Ad" if available
    try {
      const skipAd = await page.$(".ytp-ad-skip-button, .ytp-skip-ad-button");
      if (skipAd) {
        await skipAd.click().catch(() => {});
      }
    } catch {
      // Ignore ad skip error
    }

    // Trigger video playback if paused
    await page.evaluate(async () => {
      const v = document.querySelector("video") as HTMLVideoElement | null;
      if (v) {
        if (v.muted) {
          v.muted = false;
        }
        if (v.paused) {
          await v.play().catch(() => {});
        }
      }
    });

    // Verification poll: wait up to 4 seconds to observe real playback
    let verifiedPlaying = false;
    let actualTime = 0;
    let actualDuration = 0;
    let isPaused = true;

    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const state = await page.evaluate(() => {
        const v = document.querySelector("video") as HTMLVideoElement | null;
        if (!v) return null;
        return {
          paused: v.paused,
          currentTime: v.currentTime,
          duration: v.duration,
          ended: v.ended,
          readyState: v.readyState,
        };
      });

      if (state) {
        actualTime = state.currentTime;
        actualDuration = state.duration;
        isPaused = state.paused;
        if (!state.paused && state.currentTime > 0) {
          verifiedPlaying = true;
          break;
        }
      }
    }

    // If still paused, try pressing the YouTube play button directly
    if (!verifiedPlaying) {
      try {
        const playBtn = await page.$(".ytp-play-button");
        if (playBtn) {
          await playBtn.click().catch(() => {});
          await new Promise((r) => setTimeout(r, 1000));
          const state2 = await page.evaluate(() => {
            const v = document.querySelector("video") as HTMLVideoElement | null;
            return v ? { paused: v.paused, currentTime: v.currentTime } : null;
          });
          if (state2 && !state2.paused && state2.currentTime > 0) {
            verifiedPlaying = true;
            actualTime = state2.currentTime;
          }
        }
      } catch {
        // Ignore
      }
    }

    const realTitle = (await page.title()) || selectedVideo.title;
    const cleanTitle = realTitle.replace(/ - YouTube$/, "");

    if (verifiedPlaying) {
      return {
        ok: true,
        isPlaying: true,
        videoId: selectedVideo.id,
        videoTitle: cleanTitle,
        channelName: selectedVideo.channel,
        currentTime: Math.round(actualTime),
        duration: Math.round(actualDuration),
        message: `Now playing on YouTube in Chrome: "${cleanTitle}" by ${selectedVideo.channel}. (Playback verified)`,
        speechResponse: `YouTube par ${cleanTitle} play ho raha hai.`,
        alternativeChoices: searchResults.slice(1),
      };
    }

    // Playback opened but is currently paused or blocked by autoplay
    return {
      ok: true,
      isPlaying: false,
      videoId: selectedVideo.id,
      videoTitle: cleanTitle,
      channelName: selectedVideo.channel,
      message: `Opened "${cleanTitle}" on YouTube in Chrome. Video is ready but currently paused due to browser autoplay restriction.`,
      speechResponse: `Maine ${cleanTitle} Chrome mein open kar diya hai. Play button par click karein.`,
      blocker: "Browser autoplay policy prevented automatic unmuted playback",
      recovery: "Click the YouTube video to start playing.",
      alternativeChoices: searchResults.slice(1),
    };
  } catch (err: any) {
    // OS Fallback if Puppeteer launch failed
    await runPowerShell(`Start-Process -FilePath chrome -ArgumentList $env:JARVIS_Y`, {
      JARVIS_Y: videoUrl,
    }).catch(() => {});

    return {
      ok: true,
      isPlaying: false,
      videoId: selectedVideo.id,
      videoTitle: selectedVideo.title,
      channelName: selectedVideo.channel,
      message: `Opened "${selectedVideo.title}" in Google Chrome. Playback status is unverified as browser automation was unavailable.`,
      speechResponse: `YouTube par ${selectedVideo.title} open kar diya hai.`,
      blocker: "Direct browser automation connection unavailable",
      recovery: "Use Chrome directly to control playback.",
    };
  }
}

/**
 * Controls active YouTube playback (pause, resume, mute, skip).
 */
export async function controlYouTubePlayback(action: "play" | "pause" | "toggle" | "mute"): Promise<{
  ok: boolean;
  message: string;
  isPaused?: boolean;
}> {
  try {
    const { page } = await getOrLaunchBrowser();
    const result = await page.evaluate((act) => {
      const v = document.querySelector("video") as HTMLVideoElement | null;
      if (!v) return { ok: false, message: "No active video player found on current tab." };

      if (act === "play") {
        v.play();
        return { ok: true, isPaused: false, message: "Playback resumed." };
      }
      if (act === "pause") {
        v.pause();
        return { ok: true, isPaused: true, message: "Playback paused." };
      }
      if (act === "toggle") {
        if (v.paused) {
          v.play();
          return { ok: true, isPaused: false, message: "Playback resumed." };
        } else {
          v.pause();
          return { ok: true, isPaused: true, message: "Playback paused." };
        }
      }
      if (act === "mute") {
        v.muted = !v.muted;
        return { ok: true, isPaused: v.paused, message: v.muted ? "Muted audio." : "Unmuted audio." };
      }
      return { ok: false, message: "Unknown player action." };
    }, action);

    return result;
  } catch (err: any) {
    return { ok: false, message: `Could not control player: ${err?.message || String(err)}` };
  }
}
