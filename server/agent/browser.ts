/**
 * Chrome Browser Control Service for JARVIS / DNYL
 * Uses puppeteer-core to control the actual Google Chrome installation.
 */

import fs from "fs";
import path from "path";
import os from "os";
import puppeteer, { Browser, Page } from "puppeteer-core";
import { runPowerShell } from "./ps";

let browserInstance: Browser | null = null;
let activePage: Page | null = null;
let isLaunching = false;

/**
 * Finds the Chrome executable path on the Windows system.
 */
export function findChromePath(): string | null {
  const custom = process.env.CHROME_PATH;
  if (custom && fs.existsSync(custom)) {
    return custom;
  }

  const standardPaths = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(
      process.env.LOCALAPPDATA || "C:\\Users\\Default\\AppData\\Local",
      "Google\\Chrome\\Application\\chrome.exe"
    ),
    path.join(
      process.env.PROGRAMFILES || "C:\\Program Files",
      "Google\\Chrome\\Application\\chrome.exe"
    ),
  ];

  for (const p of standardPaths) {
    if (fs.existsSync(p)) return p;
  }

  return null;
}

/**
 * Gets a dedicated, safe user data directory for automated Chrome sessions.
 */
function getJarvisUserDataDir(): string {
  const dir = path.join(os.homedir(), ".jarvis_chrome_profile");
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // Ignore
    }
  }
  return dir;
}

/**
 * Ensures a visible Chrome browser instance is running and returns the active page.
 */
export async function getOrLaunchBrowser(): Promise<{ browser: Browser; page: Page }> {
  if (browserInstance && browserInstance.connected) {
    try {
      const pages = await browserInstance.pages();
      const validPage = pages.find((p) => !p.isClosed()) || (await browserInstance.newPage());
      activePage = validPage;
      return { browser: browserInstance, page: activePage };
    } catch {
      browserInstance = null;
      activePage = null;
    }
  }

  if (isLaunching) {
    // Wait for in-flight launch
    let attempts = 0;
    while (isLaunching && attempts < 20) {
      await new Promise((r) => setTimeout(r, 250));
      attempts++;
    }
    if (browserInstance && browserInstance.connected && activePage) {
      return { browser: browserInstance, page: activePage };
    }
  }

  isLaunching = true;
  try {
    const chromePath = findChromePath();
    if (!chromePath) {
      throw new Error(
        "Google Chrome could not be found in standard installation paths. Please ensure Google Chrome is installed on this PC."
      );
    }

    const userDataDir = getJarvisUserDataDir();

    browserInstance = await puppeteer.launch({
      executablePath: chromePath,
      headless: false,
      defaultViewport: null,
      userDataDir,
      args: [
        "--start-maximized",
        "--no-first-run",
        "--no-default-browser-check",
        "--autoplay-policy=no-user-gesture-required",
        "--disable-features=PreloadMediaEngagementData,AutoplayIgnoreWebAudio",
      ],
      ignoreDefaultArgs: ["--enable-automation"],
    });

    browserInstance.on("disconnected", () => {
      browserInstance = null;
      activePage = null;
    });

    const pages = await browserInstance.pages();
    activePage = pages[0] || (await browserInstance.newPage());

    return { browser: browserInstance, page: activePage };
  } finally {
    isLaunching = false;
  }
}

/**
 * Launches Chrome and opens the requested URL.
 */
export async function browserOpenUrl(url: string): Promise<{ ok: boolean; message: string; title?: string; url?: string }> {
  try {
    let target = url.trim();
    if (!/^[a-zA-Z]+:\/\//.test(target)) {
      target = "https://" + target;
    }

    const { page } = await getOrLaunchBrowser();
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 25000 });
    const title = await page.title();
    return {
      ok: true,
      message: `Opened "${title || target}" in Google Chrome.`,
      title,
      url: target,
    };
  } catch (err: any) {
    // Fallback to OS launch if puppeteer failed
    try {
      await runPowerShell(`Start-Process -FilePath chrome -ArgumentList $env:JARVIS_U`, { JARVIS_U: url });
      return {
        ok: true,
        message: `Opened ${url} in Google Chrome (OS window fallback).`,
        url,
      };
    } catch {
      return {
        ok: false,
        message: `Could not open Chrome: ${err?.message || String(err)}`,
      };
    }
  }
}

export interface GoogleSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Performs a real Google search in Chrome, extracts organic results, and keeps page open.
 */
export async function browserGoogleSearch(query: string): Promise<{
  ok: boolean;
  message: string;
  query: string;
  results: GoogleSearchResultItem[];
}> {
  const q = query.trim();
  if (!q) {
    return { ok: false, message: "Search query cannot be empty.", query: "", results: [] };
  }

  try {
    const { page } = await getOrLaunchBrowser();
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 25000 });

    // Handle any cookie / consent dialog if present
    try {
      const consentButtons = await page.$$(
        'button:has-text("Accept all"), button:has-text("I agree"), #L2AGLb, button[aria-label*="Accept"]'
      );
      if (consentButtons.length > 0) {
        await consentButtons[0].click().catch(() => {});
        await new Promise((r) => setTimeout(r, 600));
      }
    } catch {
      // Ignore
    }

    // Extract organic search results
    const results = await page.evaluate(() => {
      const items: { title: string; url: string; snippet: string }[] = [];
      const blocks = document.querySelectorAll("div.g, div[data-sokoban-container]");

      blocks.forEach((b) => {
        const titleEl = b.querySelector("h3");
        const linkEl = b.querySelector("a");
        const snippetEl = b.querySelector("div[style*='-webkit-line-clamp'], .VwiC3b, .yXK7lf");

        const title = titleEl?.textContent?.trim() || "";
        const href = linkEl?.getAttribute("href") || "";
        const snippet = snippetEl?.textContent?.trim() || "";

        if (title && href && href.startsWith("http") && !href.includes("google.com/search")) {
          items.push({ title, url: href, snippet });
        }
      });

      return items.slice(0, 6);
    });

    const summary = results.length > 0
      ? `Found ${results.length} top result(s) on Google for "${q}":\n` +
        results.map((r, i) => `${i + 1}. ${r.title} (${r.url})\n   ${r.snippet}`).join("\n")
      : `Google search for "${q}" opened in Chrome.`;

    return {
      ok: true,
      message: summary,
      query: q,
      results,
    };
  } catch (err: any) {
    // Fallback: open via system process
    await runPowerShell(
      `Start-Process -FilePath chrome -ArgumentList ("https://www.google.com/search?q=" + [uri]::EscapeDataString($env:JARVIS_Q))`,
      { JARVIS_Q: q }
    ).catch(() => {});

    return {
      ok: true,
      message: `Google search for "${q}" opened in Chrome (results page displayed).`,
      query: q,
      results: [],
    };
  }
}

/**
 * Navigates active page to URL.
 */
export async function browserNavigate(url: string): Promise<{ ok: boolean; message: string }> {
  try {
    const { page } = await getOrLaunchBrowser();
    let target = url.trim();
    if (!/^[a-zA-Z]+:\/\//.test(target)) {
      target = "https://" + target;
    }
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 25000 });
    const title = await page.title();
    return { ok: true, message: `Navigated to ${title || target}.` };
  } catch (err: any) {
    return { ok: false, message: `Failed to navigate: ${err?.message || String(err)}` };
  }
}

/**
 * Clicks an interactive element on the page by selector or text content.
 */
export async function browserClick(selectorOrText: string): Promise<{ ok: boolean; message: string }> {
  try {
    const { page } = await getOrLaunchBrowser();
    const query = selectorOrText.trim();

    // Try finding by selector first
    let el = await page.$(query).catch(() => null);

    // If not found, find by visible text matching button, a, or input
    if (!el) {
      const handles = await page.$$("button, a, input[type='button'], input[type='submit'], [role='button']");
      for (const h of handles) {
        const text = await h.evaluate((node) => (node.textContent || (node as HTMLInputElement).value || "").trim().toLowerCase());
        if (text && (text === query.toLowerCase() || text.includes(query.toLowerCase()))) {
          el = h;
          break;
        }
      }
    }

    if (!el) {
      return { ok: false, message: `Could not find an element matching "${selectorOrText}" to click.` };
    }

    await el.evaluate((node: any) => node?.scrollIntoView?.({ behavior: "smooth", block: "center" })).catch(() => {});
    await el.click();
    return { ok: true, message: `Clicked "${selectorOrText}".` };
  } catch (err: any) {
    return { ok: false, message: `Click action failed: ${err?.message || String(err)}` };
  }
}

/**
 * Types text into an input field in the browser.
 */
export async function browserType(selector: string, text: string): Promise<{ ok: boolean; message: string }> {
  try {
    const { page } = await getOrLaunchBrowser();
    const sel = selector.trim();
    let el = await page.$(sel).catch(() => null);

    if (!el) {
      // Try generic input or textarea
      el = await page.$("input[type='text'], input[type='search'], input:not([type]), textarea");
    }

    if (!el) {
      return { ok: false, message: `Could not find input field "${selector}".` };
    }

    await el.focus();
    await page.keyboard.type(text, { delay: 20 });
    return { ok: true, message: `Typed "${text.slice(0, 30)}${text.length > 30 ? "..." : ""}" into ${selector}.` };
  } catch (err: any) {
    return { ok: false, message: `Type action failed: ${err?.message || String(err)}` };
  }
}

/**
 * Reads readable text content from the current active Chrome page.
 */
export async function browserReadPage(maxChars = 8000): Promise<{ ok: boolean; message: string; content?: string; title?: string }> {
  try {
    const { page } = await getOrLaunchBrowser();
    const title = await page.title();
    const text = await page.evaluate(() => {
      const clone = document.body.cloneNode(true) as HTMLElement;
      // Remove scripts, styles, etc.
      clone.querySelectorAll("script, style, noscript, svg, nav, footer, header").forEach((n) => n.remove());
      return clone.innerText || "";
    });

    const cleaned = text.replace(/\n\s*\n+/g, "\n\n").trim();
    const truncated = cleaned.slice(0, maxChars);

    return {
      ok: true,
      title,
      content: truncated,
      message: `Read "${title}" (${truncated.length} characters extracted).`,
    };
  } catch (err: any) {
    return { ok: false, message: `Could not read page: ${err?.message || String(err)}` };
  }
}

/**
 * Scrolls the active page up or down.
 */
export async function browserScroll(direction: "up" | "down", amount = 600): Promise<{ ok: boolean; message: string }> {
  try {
    const { page } = await getOrLaunchBrowser();
    const delta = direction === "down" ? Math.abs(amount) : -Math.abs(amount);
    await page.evaluate((y) => window.scrollBy({ top: y, behavior: "smooth" }), delta);
    return { ok: true, message: `Scrolled page ${direction} by ${Math.abs(amount)}px.` };
  } catch (err: any) {
    return { ok: false, message: `Scroll failed: ${err?.message || String(err)}` };
  }
}

/**
 * Tab management: list, switch, close.
 */
export async function browserTabAction(action: "list" | "switch" | "close" | "new", tabIndex?: number): Promise<{ ok: boolean; message: string; tabs?: { index: number; title: string; url: string }[] }> {
  try {
    const { browser } = await getOrLaunchBrowser();
    const pages = await browser.pages();

    if (action === "new") {
      const newP = await browser.newPage();
      activePage = newP;
      return { ok: true, message: `Opened new tab (total ${pages.length + 1}).` };
    }

    const tabList = await Promise.all(
      pages.map(async (p, idx) => ({
        index: idx,
        title: (await p.title()) || "Untitled",
        url: p.url() || "about:blank",
      }))
    );

    if (action === "list") {
      const summary = tabList.map((t) => `[${t.index}] ${t.title} (${t.url})`).join("\n");
      return { ok: true, message: `Active Chrome tabs (${pages.length}):\n${summary}`, tabs: tabList };
    }

    if (tabIndex != null && tabIndex >= 0 && tabIndex < pages.length) {
      if (action === "switch") {
        await pages[tabIndex].bringToFront();
        activePage = pages[tabIndex];
        return { ok: true, message: `Switched to tab [${tabIndex}] "${tabList[tabIndex]?.title}".` };
      }
      if (action === "close") {
        const title = tabList[tabIndex]?.title;
        await pages[tabIndex].close();
        return { ok: true, message: `Closed tab [${tabIndex}] "${title}".` };
      }
    }

    return { ok: false, message: `Invalid tab index: ${tabIndex}. Available tabs: 0 to ${pages.length - 1}.` };
  } catch (err: any) {
    return { ok: false, message: `Tab action failed: ${err?.message || String(err)}` };
  }
}

/**
 * Checks Chrome connection status.
 */
export function isBrowserConnected(): boolean {
  return Boolean(browserInstance && browserInstance.connected);
}
