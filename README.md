# Notre-Dame Reservation Helper

A local Chrome extension for monitoring reservation availability in a user's
already-verified browser session. It is an independent technical prototype,
not an official Notre-Dame tool or booking service.

## What it does

- Monitors available reservation slots for an exact time, time range, or any
  matching time.
- Uses the reservation page's normal browser session and stops on a security
  challenge, HTTP 403, order limit, sold-out slot, unexpected page, or
  ambiguous control.
- Offers **Watch only** as the safe default, plus explicit user-controlled
  Test and Booking automation modes.
- Provides offline, fixture-based scenarios for available, unavailable, opens,
  security-rejected, and API-error states.
- Keeps profiles, optional temporary form data, and diagnostics local to the
  browser. The repository excludes browser captures and diagnostics.

## Scope and safety

The extension never bypasses Cloudflare, CAPTCHA, rate limits, order limits, or
other site protections. It does not store Cloudflare/session cookies or create
security tokens. A user must complete any site-provided verification normally.

Booking automation is opt-in and only proceeds when the selected date, time,
visitor count, and expected controls can be independently verified. Any
mismatch stops the flow. Users remain responsible for reviewing the site's
terms and for every reservation action.

Read the [public roadmap](PROJECT_STATUS.md), [privacy notes](docs/PRIVACY.md),
and [third-party notices](docs/THIRD_PARTY_NOTICES.md).

## Install locally

1. Download or clone this repository to a permanent local folder.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select this project folder.
5. Pin **Notre-Dame Reservation Helper**.
6. Open the reservation site normally and complete any site-provided security
   verification yourself.

After updating the source, use Chrome's **Reload** control for the extension
and refresh the reservation tab.

## Test locally

The extension includes offline test fixtures and a browser test page. They do
not contact the reservation site or submit a booking.

```sh
node tests/request-pacing.cjs
```

In the extension, open **Support & diagnostics**, choose **Local test mode**,
select a scenario, and start watching. The scenario runner is monitoring-only.

## Development notes

The project is a Manifest V3 extension. `logic.js` contains reusable rules;
`content.js` and `page-bridge.js` handle site-scoped behavior; `popup.*`
implements the local interface; `tests/` contains offline fixtures and checks.

See [CHANGELOG.md](CHANGELOG.md) for the release history. Contributions are
licensed under [Apache-2.0](LICENSE).
