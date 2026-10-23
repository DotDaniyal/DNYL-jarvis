/**
 * Weather Service for JARVIS / DNYL
 * Powered by Open-Meteo API (High precision, reliable, no API key required, global coverage)
 * and IP-based geolocation for local weather requests.
 */

export interface WeatherData {
  location: string;
  country?: string;
  coordinates: { latitude: number; longitude: number };
  current: {
    temperature: number;
    feelsLike: number;
    humidity: number;
    weatherCode: number;
    condition: string;
    conditionUrdu: string;
    windSpeed: number;
    isDay: boolean;
    rainProbability?: number;
    precipitation: number;
  };
  daily?: {
    maxTemp: number;
    minTemp: number;
    maxRainProbability?: number;
    condition: string;
  };
  units: {
    temperature: string;
    windSpeed: string;
    precipitation: string;
  };
  timestamp: string;
  source: string;
}

export interface ForecastDay {
  date: string;
  dayOfWeek: string;
  maxTemp: number;
  minTemp: number;
  condition: string;
  conditionUrdu: string;
  rainProbability: number;
  windSpeedMax: number;
}

export interface WeatherForecastData {
  location: string;
  country?: string;
  days: ForecastDay[];
  units: {
    temperature: string;
    windSpeed: string;
  };
  source: string;
}

// WMO Weather interpretation codes (WW)
const WMO_CODES: Record<number, { en: string; ur: string }> = {
  0: { en: "Clear sky", ur: "صاف آسمان" },
  1: { en: "Mainly clear", ur: "زیادہ تر صاف" },
  2: { en: "Partly cloudy", ur: "جزوی طور پر ابر آلود" },
  3: { en: "Overcast", ur: "مکمل ابر آلود" },
  45: { en: "Foggy", ur: "دھند" },
  48: { en: "Depositing rime fog", ur: "شدید کہرا" },
  51: { en: "Light drizzle", ur: "ہلکی بونداباندی" },
  53: { en: "Moderate drizzle", ur: "درمیانی بونداباندی" },
  55: { en: "Dense drizzle", ur: "تیز بونداباندی" },
  56: { en: "Light freezing drizzle", ur: "ہلکی سرد بونداباندی" },
  57: { en: "Dense freezing drizzle", ur: "تیز سرد بونداباندی" },
  61: { en: "Slight rain", ur: "ہلکی بارش" },
  63: { en: "Moderate rain", ur: "درمیانی بارش" },
  65: { en: "Heavy rain", ur: "تیز بارش" },
  66: { en: "Light freezing rain", ur: "سرد بارش" },
  67: { en: "Heavy freezing rain", ur: "شدید سرد بارش" },
  71: { en: "Slight snow fall", ur: "ہلکی برف باری" },
  73: { en: "Moderate snow fall", ur: "درمیانی برف باری" },
  75: { en: "Heavy snow fall", ur: "شدید برف باری" },
  77: { en: "Snow grains", ur: "برف کے دانے" },
  80: { en: "Slight rain showers", ur: "ہلکی بوچھاڑ" },
  81: { en: "Moderate rain showers", ur: "درمیانی بارش کی بوچھاڑ" },
  82: { en: "Violent rain showers", ur: "طوفانی بارش کی بوچھاڑ" },
  85: { en: "Slight snow showers", ur: "ہلکی برفانی بوچھاڑ" },
  86: { en: "Heavy snow showers", ur: "شدید برفانی بوچھاڑ" },
  95: { en: "Thunderstorm", ur: "گرج چمک کے ساتھ طوفان" },
  96: { en: "Thunderstorm with slight hail", ur: "ژالہ باری اور طوفان" },
  99: { en: "Thunderstorm with heavy hail", ur: "شدید ژالہ باری اور طوفان" },
};

function decodeWeatherCode(code: number): { en: string; ur: string } {
  return WMO_CODES[code] || { en: "Variable conditions", ur: "متغیر موسم" };
}

/**
 * Resolves user location via IP or default configuration when no city is passed.
 */
export async function resolveLocation(queryCity?: string): Promise<{
  name: string;
  country?: string;
  latitude: number;
  longitude: number;
}> {
  const trimmed = queryCity?.trim();

  // If a specific city was requested
  if (trimmed && !isLocalWeatherKeyword(trimmed)) {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      trimmed
    )}&count=1&language=en&format=json`;
    const res = await fetch(geoUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      throw new Error(`Geocoding service returned status ${res.status}`);
    }
    const data = (await res.json()) as any;
    const match = data.results?.[0];
    if (!match) {
      throw new Error(`Location "${trimmed}" could not be found. Please check spelling or try another nearby city.`);
    }
    return {
      name: match.name,
      country: match.country,
      latitude: match.latitude,
      longitude: match.longitude,
    };
  }

  // Check default city from environment
  const defaultCity = process.env.DEFAULT_WEATHER_CITY || process.env.JARVIS_CITY;
  if (defaultCity && defaultCity.trim() && !isLocalWeatherKeyword(defaultCity)) {
    return resolveLocation(defaultCity.trim());
  }

  // Attempt IP-based geolocation with multiple fallbacks
  try {
    const ipRes = await fetch("http://ip-api.com/json", { signal: AbortSignal.timeout(4000) });
    if (ipRes.ok) {
      const info = (await ipRes.json()) as any;
      if (info && info.status === "success" && info.city && Number.isFinite(info.lat)) {
        return {
          name: info.city,
          country: info.country,
          latitude: info.lat,
          longitude: info.lon,
        };
      }
    }
  } catch {
    // Try secondary IP lookup
  }

  try {
    const ipapiRes = await fetch("https://ipapi.co/json/", { signal: AbortSignal.timeout(4000) });
    if (ipapiRes.ok) {
      const info = (await ipapiRes.json()) as any;
      if (info && info.city && Number.isFinite(info.latitude)) {
        return {
          name: info.city,
          country: info.country_name,
          latitude: info.latitude,
          longitude: info.longitude,
        };
      }
    }
  } catch {
    // Failed IP detection
  }

  // Safe fallback default to Karachi if no location can be detected
  return {
    name: "Karachi",
    country: "Pakistan",
    latitude: 24.8608,
    longitude: 67.0104,
  };
}

function isLocalWeatherKeyword(s: string): boolean {
  const norm = s.toLowerCase().trim();
  return (
    norm === "local" ||
    norm === "here" ||
    norm === "current" ||
    norm === "my city" ||
    norm === "my area" ||
    norm === "mere shahar" ||
    norm === "mera shahar" ||
    norm === "idhar" ||
    norm === "yahan" ||
    norm === "میرے شہر" ||
    norm === "میرے علاقے"
  );
}

/**
 * Fetches real current weather data from Open-Meteo.
 */
export async function getCurrentWeather(
  locationQuery?: string,
  units: "metric" | "imperial" = "metric"
): Promise<{ ok: boolean; data?: WeatherData; message: string; speechResponse: string }> {
  try {
    const location = await resolveLocation(locationQuery);

    const tempUnitParam = units === "imperial" ? "&temperature_unit=fahrenheit" : "";
    const windUnitParam = units === "imperial" ? "&wind_speed_unit=mph" : "&wind_speed_unit=kmh";

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto${tempUnitParam}${windUnitParam}`;

    const res = await fetch(weatherUrl, { signal: AbortSignal.timeout(9000) });
    if (!res.ok) {
      return {
        ok: false,
        message: `Weather service error (HTTP ${res.status}).`,
        speechResponse: "Sorry, I am unable to connect to the weather service right now.",
      };
    }

    const json = (await res.json()) as any;
    const cur = json.current;
    if (!cur) {
      return {
        ok: false,
        message: "Malformed weather response received.",
        speechResponse: "The weather provider returned an incomplete response.",
      };
    }

    const weatherCode = cur.weather_code ?? 0;
    const condition = decodeWeatherCode(weatherCode);
    const tempSymbol = units === "imperial" ? "°F" : "°C";
    const windSymbol = units === "imperial" ? "mph" : "km/h";

    const dailyMax = json.daily?.temperature_2m_max?.[0];
    const dailyMin = json.daily?.temperature_2m_min?.[0];
    const rainProb = json.daily?.precipitation_probability_max?.[0];

    const weatherData: WeatherData = {
      location: location.name,
      country: location.country,
      coordinates: { latitude: location.latitude, longitude: location.longitude },
      current: {
        temperature: Math.round(cur.temperature_2m * 10) / 10,
        feelsLike: Math.round(cur.apparent_temperature * 10) / 10,
        humidity: Math.round(cur.relative_humidity_2m),
        weatherCode,
        condition: condition.en,
        conditionUrdu: condition.ur,
        windSpeed: Math.round(cur.wind_speed_10m * 10) / 10,
        isDay: Boolean(cur.is_day),
        precipitation: cur.precipitation ?? 0,
        rainProbability: rainProb,
      },
      daily: dailyMax != null ? {
        maxTemp: Math.round(dailyMax * 10) / 10,
        minTemp: Math.round(dailyMin * 10) / 10,
        maxRainProbability: rainProb,
        condition: condition.en,
      } : undefined,
      units: {
        temperature: tempSymbol,
        windSpeed: windSymbol,
        precipitation: "mm",
      },
      timestamp: cur.time || new Date().toISOString(),
      source: "Open-Meteo",
    };

    const locLabel = location.country ? `${location.name}, ${location.country}` : location.name;

    const message = `Current weather in ${locLabel}: ${weatherData.current.temperature}${tempSymbol}, ${condition.en} (${condition.ur}). Feels like: ${weatherData.current.feelsLike}${tempSymbol}. Humidity: ${weatherData.current.humidity}%. Wind: ${weatherData.current.windSpeed} ${windSymbol}.${dailyMax != null ? ` Today's High: ${weatherData.daily?.maxTemp}${tempSymbol}, Low: ${weatherData.daily?.minTemp}${tempSymbol}.` : ""}${rainProb != null ? ` Rain probability: ${rainProb}%.` : ""}`;

    const speechResponse = `${locLabel} mein abhi temperature ${weatherData.current.temperature} degree hai, aur mausam ${condition.ur} (${condition.en}) hai. Feels like ${weatherData.current.feelsLike} degree, humidity ${weatherData.current.humidity} percent hai.`;

    return {
      ok: true,
      data: weatherData,
      message,
      speechResponse,
    };
  } catch (err: any) {
    return {
      ok: false,
      message: `Failed to retrieve weather: ${err?.message || String(err)}`,
      speechResponse: "Sorry, I could not retrieve the weather information at this moment.",
    };
  }
}

/**
 * Fetches 3-to-7 day weather forecast.
 */
export async function getWeatherForecast(
  locationQuery?: string,
  daysCount = 3,
  units: "metric" | "imperial" = "metric"
): Promise<{ ok: boolean; data?: WeatherForecastData; message: string; speechResponse: string }> {
  try {
    const location = await resolveLocation(locationQuery);
    const days = Math.max(1, Math.min(7, daysCount));

    const tempUnitParam = units === "imperial" ? "&temperature_unit=fahrenheit" : "";
    const windUnitParam = units === "imperial" ? "&wind_speed_unit=mph" : "&wind_speed_unit=kmh";

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&forecast_days=${days}&timezone=auto${tempUnitParam}${windUnitParam}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!res.ok) {
      return {
        ok: false,
        message: `Forecast service error (HTTP ${res.status}).`,
        speechResponse: "Unable to retrieve the weather forecast right now.",
      };
    }

    const json = (await res.json()) as any;
    const daily = json.daily;
    if (!daily || !daily.time) {
      return {
        ok: false,
        message: "Incomplete forecast data received.",
        speechResponse: "Forecast data was not available.",
      };
    }

    const forecastDays: ForecastDay[] = [];
    const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    for (let i = 0; i < daily.time.length; i++) {
      const dateStr = daily.time[i];
      const date = new Date(dateStr);
      const code = daily.weather_code[i] ?? 0;
      const cond = decodeWeatherCode(code);

      forecastDays.push({
        date: dateStr,
        dayOfWeek: weekdayNames[date.getDay()],
        maxTemp: Math.round(daily.temperature_2m_max[i] * 10) / 10,
        minTemp: Math.round(daily.temperature_2m_min[i] * 10) / 10,
        condition: cond.en,
        conditionUrdu: cond.ur,
        rainProbability: daily.precipitation_probability_max?.[i] ?? 0,
        windSpeedMax: Math.round((daily.wind_speed_10m_max?.[i] ?? 0) * 10) / 10,
      });
    }

    const tempSymbol = units === "imperial" ? "°F" : "°C";
    const windSymbol = units === "imperial" ? "mph" : "km/h";
    const locLabel = location.country ? `${location.name}, ${location.country}` : location.name;

    const summaryParts = forecastDays.map(
      (f) => `${f.dayOfWeek}: ${f.condition} (${f.minTemp} - ${f.maxTemp}${tempSymbol}, Rain: ${f.rainProbability}%)`
    );

    const message = `Weather forecast for ${locLabel} (${forecastDays.length} days):\n` + summaryParts.join("\n");
    const speechResponse = `Forecast for ${locLabel}: Tomorrow will be ${forecastDays[0]?.condition} with highs around ${forecastDays[0]?.maxTemp} degree.`;

    return {
      ok: true,
      data: {
        location: location.name,
        country: location.country,
        days: forecastDays,
        units: { temperature: tempSymbol, windSpeed: windSymbol },
        source: "Open-Meteo",
      },
      message,
      speechResponse,
    };
  } catch (err: any) {
    return {
      ok: false,
      message: `Failed to retrieve forecast: ${err?.message || String(err)}`,
      speechResponse: "Could not retrieve the forecast.",
    };
  }
}
