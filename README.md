# OpenDomain

Static domain discovery site. Authentication and saved search history use Supabase. Domain hints use Cloudflare DNS over HTTPS; absent DNS records do not establish registration availability, so users confirm availability and pricing with a registrar.

## Publishing

Run `node scripts/build-static.cjs` and serve the generated `public/` directory with any static web server. Vercel runs this command automatically and publishes only that directory. The build copies an explicit list of public assets, keeping tests, dependencies and backend configuration out of the site. Update the list when adding a public asset. Production builds require only Node.js, so Vercel skips dependency installation; the npm dependencies below are used only for regression tests.

## Regression tests

Use Node.js 22 or newer:

```sh
npm ci
npm test
```

Tests execute the page in a simulated DOM, with mocked DNS, authentication, and database responses. Callback tests load the same pinned Supabase browser SDK as production and verify that one callback code is exchanged only once. They do not contact the live database, send sign-in emails, or exchange real tokens.

The browser SDK version and integrity hash in `index.html` must match the test dependency. Keep the lockfile when updating dependencies.

The legacy `supabase/functions/domain-proxy` endpoint returns HTTP 410 for all requests except CORS preflight (204). It reads no upstream credentials and makes no upstream calls. Its deployment is separate from the frontend. The original forwarding implementation is available in commit `384a91a`; restoring it would also restore paid upstream calls, so it should only be redeployed intentionally.
