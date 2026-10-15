# Privacy

Notre-Dame Reservation Helper runs locally in Chrome. It has no NoSide-hosted
service, analytics, or telemetry.

- Saved profiles are stored in the extension's local Chrome storage. Session
  details remain in browser-session memory for the active flow.
- Profile fields can include reservation information such as name, email,
  postal code, country, and phone number. The extension uses these only to
  fill the reservation form when the user explicitly selects an automation
  mode.
- The extension does not store Cloudflare or reservation-site session cookies,
  manufacture security tokens, or bypass a challenge.
- Downloaded diagnostics are privacy-redacted where practical, but should be
  treated as private local files. Browser captures and diagnostics are ignored
  by Git and never belong in this repository.

Users are responsible for reviewing the reservation provider's privacy policy
and terms before using the extension.
