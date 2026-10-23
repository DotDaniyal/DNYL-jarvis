import { describe, it, expect } from "vitest";
import { searchYouTube, extractMusicIntent } from "../agent/youtube";

describe("YouTube Music Integration Tests", () => {
  it("searches YouTube and extracts valid video results", async () => {
    const results = await searchYouTube("Atif Aslam", 3);
    expect(results.length).toBeGreaterThan(0);

    const first = results[0];
    expect(first.id).toBeTruthy();
    expect(first.id.length).toBe(11);
    expect(first.title).toBeTruthy();
    expect(first.channel).toBeTruthy();
    expect(first.url).toContain("https://www.youtube.com/watch?v=");
  });

  it("handles complex Roman Urdu song queries", async () => {
    const intent = extractMusicIntent("Atif Aslam ka gaana chalao");
    expect(intent.isMusicIntent).toBe(true);

    const results = await searchYouTube(intent.cleanedQuery || "Atif Aslam song", 3);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title.toLowerCase()).toContain("atif aslam");
  });
});
