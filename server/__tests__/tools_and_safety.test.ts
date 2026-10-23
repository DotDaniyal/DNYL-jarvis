import { describe, it, expect } from "vitest";
import { classifyRisk, describeCall, executeTool, isKnownTool } from "../agent/tools";

describe("Tool Registry and Safety Permissions", () => {
  it("recognizes all standard and new tools", () => {
    expect(isKnownTool("weather_current")).toBe(true);
    expect(isKnownTool("weather_forecast")).toBe(true);
    expect(isKnownTool("youtube_play")).toBe(true);
    expect(isKnownTool("youtube_control")).toBe(true);
    expect(isKnownTool("browser_search")).toBe(true);
    expect(isKnownTool("browser_open")).toBe(true);
    expect(isKnownTool("power_action")).toBe(true);
    expect(isKnownTool("unknown_arbitrary_tool")).toBe(false);
  });

  it("strictly classifies destructive actions", () => {
    expect(classifyRisk("power_action", { action: "shutdown" })).toBe("destructive");
    expect(classifyRisk("power_action", { action: "restart" })).toBe("destructive");
    expect(classifyRisk("delete_file", { path: "some/file.txt" })).toBe("destructive");
  });

  it("classifies sensitive and low-risk actions correctly", () => {
    expect(classifyRisk("power_action", { action: "cancel_shutdown" })).toBe("low");
    expect(classifyRisk("close_app", { app: "chrome" })).toBe("sensitive");
    expect(classifyRisk("weather_current", {})).toBe("low");
    expect(classifyRisk("youtube_play", { query: "Atif Aslam" })).toBe("low");
    expect(classifyRisk("browser_search", { query: "AI news" })).toBe("low");
  });

  it("generates honest call descriptions", () => {
    expect(describeCall("weather_current", { location: "Karachi" })).toContain("Karachi");
    expect(describeCall("youtube_play", { query: "Tajdar-e-Haram", artist: "Atif Aslam" })).toContain("Tajdar-e-Haram");
    expect(describeCall("power_action", { action: "shutdown" })).toContain("Shut down");
  });

  it("handles invalid tool calls safely without throwing uncaught errors", async () => {
    const res = await executeTool("non_existent_tool", {});
    expect(res.ok).toBe(false);
    expect(res.message).toContain("Unknown tool");
  });
});
