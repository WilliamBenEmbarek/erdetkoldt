/**
 * Temperature Worker for erdetkoldt.dk
 * Fetches current temperature and wind conditions from DMI's API
 */
const COPENHAGEN_POINT = "POINT(12.561 55.715)";
const KELVIN_TO_CELSIUS = (k) => k - 273.15;

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

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders
      });
    }

    try {
      // Move date calculations inside the request handler
      const timeWindow = (() => {
        const now = new Date();
        const oneHourAhead = new Date(now.getTime() + 60 * 60 * 1000);
        return {
          start: formatDateForAPI(now),
          end: formatDateForAPI(oneHourAhead)
        };
      })();
      
      // Construct the DMI API URL
      const apiUrl = new URL('https://dmigw.govcloud.dk/v1/forecastedr/collections/harmonie_dini_sf/position');
      apiUrl.searchParams.set('coords', COPENHAGEN_POINT);
      apiUrl.searchParams.set('crs', 'crs84');
      apiUrl.searchParams.set('parameter-name', 'temperature-2m,wind-speed');
      apiUrl.searchParams.set('datetime', `${timeWindow.start}/${timeWindow.end}`);
      
      // Make the API request
      const dmiResponse = await fetch(apiUrl.toString(), {
        headers: {
          'Accept': 'application/json',
          'X-Gravitee-Api-Key': env.DMI_API_KEY
        }
      });

      if (!dmiResponse.ok) {
        throw new Error(`DMI API responded with ${dmiResponse.status}`);
      }

      const data = await dmiResponse.json();
      
      // Get the latest values
      const temperatureKelvin = data.ranges['temperature-2m'].values[0];
      const windSpeed = data.ranges['wind-speed']?.values[0] || 0;
      
      // Convert and calculate feels like temperature
      const actualTemp = KELVIN_TO_CELSIUS(temperatureKelvin);
      const feelsLike = calculateWindChill(actualTemp, windSpeed);
      
      // Consider it cold if it feels like 5°C or below
      const isKoldt = feelsLike <= 5;
      
      const response = {
        temperature: actualTemp.toFixed(1),
        feelsLike: feelsLike.toFixed(1),
        isKoldt: isKoldt,
        timestamp: data.domain.axes.t.values[0],
        windSpeed: windSpeed.toFixed(1)
      };

      const headers = {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        ...corsHeaders
      };

      return new Response(JSON.stringify(response), { headers });

    } catch (error) {
      console.error('Error:', error);
      
      return new Response(JSON.stringify({
        error: 'Kunne ikke hente temperatur data',
        detail: error.message
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
  }
}
