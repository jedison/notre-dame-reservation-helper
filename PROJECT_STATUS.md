# Notre-Dame Reservation Helper — Public roadmap

## Current scope

The extension is a local Chrome helper for availability monitoring in a user's
already-verified browser session. It provides watch-only mode, offline scenario
tests, and optional user-controlled reservation-flow assistance.

It does not bypass Cloudflare, CAPTCHA, rate limits, order limits, or other site
protections. A protection, unexpected page, ambiguous control, or HTTP 403 is a
stop condition.

## Current priorities

1. Keep the watch-only and offline test paths stable as the site evolves.
2. Improve resilience and clear stop messages for legitimate site-flow changes.
3. Maintain privacy-redacted local diagnostics without committing captures.
4. Revalidate optional flow assistance only after a manual, normal browser
   journey remains possible.

## Out of scope

- Circumventing site security or human-verification controls.
- Retrying a protected or rate-limited session aggressively.
- Operating a shared service, handling other users' reservations, or claiming
  affiliation with Notre-Dame de Paris or its reservation provider.
