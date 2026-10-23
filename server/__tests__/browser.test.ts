import { describe, it, expect } from "vitest";
import { findChromePath, browserGoogleSearch } from "../agent/browser";

describe("Google Chrome Browser Service Tests", () => {
  it("detects installed Google Chrome executable path on the machine", () => {
    const chromePath = findChromePath();
    expect(chromePath).toBeTruthy();
    expect(chromePath?.toLowerCase()).toContain("chrome.exe");
  });

  it("handles empty or invalid Google search queries safely", async () => {
    const res = await browserGoogleSearch("");
    expect(res.ok).toBe(false);
    expect(res.message).toContain("empty");
  });
});
