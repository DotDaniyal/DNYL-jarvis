import { describe, it, expect } from "vitest";
import { routeDirectIntent, detectLanguage } from "../agent/router";
import { extractMusicIntent } from "../agent/youtube";

describe("Language and Music Intent Extraction", () => {
  it("detects English commands accurately", () => {
    expect(detectLanguage("What is the current weather?")).toBe("en");
    expect(detectLanguage("Play Believer on YouTube")).toBe("en");
    expect(detectLanguage("Open Chrome and search for AI news")).toBe("en");
  });

  it("detects Roman Urdu commands accurately", () => {
    expect(detectLanguage("YouTube par Atif Aslam ka gaana chalao")).toBe("roman_ur");
    expect(detectLanguage("Aaj Karachi ka weather batao")).toBe("roman_ur");
    expect(detectLanguage("Chrome kholo aur Google par search karo")).toBe("roman_ur");
    expect(detectLanguage("Downloads folder kholo")).toBe("roman_ur");
  });

  it("detects Urdu script commands accurately", () => {
    expect(detectLanguage("میرے شہر کا موسم بتاؤ")).toBe("ur");
    expect(detectLanguage("کروم کھولو اور گوگل پر یہ چیز سرچ کرو")).toBe("ur");
    expect(detectLanguage("یوٹیوب پر گانا چلاؤ")).toBe("ur");
  });

  it("extracts song title and artist from music commands", () => {
    const r1 = extractMusicIntent("YouTube par Atif Aslam ka gaana chalao");
    expect(r1.isMusicIntent).toBe(true);
    expect(r1.artist?.toLowerCase()).toContain("atif aslam");

    const r2 = extractMusicIntent("Play Tajdar-e-Haram by Atif Aslam on YouTube");
    expect(r2.isMusicIntent).toBe(true);
    expect(r2.artist?.toLowerCase()).toContain("atif aslam");
    expect(r2.song?.toLowerCase()).toContain("tajdar-e-haram");

    const r3 = extractMusicIntent("Play Believer");
    expect(r3.isMusicIntent).toBe(true);
    expect(r3.cleanedQuery.toLowerCase()).toContain("believer");
  });

  it("flags missing song or artist when command is vague", () => {
    const r = extractMusicIntent("Play a song");
    expect(r.isMusicIntent).toBe(true);
    expect(r.needsClarification).toBe(true);
  });
});

describe("Deterministic Tool Routing", () => {
  it("routes weather requests in English, Roman Urdu, and Urdu", () => {
    const r1 = routeDirectIntent("What's the weather right now?");
    expect(r1?.toolName).toBe("weather_current");

    const r2 = routeDirectIntent("Aaj Karachi ka weather batao");
    expect(r2?.toolName).toBe("weather_current");
    expect(r2?.args.location).toBe("Karachi");

    const r3 = routeDirectIntent("میرے شہر کا موسم بتاؤ");
    expect(r3?.toolName).toBe("weather_current");

    const r4 = routeDirectIntent("What will the weather be like tomorrow?");
    expect(r4?.toolName).toBe("weather_forecast");
  });

  it("routes YouTube music requests", () => {
    const r1 = routeDirectIntent("YouTube par Atif Aslam ka gaana chalao");
    expect(r1?.toolName).toBe("youtube_play");
    expect(r1?.args.artist?.toLowerCase()).toContain("atif aslam");

    const r2 = routeDirectIntent("Open YouTube and play this song");
    expect(r2?.toolName).toBe("youtube_play");
  });

  it("routes Chrome search commands", () => {
    const r1 = routeDirectIntent("Chrome kholo aur Google par search karo");
    expect(r1?.toolName).toBe("browser_search");

    const r2 = routeDirectIntent("Open Chrome and search for the latest AI news");
    expect(r2?.toolName).toBe("browser_search");
    expect(r2?.args.query).toContain("AI news");

    const r3 = routeDirectIntent("کروم کھولو اور گوگل پر یہ چیز سرچ کرو");
    expect(r3?.toolName).toBe("browser_search");
  });

  it("routes power actions and flags shutdown", () => {
    const r1 = routeDirectIntent("Shut down my laptop");
    expect(r1?.toolName).toBe("power_action");
    expect(r1?.args.action).toBe("shutdown");

    const r2 = routeDirectIntent("Laptop restart karo");
    expect(r2?.toolName).toBe("power_action");
    expect(r2?.args.action).toBe("restart");

    const r3 = routeDirectIntent("Cancel shutdown");
    expect(r3?.toolName).toBe("power_action");
    expect(r3?.args.action).toBe("cancel_shutdown");
  });

  it("routes media playback controls and track navigation", () => {
    const r1 = routeDirectIntent("pause");
    expect(r1?.toolName).toBe("youtube_control");
    expect(r1?.args.action).toBe("pause");

    const r2 = routeDirectIntent("stop the music");
    expect(r2?.toolName).toBe("youtube_control");
    expect(r2?.args.action).toBe("pause");

    const r3 = routeDirectIntent("resume playback");
    expect(r3?.toolName).toBe("youtube_control");
    expect(r3?.args.action).toBe("play");

    const r4 = routeDirectIntent("next track");
    expect(r4?.toolName).toBe("media_control");
    expect(r4?.args.action).toBe("next");

    const r5 = routeDirectIntent("pechla gaana");
    expect(r5?.toolName).toBe("media_control");
    expect(r5?.args.action).toBe("previous");

    const r6 = routeDirectIntent("awaz barhao");
    expect(r6?.toolName).toBe("media_control");
    expect(r6?.args.action).toBe("volume_up");
  });

  it("handles gaming soundtrack and theme queries", () => {
    const r = extractMusicIntent("play gaming soundtrack");
    expect(r.isMusicIntent).toBe(true);
    expect(r.needsClarification).toBe(false);
    expect(r.cleanedQuery.toLowerCase()).toContain("gaming soundtrack");

    const routed = routeDirectIntent("play gaming soundtrack");
    expect(routed?.toolName).toBe("youtube_play");
    expect(routed?.args.query.toLowerCase()).toContain("gaming soundtrack");
  });

  it("flags vague music requests for clarification", () => {
    expect(extractMusicIntent("play a song").needsClarification).toBe(true);
    expect(extractMusicIntent("play music").needsClarification).toBe(true);
    expect(extractMusicIntent("ek gaana").needsClarification).toBe(true);
  });
});

describe("Duplicate Command Prevention", () => {
  it("detects and avoids rapid duplicate command dispatch", async () => {
    const { isDuplicateCommand, executeCommand, clearTaskHistoryForTest } = await import("../agent/planner");
    clearTaskHistoryForTest();

    expect(isDuplicateCommand("Play Believer").isDuplicate).toBe(false);

    const task1 = await executeCommand("What's the weather right now?");
    expect(task1).toBeDefined();

    const dedupCheck = isDuplicateCommand("What's the weather right now?");
    expect(dedupCheck.isDuplicate).toBe(true);
    expect(dedupCheck.previousTask?.id).toBe(task1.id);

    // Calling executeCommand again with the same command within the window returns the same task
    const task2 = await executeCommand("What's the weather right now?");
    expect(task2.id).toBe(task1.id);

    clearTaskHistoryForTest();
  });
});
