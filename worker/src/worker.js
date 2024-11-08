/**
 * Temperature Worker for erdetkoldt.dk
 * Fetches current temperature from DMI's API and returns if it's cold
 */

const COPENHAGEN_POINT = "POINT(12.561 55.715)";
const KELVIN_TO_CELSIUS = (k) => k - 273.15;

export default {
  async fetch(request, env, ctx) {
    // Configure CORS for your domain
    const corsHeaders = {
      'Access-Control-Allow-Origin': 'https://erdetkoldt.dk',
      'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
      'Access-Control-Max-Age': '86400',
    };

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders
      });
    }

    try {
      // Construct the DMI API URL
      const apiUrl = new URL('https://dmigw.govcloud.dk/v1/forecastedr/collections/harmonie_dini_sf/position');
      apiUrl.searchParams.set('coords', COPENHAGEN_POINT);
      apiUrl.searchParams.set('crs', 'crs84');
      apiUrl.searchParams.set('parameter-name', 'temperature-2m');
      
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
      
      // Get the latest temperature value (first value in the array)
      const temperatureKelvin = data.ranges['temperature-2m'].values[0];
      const temperatureCelsius = KELVIN_TO_CELSIUS(temperatureKelvin);
      
      const response = {
        temperature: temperatureCelsius.toFixed(1),
        isKoldt: temperatureCelsius <= 0,
        timestamp: new Date().toISOString(),
        updated: data.domain.axes.t.values[0]
      };

      // Cache the response for 5 minutes
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