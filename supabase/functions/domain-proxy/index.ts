// Retired legacy endpoint. Keep this response free of upstream calls and secrets.
// The current OpenDomain frontend does not call this function.
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? 'http://localhost:8080';

const CORS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  return new Response(JSON.stringify({
    error: 'endpoint_retired',
    message: 'This legacy domain lookup endpoint has been retired.',
  }), {
    status: 410,
    headers: {
      ...CORS,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
});
