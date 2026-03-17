// domain-proxy — Supabase Edge Function
// Proxies Domainr API calls so the RapidAPI key never hits the client.
// Endpoints:
//   GET ?action=search&query=<term>
//   GET ?action=status&domain=<domain>

const RAPIDAPI_KEY  = Deno.env.get('RAPIDAPI_KEY') ?? '';
const RAPIDAPI_HOST = 'domainr.p.rapidapi.com';
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? 'http://localhost:8080';

const CORS = {
  'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

Deno.serve(async (req: Request) => {
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: CORS });
  }

  const url    = new URL(req.url);
  const action = url.searchParams.get('action');

  let upstream: string;

  if (action === 'search') {
    const query = url.searchParams.get('query');
    if (!query) return new Response('Missing query', { status: 400, headers: CORS });
    // Basic sanity: only allow printable ASCII, max 100 chars
    if (query.length > 100 || !/^[\x20-\x7E]+$/.test(query)) {
      return new Response('Invalid query', { status: 400, headers: CORS });
    }
    upstream = `https://${RAPIDAPI_HOST}/v2/search?query=${encodeURIComponent(query)}`;

  } else if (action === 'status') {
    const domain = url.searchParams.get('domain');
    if (!domain) return new Response('Missing domain', { status: 400, headers: CORS });
    // Domains: letters, digits, hyphens, dots only
    if (domain.length > 253 || !/^[a-zA-Z0-9.\-]+$/.test(domain)) {
      return new Response('Invalid domain', { status: 400, headers: CORS });
    }
    upstream = `https://${RAPIDAPI_HOST}/v2/status?domain=${encodeURIComponent(domain)}`;

  } else {
    return new Response('Unknown action', { status: 400, headers: CORS });
  }

  const resp = await fetch(upstream, {
    headers: {
      'x-rapidapi-key':  RAPIDAPI_KEY,
      'x-rapidapi-host': RAPIDAPI_HOST,
    },
  });

  const data = await resp.json();
  return new Response(JSON.stringify(data), {
    status: resp.status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
