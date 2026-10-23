import { describe, it, expect } from "vitest";
import { getCurrentWeather, getWeatherForecast, resolveLocation } from "../agent/weather";

describe("Weather Service Unit and Integration Tests", () => {
  it("resolves specific city coordinates accurately", async () => {
    const loc = await resolveLocation("Karachi");
    expect(loc.name.toLowerCase()).toContain("karachi");
    expect(loc.latitude).toBeCloseTo(24.86, 1);
    expect(loc.longitude).toBeCloseTo(67.01, 1);
  });

  it("handles unknown locations gracefully with helpful error", async () => {
    await expect(resolveLocation("NonExistentCityXYZ9999")).rejects.toThrow(
      /could not be found/i
    );
  });

  it("retrieves real current weather data without fabricating values", async () => {
    const res = await getCurrentWeather("Karachi", "metric");
    expect(res.ok).toBe(true);
    expect(res.data).toBeDefined();

    const cur = res.data!.current;
    expect(cur.temperature).toBeTypeOf("number");
    expect(cur.feelsLike).toBeTypeOf("number");
    expect(cur.humidity).toBeGreaterThanOrEqual(0);
    expect(cur.humidity).toBeLessThanOrEqual(100);
    expect(cur.condition).toBeTruthy();
    expect(cur.conditionUrdu).toBeTruthy();
    expect(res.data!.units.temperature).toBe("°C");
    expect(res.data!.source).toBe("Open-Meteo");

    // Message must include location, temperature, humidity, and condition
    expect(res.message).toContain("Karachi");
    expect(res.message).toContain("°C");
  });

  it("retrieves weather forecast with daily projections", async () => {
    const res = await getWeatherForecast("Karachi", 3, "metric");
    expect(res.ok).toBe(true);
    expect(res.data).toBeDefined();
    expect(res.data!.days.length).toBe(3);

    const firstDay = res.data!.days[0];
    expect(firstDay.dayOfWeek).toBeTruthy();
    expect(firstDay.maxTemp).toBeTypeOf("number");
    expect(firstDay.minTemp).toBeTypeOf("number");
    expect(firstDay.condition).toBeTruthy();
  });

  it("handles local weather request using IP geolocation fallback", async () => {
    const res = await getCurrentWeather("", "metric");
    expect(res.ok).toBe(true);
    expect(res.data?.location).toBeTruthy();
    expect(res.data?.current.temperature).toBeTypeOf("number");
  });
});
