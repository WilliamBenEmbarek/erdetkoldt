/**
 * Temperature Worker for erdetkoldt.dk
 * Fetches current temperature and wind conditions from DMI's API
 */
const COPENHAGEN_POINT = "POINT(12.561 55.715)";
const KELVIN_TO_CELSIUS = (k) => k - 273.15;
const FRESH_TTL = 300; // serve without refreshing for 5 minutes
const STALE_TTL = 7200; // keep in edge cache as fallback for 2 hours
const BROWSER_TTL = 60; // browser cache
const CACHE_URL = 'https://api.erdetkoldt.dk/temperature-wind';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
  'Access-Control-Max-Age': '86400',
};

// Wind chill calculation for cold weather
const calculateWindChill = (tempC, windMS) => {
  const windKmh = windMS * 3.6;
  if (tempC > 10 || windKmh < 4.8) return tempC;
  return 13.12 + 0.6215 * tempC - 11.37 * Math.pow(windKmh, 0.16) + 0.3965 * tempC * Math.pow(windKmh, 0.16);
};

// Format date to ISO string and strip milliseconds
const formatDateForAPI = (date) => {
  return date.toISOString().split('.')[0] + '.000Z';
};

// The open API has no auth but is quick to answer 429, so retry briefly
async function fetchFromDMI() {
  const now = new Date();
  const oneHourAhead = new Date(now.getTime() + 60 * 60 * 1000);

  const apiUrl = new URL('https://opendataapi.dmi.dk/v1/forecastedr/collections/harmonie_dini_sf/position');
  apiUrl.searchParams.set('coords', COPENHAGEN_POINT);
  apiUrl.searchParams.set('crs', 'crs84');
  apiUrl.searchParams.set('parameter-name', 'temperature-2m,wind-speed');
  apiUrl.searchParams.set('datetime', `${formatDateForAPI(now)}/${formatDateForAPI(oneHourAhead)}`);

  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const dmiResponse = await fetch(apiUrl.toString(), {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      if (dmiResponse.ok) return dmiResponse.json();
      lastError = new Error(`DMI API responded with ${dmiResponse.status}`);
      if (dmiResponse.status !== 429) break;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw lastError;
}

function buildPayload(data) {
  const temperatureKelvin = data.ranges['temperature-2m'].values[0];
  const windSpeed = data.ranges['wind-speed']?.values[0] || 0;

  const actualTemp = KELVIN_TO_CELSIUS(temperatureKelvin);
  const feelsLike = calculateWindChill(actualTemp, windSpeed);

  return {
    temperature: actualTemp.toFixed(1),
    feelsLike: feelsLike.toFixed(1),
    isKoldt: feelsLike <= 5,
    timestamp: data.domain.axes.t.values[0],
    windSpeed: windSpeed.toFixed(1)
  };
}

async function refreshCache(cache) {
  const data = await fetchFromDMI();
  const payload = buildPayload(data);

  const stored = new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${STALE_TTL}`,
      'X-Fetched-At': String(Date.now())
    }
  });
  await cache.put(new Request(CACHE_URL), stored.clone());
  return stored;
}

function serve(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', `public, max-age=${BROWSER_TTL}`);
  headers.delete('X-Fetched-At');
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, { headers });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const cache = caches.default;
    const cached = await cache.match(new Request(CACHE_URL));

    if (cached) {
      // Serve instantly; refresh in the background if past the fresh window
      const fetchedAt = Number(cached.headers.get('X-Fetched-At')) || 0;
      if (Date.now() - fetchedAt > FRESH_TTL * 1000) {
        ctx.waitUntil(refreshCache(cache).catch((err) => console.error('Background refresh failed:', err)));
      }
      return serve(cached);
    }

    try {
      return serve(await refreshCache(cache));
    } catch (error) {
      console.error('Error:', error);

      return new Response(JSON.stringify({
        error: 'Kunne ikke hente temperatur data',
        detail: error.message
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...CORS_HEADERS
        }
      });
    }
  }
}
