# Notre-Dame Reservation Helper — Status and Next Phases

**Updated:** 18 September 2026  
**Current source version:** 0.7.23  
**Release packaging:** no new ZIP archive has been created for the 0.7.x changes; use the unpacked extension folder and reload it from `chrome://extensions`.

## Current status

The extension is a local Chrome helper for an already-verified Notre-Dame reservation session. It monitors availability in the active browser session and can guide the reservation flow from Visitors through the site’s Complete page.

Test automation is now live-verified; Booking automation has not been live-verified to final submission. The reservation site has nevertheless been inconsistent and has shown its own **“Maximum amount of orders has been reached”** message. That remains a site-side stop condition, not a helper confirmation of a booking.

**Latest live result — 18 September 2026:** after the site session timed out following roughly 20 minutes of inactivity, the user manually validated the session. Test automation then completed the supported flow through the site’s Complete page without submitting. The practical model is therefore **human session revalidation + automated Test flow**, not unattended end-to-end automation.

### Implemented

- Availability monitoring uses the site’s live timeslot response and the page’s actual selectable time controls.
- Exact time, time range, and any-slot plans; visitor count; 15-second through 15-minute polling choices.
- Watch only, Test automation, and Booking automation modes.
- Flow support for Visitors → Date → Personal details → Donation (zero) → Summary → Complete.
- Test mode is intended to reach Complete and stop without accepting T&Cs or submitting.
- Booking mode is intended to verify Summary, then accept the single T&Cs checkbox and click the single Complete control only when the exact controls are present.
- Named local profiles and session-only personal details. Temporary details now remain through Donation and Summary, clearing only at Complete/final result.
- Downloadable, privacy-redacted diagnostics and a local test runner.
- Side panel on Notre-Dame tabs; launcher popup on other tabs.
- Pinned in-page monitor near the top of reservation pages, with phase, target, recent activity, and an explicit Unpin control.
- Opt-in local scenario runner for availability, unavailable, opens, 403, and API-error conditions. It has no Notre-Dame request or page automation path.
- One-time new-availability alert in the helper, pinned monitor, and activity log; unchanged active availability does not repeat it.

### Important unresolved live behavior

- A prior manual attempt was blocked with an order-limit message, and the site session timed out after roughly 20 minutes of inactivity. The successful Test run required a human session validation immediately beforehand. Do not treat Booking automation as live-booking-ready until P2 is verified.
- The captured Notre-Dame JavaScript labels this as `orderLimitReached` and disables the **Personal Data** page’s Next action when the server injects that error. It is distinct from a timeslot-stock result. The server-side key is unknown: the observed Incognito success changed both browser/session state and the raw email string, so it does **not** establish whether the limit is keyed to email, prior orders, session/device signals, or another anti-abuse rule.
- Diagnostic `diagnostics/notre-dame-reservation-diagnostic-2026-09-10T08-06-17-808Z.json` showed a false Summary date mismatch: the first verifier accepted the page but the immediate bridge verifier rejected the site’s date format without a year. This was corrected in v0.7.18 and subsequently passed fresh Test-mode verification on 18 September.
- Any diagnostic from before v0.7.18 may report stale `expected complete` workflow errors. Those markers are now cleared when a flow stops or the plan changes.

## Resume checklist

1. Reload the unpacked extension in `chrome://extensions`, then refresh the active Notre-Dame page so its page script is current.
2. Confirm that the site can be completed **manually** through Summary and Complete in the same browser session.
3. Use **Watch only** first; avoid repeated validation/reload attempts if Cloudflare or the site rate-limits the session.
4. Run one **Test automation** attempt with a saved profile. It should reach Complete and stop without submitting.
5. Download diagnostics only if the observed phase or stop reason differs from the expected behavior.

## Prioritized next phases

### P0 — Re-establish a reliable manual baseline

Wait until the Notre-Dame site allows a normal manual reservation journey again. Capture fresh, privacy-redacted diagnostics from Summary and Complete only if there is a discrepancy.

**Done when:** a user can manually reach Complete from Visitors in a validated normal browser session without a site-side limit/error.

### Completed — Live-verified Test mode through Complete

Verified on 18 September 2026 after manual session validation: Test mode progressed through the supported flow to Complete without submitting.

**Result:** complete. Re-test only after a material site-flow change or a helper change affecting the workflow.

### P2 — Live-verify Booking completion

Verify the controlled Complete-page interaction: identify one enabled T&Cs checkbox and one enabled Complete button, then allow the explicitly armed Booking mode to submit. Never add CAPTCHA, Cloudflare, or rate-limit bypasses.

**Done when:** the site’s final confirmation/result page is captured and the extension records a clear confirmed or failed outcome without duplicate submission.

### P3 — Recovery and site-error handling

Test the site’s sold-out, order-limit, session rejection, changed-plan, and manual-back-navigation cases. Ensure a stopped flow is reset by a deliberate plan change and **Start watching**, without automatic retry loops.

**Documented session-rejection procedure:** stop the run; reload/open the normal Notre-Dame tab and complete any site verification manually; confirm the page works manually; use **Validate session** once; recheck the plan; then explicitly start a new run. The helper must never retry a 403, copy/create a security token, or conflate `orderLimitReached` with session expiry.

**Done when:** each condition gives a specific, non-stale status and safe next action.

### Completed — P4: Local fixture coverage

Local test mode now uses selectable built-in responses directly in the polling path. It never injects the page bridge, contacts Notre-Dame, fills a form, or navigates a page. Offline tests cover fixture availability, an opens transition, a fixture 403, and alert transitions.

### Completed — P5: Availability-change alerts

New matching availability has a dedicated visible alert in the helper and pinned monitor plus an `ALERT` log entry. It is deduplicated while availability remains active and fires again only after availability has gone away and returned. Browser notifications remain intentionally out of scope; no permission or additional request is needed.

## Guardrails

- Use only the user’s normal Chrome/Notre-Dame session.
- Do not bypass Cloudflare, CAPTCHA, order limits, or other site protections.
- Treat a site limit or HTTP 403 as a stop condition, not a signal to retry more aggressively.
- Keep final booking submission limited to the explicit Booking mode and only after Test-mode verification remains current.
