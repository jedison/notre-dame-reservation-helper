# Notre-Dame Reservation Helper

Local Chrome extension for monitoring reservation availability on `resa.notredamedeparis.fr` inside an already Cloudflare-verified Chrome session.

## Current version: 0.7.23

For the current implementation status, live-verification limits, and prioritized continuation plan, see [PROJECT_STATUS.md](PROJECT_STATUS.md).

### Core behavior

- Defaults to **2 visitors**.
- Uses Notre-Dame's live `POST /script/timeslots` endpoint.
- Mirrors the reservation page's currently selected ticket types and quantities when checking availability.
- Treats `timeslot.active === true` as the authoritative availability signal, matching Notre-Dame's own `branded.js`.
- Does **not** require `soldOut === false`.
- Tracks diagnostic fields including `soldOut`, `expired`, `totalAvailable`, and `classAttr`.
- Supports exact-time, time-range, and any-slot monitoring.
- Offers polling intervals of 15 seconds, 30 seconds, 60 seconds, 2 minutes, 5 minutes, or 15 minutes.
- Calculates expected release times, including the empirically confirmed **T−24** release.
- Can show inactive slots on the Notre-Dame page for diagnostics.
- **Local test mode** runs selectable built-in scenarios (available, unavailable, opens, 403, or API error) without making a Notre-Dame request or clicking/navigating the site. It is intentionally monitoring-only.
- A newly matching available slot receives a one-time visual alert in the helper, the pinned monitor, and the activity log. It does not use browser notification permissions or create additional site requests.
- **When a matching slot is found** has three explicit choices: **Watch only**, **Test automation**, and **Booking automation**. Watch only reports availability without entering the reservation flow. Test automation follows the live flow through Visitors, date/time selection, personal details, zero donation, Summary, and the site’s **6. Complete** page, then stops without accepting its Terms and Conditions or submitting. Booking automation independently verifies date, time, and visitor count on Summary, then only on the site’s Complete page accepts its single Terms and Conditions checkbox and submits its single enabled **Complete** control. Any mismatch, missing checkbox, or ambiguous control stops without submitting. For a time range or any-time watch, both automation modes select the earliest active matching slot.
- With **Automate** selected, the intended starting page is **Visitors**. The helper sets the configured visitor quantity in the site's sole individual-ticket selector and uses the site's normal **Next** control to reach date selection before it begins monitoring. It does not construct a separate Tickets-to-Date request. If the site presents more than one ticket category, it stops rather than guessing which category should receive the visitors.
- If the site reports that the selected slot has sold out during the transition, the helper stops and disables automatic progression; it never retries that slot automatically.
- Can hold first name, surname, one email address, ZIP code, country, and phone number in browser-session memory for autofill; it repeats the email in the site's confirmation field and keeps the temporary session copy through Personal Details, Donation, and Summary. It clears that copy only when the flow reaches the site’s Complete page or a final result. If the user explicitly saves a named profile, those reservation personal details are stored locally in that profile and are restored when the profile is loaded. Country is selected from the same country-code list used by the site.
- **Test automation** and **Booking automation** require a complete temporary profile before they begin: first name, surname, valid email, ZIP code, supported country, and an international phone number beginning with `+`. The popup identifies and highlights any incomplete or invalid fields. **Watch only** does not require a profile.
- Enter phone numbers in international format (for example, `+33 …`); the helper passes the number to the site's phone control so its separate country-code dropdown can follow the prefix.
- Does not bypass Cloudflare and does not store Cloudflare/session cookies.
- **Watch only** and **Test automation** never submit a reservation. **Booking automation** may submit only after Summary verification succeeds and the site’s Complete page presents one enabled Terms and Conditions checkbox and one enabled Complete button.

## Session / 403 behavior

A `403` from `/script/timeslots` means the current Notre-Dame/security browser session is no longer accepted.

Current versions handle this explicitly:

- A 403 becomes **Security rejected (403)**; the helper does not assume the cause is literal cookie/session expiry.
- Polling stops immediately.
- Reload/open Notre-Dame normally and let its automatic security verification complete.
- **Validate session** remains available as an explicit one-shot diagnostic and uses one live `/script/timeslots` request.
- Normal Test/Booking automation does not make a redundant validation-only `/timeslots` request before Visitors-to-Date navigation; it uses Notre-Dame's own page flow and lets the next required availability request provide API/session evidence.

The extension does not bypass or manufacture Cloudflare/security tokens; it uses the browser's current validated session and stops on a security challenge or HTTP 403.

### P3 recovery procedure — session expiry or security rejection

Use this procedure when the helper says **Security rejected (403)**, the reservation page returns to a Cloudflare/security screen, or a previously working session has gone stale after sitting idle.

1. Stop watching; do not repeatedly press **Validate session** or restart automation.
2. Keep the same normal Chrome profile and open/reload Notre-Dame normally. Complete any site-provided verification yourself.
3. Confirm the reservation pages work manually in that tab. If the site still shows an order-limit or other server message, treat that as a separate site stop condition rather than a session-expiry problem.
4. Use **Validate session** once, only after the page appears normal. A successful `HTTP 200` / **Valid** result is fresh session evidence.
5. Recheck the date, visitor count, time/range, and automation choice; then deliberately click **Start watching** again. A session rejection stops the run and does not resume itself.

The helper does not retain, generate, copy, or bypass security tokens. It also does not automatically retry after a 403, because rapid retrying can worsen rate limiting. The observed session lifetime has been approximately 20 minutes of inactivity in one live test; this is an observation, not a guaranteed site timeout.

## Local tests

Version 0.4 adds a small test suite that does **not** contact Notre-Dame.

From the extension popup, click:

**Run local tests**

The test page checks:

- `active === true` is authoritative.
- `soldOut`, `expired`, `classAttr`, and `totalAvailable` are diagnostic, not the primary availability trigger.
- Negative `totalAvailable` values do not make an active slot unavailable.
- Exact-time filtering.
- Time-range filtering.
- Any-slot filtering.
- T−24 release-time calculation.
- T−4 release-time calculation.
- HTTP 403 classification as session/session-clearance expiry.
- Parsing representative `/script/timeslots` JSON.

Local test mode can exercise slot behavior without consuming a live Notre-Dame session. Select **Local test mode** in Support & diagnostics, choose a scenario, and click **Start watching**. It is deliberately isolated from live automation: it never makes a site request or advances any reservation page.

## Install locally

1. Unzip the extension folder somewhere permanent.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the extension folder.
6. Pin **Notre-Dame Reservation Helper**.
7. Open Notre-Dame's reservation site normally and let Cloudflare verify the browser.

After replacing an older local version, click **Reload** on the extension card.

### Keep the helper open while navigating

Chrome’s small extension popup closes when focus or the current page changes. On a Notre-Dame reservation tab, click the **Notre-Dame Helper toolbar icon** to open the same interface as Chrome’s persistent side panel. On any other tab—including a blank tab or `chrome://extensions`—the icon opens a compact launcher popup, where **Open Notre-Dame reservation site** is available.

## Version history

### v0.7.23 — local scenario testing and availability alerts
- Finishes the fixture-driven polling path: local test mode uses only built-in responses and never injects the page bridge, contacts Notre-Dame, fills a form, or navigates the site.
- Adds selectable local scenarios for matching availability, unavailable, unavailable-then-opens, session rejection (403), and API error.
- Adds one-time “New matching availability” treatment in the run card, pinned monitor, and activity log. It alerts again only after availability first disappears and later returns.

### v0.7.9 — Complete-page automation and narrower popup
- Narrows the popup from 390px to 330px.
- Recognizes the site’s `/payment` URL as its **6. Complete** page when its Terms and Conditions checkbox is present.
- Test automation reaches Complete and stops without changing its checkbox or submitting.
- Booking automation reaches Complete, accepts the one identified Terms and Conditions checkbox, and submits only the one enabled **Complete** control. It stops on any missing, disabled, or ambiguous control.

### v0.7.10 — fixed compact popup canvas
- Constrains the root document, HTML, body, and main content to 300px so Chrome cannot retain a wider empty popup canvas.

### v0.7.11 — roomier compact popup
- Widens the fixed popup canvas to 330px so the primary action labels remain readable without reverting to the earlier empty-canvas issue.

### v0.7.12 — compact action buttons
- Fixes Start watching and Open reservation site to the same 44px height, with a separate compact 34px Stop/Resume row.

### v0.7.13 — aligned Run actions
- Removes the inherited link-button top margin so Start watching and Open reservation site align at the top of their row.

### v0.7.14 — Complete-page handoff repair
- Preserves the reservation automation flag while Summary opens Complete, allowing Booking automation to continue there.
- Adds a 15-second Summary-to-Complete watchdog. A failed handoff now reports a clear stopped-flow error instead of leaving a stale page-settle message.

### v0.7.15 — persistent Chrome side panel
- Adds a **Keep helper open in side panel** control. The side panel uses the same live helper interface and remains open through page navigation.

### v0.7.16 — reliable side-panel entry
- The toolbar icon now opens the persistent Chrome side panel directly, replacing the temporary action popup and its unreliable intermediate button.

### v0.7.17 — site-scoped panel and native Summary handoff
- The side panel is enabled only on `resa.notredamedeparis.fr` tabs, so it no longer follows unrelated browsing tabs.
- Summary-to-Complete now uses the reservation site’s visible Next-button click, allowing its own click handlers to run before native form submission.

### v0.7.18 — consistent Summary verification
- Aligns the immediate Summary verifier with the initial verifier: both accept Notre-Dame’s visible date format without a year.
- Clears an expected-step marker when a flow stops, preventing stale “expected Complete” errors while the user later navigates manually.

### v0.7.19 — accessible site launcher
- The toolbar icon opens the persistent side panel on Notre-Dame, but opens the compact launcher popup on all other tabs so the reservation site can always be opened directly.

### v0.7.20 — clean retry after a changed plan
- Detects the site’s **Maximum amount of orders has been reached** message and stops with a clear site-limit status rather than retrying automatically.
- Changing a date, time, visitor count, watch mode, or automation mode clears all stale workflow markers and requires a deliberate **Start watching** for the new plan.
- Loading a profile similarly resets the prior workflow and makes its fresh-start state explicit.

### v0.7.21 — retain temporary details through the flow
- Keeps session-only personal details through Donation and Summary so a stopped handoff can be retried without re-entry.
- Clears them only when Complete or a final result is reached.

### v0.7.22 — pinned in-page status monitor
- Starting a run pins a compact monitor near the top of each Notre-Dame reservation page.
- It follows navigation, shows the current phase, target, and two recent activities, and remains visible until **Unpin** is clicked.

### v0.7.8 — Test through Payment and rendered availability snapshots
- Loading a profile no longer closes the Plan section.
- Test and Booking automation both verify Summary, use its Next control to open Payment, then stop. Payment is explicitly classified as an intermediate human-driven page; no Payment action is automated.
- When a matching slot is detected from the site's rendered controls, the availability table is refreshed from those selectable slots and marked `page-rendered`. It is a page-derived snapshot, not a complete helper API response.

### v0.7.7 — Payment handoff and diagnostic terminology
- Booking automation now prefers the known Summary form that opens Payment. Test automation still stops at Summary by design.
- Renames the raw timeslot table to **Availability API snapshot**: it records the last helper API response and is intentionally not refreshed when automation proceeds solely from already-rendered page controls.

### v0.7.6 — Plan editing and site-entry clarity
- Promotes **Open Notre-Dame reservation site** into the Run console next to the main monitoring controls.
- The Plan disclosure now chooses its open/closed state only when the popup first loads: it opens with no usable plan and stays open while the user edits. Loading a profile closes it explicitly.

### v0.7.5 — popup information architecture refresh
- Reorganizes the popup into a top-level Run console plus expandable Plan, Monitoring options, and Support & diagnostics sections.
- The Plan section opens when no visit date or saved profile is present and closes once a saved profile or visit date supplies a usable plan. Its collapsed summary shows the active profile or visit target.
- Moves low-frequency pacing, release-boundary, raw diagnostic, local-test, and support controls out of the primary reservation flow. No reservation workflow behavior changed.

### v0.7.4 — reservation-flow handoff reliability (live verification pending)
- After the initial Date-page settle period, automation watches the site's rendered slot controls until the normal helper polling fallback begins. A matching slot that renders late proceeds immediately without another availability request.
- Personal Details, Donation, and Summary suppress background availability polling while the reservation flow is advancing.
- Date-to-Personal Details, Personal Details-to-Donation, and Donation-to-Summary handoffs now stop with a clear recoverable error if the expected page does not open within 15 seconds.
- Temporary personal details remain in browser-session memory until Donation is reached. A failed field or country dropdown fill retains them and reports the problem instead of silently proceeding.
- The **Resume** control now explicitly restarts the downstream reservation step on the current page.

### v0.7.3 — immediate rendered-slot handoff (live verification pending)
- On the Date page, Test and Booking automation now waits only for the normal page-settle period, then checks the reservation site's already-rendered selectable time controls before scheduling the helper's first availability request.
- If the requested exact time, time range, or any-time choice is already selectable, automation proceeds immediately without an additional `/script/timeslots` request. If it is not rendered, normal polling remains the fallback and starts after the configured interval.

### v0.7.2 — request pacing repair (live verification pending)
- Starting automation preserves the last recorded session result; this is historical evidence, not a guarantee that the next request will succeed.
- Applying an unchanged inactive-slots diagnostic setting no longer refreshes the site's timeslots.
- Normal polling waits one configured polling interval before its first helper request, allowing the Date page's own initial request to finish. This can delay detection by the chosen interval (15 seconds to 15 minutes). Release-boundary checks retain their existing scheduling.
- Polling is scheduled after each completed check, with overlapping checks prevented. Actual HTTP 403 responses still stop monitoring.

### v0.7.1
- Adds an original transparent Notre-Dame-towers icon with a gold rose-window detail for the Chrome toolbar, extension manager, and related extension surfaces.

### v0.7.0 - reliability/state-machine pass (live verification pending)
- Makes session handling more event-driven: ordinary Visitors-to-Date automation no longer spends a separate `/script/timeslots` request merely to prove the session. The site's own page transition proceeds normally and the next required availability request becomes the session proof.
- Keeps a live release-boundary request when it is useful work, but carries that successful `/timeslots` result across the page handoff and reuses it on Date instead of immediately issuing a duplicate request.
- Adds an explicit reservation workflow state record for Tickets, Date, Personal details, Donation, Summary, security verification, final result, and unknown pages. Diagnostics now include workflow stage, last transition URL/time, failure code/reason, resume eligibility/hint, and booking outcome classification.
- Adds conservative final-result classification. Strong confirmation/failure wording on a final/payment/confirmation page is classified as confirmed/failed; otherwise the result is deliberately `unclassified` until live markup is captured. The helper never repeats a final confirmation attempt on a final-result page.
- Adds explicit user-driven recovery metadata and a **Resume** button. Resume is offered only on recognized intermediate reservation pages and only for a previously requested Test/Booking flow; Summary resume still performs the full Summary verification before Booking confirmation.
- Adds profile polish: **Rename**, **Duplicate**, and **Set default**. Profile export format is now version 3 and can preserve the valid default-profile name; v1 and v2 imports remain supported.
- Fixes profile/default-state pacing persistence so `pageSettleSeconds` and `actionPauseSeconds` are formally part of defaults and profile sanitization.
- UI cleanup: live timeslot diagnostics are collapsed by default, workflow stage/recovery is summarized near the main action controls, and profile controls are grouped more compactly.
- Adds/updates local tests for pacing persistence/bounds, profile v3/default-profile behavior, v1/v2 backward compatibility, workflow page classification, conservative final-result classification, and resume eligibility.
- Verification completed without contacting Notre-Dame: JavaScript syntax checks, manifest JSON validation, and logic-level tests pass. Exact final-success-page wording/markup remains a live-verification item.

### v0.6.12
- Saved profiles now include the reservation personal details needed for autofill: first name, surname, email address, ZIP code, country, and phone number.
- Loading a profile restores both reusable search/automation configuration and its saved reservation personal details into the popup/session autofill state.
- Profile export format is upgraded to version 2 and includes the saved personal details so profiles can move between installations entirely locally. Exported profile files therefore contain personal information and should be handled accordingly.
- Profile import accepts both version 2 profiles and legacy version 1 configuration-only profiles; missing personal fields default to blank and unsupported fields are ignored.
- Profiles still exclude passwords, tokens, cookies, session/security state, payment data, logs, and transient run state. Diagnostic downloads continue to redact personal-detail values.
- Adds tests for personal-data profile save/load shape, unsupported/transient field exclusion, version 2 export, version 1 backward compatibility, and version 2 import sanitization.

### v0.6.11
- Adds named saved profiles with local persistence, Load/Save/Delete/Export/Import controls, merge-on-import behavior, and configuration-only version 1 profile exports.


### v0.6.10
- Aligns **Download diagnostics** with the shared diagnostics specification used across NoSide browser-extension projects.
- Moves the diagnostic button into the main Start/Stop action group.
- Adds safe control-state capture for both the Helper popup and the Notre-Dame page, including labels, enabled/disabled state, validation state, and non-sensitive values.
- Adds explicit provider/API diagnostics and recent operation activity/outcomes.
- Makes diagnostic collection resilient: failures in tab, state, personal-data presence, popup-control, or page capture are recorded in `sourceErrors` while the remaining JSON still downloads.
- Strengthens sensitive-data exclusion for passwords, tokens, cookies, CSRF/security values, payment/card data, and personal-detail fields.
- Adds local tests for sensitive-data exclusion, partial diagnostic collection, timestamped download payload naming, and the diagnostic-button contract.
- Verification: manifest version, popup version label, diagnostic button placement, local source syntax, and diagnostic privacy/resilience checks are part of this release.

### v0.6.9
- Adds a **Download diagnostics** button, following the Flight Search Matrix diagnostic-snapshot pattern.
- Downloads a timestamped JSON file containing extension version, active tab/context, current helper state, recent logs/timeslot diagnostics, and a structural snapshot of the current Notre-Dame page.
- Diagnostic downloads do **not** include stored personal-detail values, cookies, Cloudflare/session tokens, CSRF values, or form-field values.
- Body-text excerpts are omitted entirely on personal-details, Summary, payment, and completion pages; obvious email/phone/token patterns are redacted elsewhere.
- The diagnostic records whether the active tab is Incognito and whether a security-verification page appears to be visible, to help diagnose normal-versus-Incognito session behavior.


### v0.6.8
- Adds conservative fixed pacing between automated page actions so Notre-Dame's own handlers and page state can settle before the helper continues.
- Uses roughly 0.9 seconds between normal workflow transitions and 1.2 seconds before the final confirmation action. The waits are fixed and are not intended to imitate human mouse/keyboard behavior.
- Avoids an unnecessary second `/script/timeslots` call when this exact tab has already received a successful response for the same date/visitor count within the previous 8 seconds; that recent response counts as the pre-automation session check.
- Continues to stop on HTTP 403 or an active security-verification page and does not attempt to bypass Cloudflare or other security controls.

### v0.6.7
- Adds a **current-tab session gate before automation is allowed to continue from Visitors**. The Helper no longer trusts a previously stored `sessionStatus` when moving between normal and Incognito tabs/sessions.
- After the visitor quantity is prepared on the live Visitors page, Test/Booking automation performs one live `/script/timeslots` request in that exact browser tab/session. It uses the configured target date and selected visitor count.
- Automation continues to the site's **Next** step only when that request succeeds. HTTP 403, an in-progress security challenge, or another session-check failure stops automation before navigation.
- With **15-minute release-boundary arming**, the visitor quantity can be prepared in advance but the session-validation request is deferred until the release boundary, preserving the “no live requests while waiting” behavior. After a successful boundary validation, the date page performs the immediate availability check for that boundary.
- Personal details remain stored in extension session memory as before; this change deliberately separates reusable form data from browser-session validity.

### v0.6.6
- Adds **Arm at 15-minute release boundaries** mode to reduce security-triggering live requests.
- In armed mode the helper makes **no `/script/timeslots` requests while waiting**, then performs one live check about 2 seconds after each relevant T−24/T−4 release boundary.
- For a time range, the helper advances through the range boundary-by-boundary; for example a 12:00–16:00 range checks at the release boundaries corresponding to 12:00, 12:15, 12:30, etc.
- If the configured release boundary has already passed when arming starts, it makes one immediate check; after the final configured boundary it stops rather than reverting to continuous polling.
- The normal Poll interval remains available when armed mode is off.
- A 403 is now described more precisely as **Security rejected (403)** rather than assuming the Cloudflare session literally expired; monitoring stops and the page title/overlay make revalidation conspicuous.
- “Validate session” remains available but the UI notes that it itself consumes one live timeslot request.

### v0.6.5
- Changes the Helper's Visit time, From, and To controls from native minute-by-minute time inputs to explicit **15-minute dropdowns**.
- Available choices are `00:00`, `00:15`, `00:30`, `00:45`, etc., matching Notre-Dame's 15-minute slot cadence.
- Existing automation logic is unchanged because the controls keep the same IDs and `HH:MM` values.

### v0.6.4 — live Summary markup captured
- Uses the live Summary page's authoritative JavaScript values `chosenTicketDate`, `chosenTicketTime`, and `ticketsTotalNumber` for Booking verification.
- Uses exact live Summary markup fallbacks: `#date-overview` and `#tickets-overview`.
- Identifies the final action exactly as `form#summary-form[action$="/reservationindividuelle/payment"]` with its single `button.next[type="submit"]`.
- Submits the real Summary form with `requestSubmit(button)` so Notre-Dame's own submit/security handlers run.
- Keeps visible-text date parsing only as a fallback, including the live format `Thursday 20 August 10:30` which omits the year.
- Still re-verifies the reservation immediately before final submission and stops if the Summary form/control has changed.

### v0.6.3 — pending live verification
- Fixes Test/Booking automation on the `/date` page.
- Removes the synthetic hidden POST that attempted to jump directly from Date to `personal-details`.
- Automation now uses Notre-Dame's own `#calendar-date` / `ticketDateChosen()` flow, waits for the site's rendered `ticketTime` radio control, selects the requested time, and clicks the site's own Next control.
- Adds date/time progression logging so live testing shows exactly where the handoff stops.
- Stops safely if the requested time is not rendered/selectable or the site's Next control does not become available.

### v0.6.2 — pending live verification
- Splits automation into two explicit modes while preserving **Watch only**:
  - **Test automation** follows the reservation flow to Summary and stops before final confirmation.
  - **Booking automation** follows the same flow and can submit final confirmation.
- Booking mode records the exact slot actually chosen (important for time-range/any-time watches) and verifies **date, time and visitor count** again on Summary.
- Booking stops without confirming if Summary does not match, if the selected target cannot be reconstructed, or if the final confirmation control is ambiguous.
- The page bridge repeats the Summary verification immediately before submission to guard against a last-moment page/state change.
- Existing `continue` / Automate-to-Summary settings migrate to **Test automation**, never to Booking.
- Adds conspicuous `BOOKING ARMED` / `TEST AUTOMATION` UI status and local tests for migration, mode behavior and Summary verification.

### v0.6.1 — pending live verification
- Requires a complete temporary profile before automated reservation flow can start. The popup highlights and names missing or invalid fields; Watch only remains available without a profile.
- Verifies 403 handling with a local test of the complete stopped-session state, including disabled polling and the required revalidation status.

### v0.6.0
- Tested the fully automated handoff from Visitors through the site's normal Next action to date selection.
- Preserves the opt-in automation choice, stops on a lost slot, and leaves final Summary confirmation manual.

### v0.5.10 — pending live verification
- Corrects the live Visitors-page selector from the obsolete `ticketNumbers[...]` name to the site's current `tickets[...]` name (for example, `tickets[411622]`).
- Keeps compatibility with the older selector form when it is present.

### v0.5.9 — pending live verification
- Waits for the Visitors page to enable its normal Next control after setting the quantity, then invokes that control.
- Detects an old in-page helper left behind by an extension update and gives an explicit reload instruction instead of silently waiting on the Visitors page.

### v0.5.8 — pending live verification
- Adds the automated entry point from the Visitors page: set the extension's visitor quantity and use the site's own Next action to enter date selection.
- Stops safely if the page offers multiple ticket categories rather than guessing which type of ticket is wanted.

### v0.5.7 — pending live verification
- Replaces the ambiguous automation checkbox with an explicit choice: **Watch only** (the safe default) or **Automate to Summary**.
- Watch-only mode never posts a selected time; it is suitable for testing availability detection against the live page.
- A slot-shortage or other reservation-flow error returns the selection to Watch only, preventing an accidental repeat.

### v0.5.6 — pending live verification
- Stops immediately, clears automatic progression, and reports **Slot no longer available** if Notre-Dame reports insufficient stock during the transition.
- Prevents more than one reservation-flow start in the same page instance.

### v0.5.5 — pending live verification
- Extends automatic progression to exact-time, time-range, and any-time watches.
- Chooses the earliest active matching slot for a time range or any-time watch.

### v0.5.4 — pending live verification
- Corrects the exact-slot flow so it waits for the page bridge before navigating to personal details.
- Overwrites existing personal-details form values with the temporary extension profile.
- Continues through personal details and a zero-donation page to Summary; the final confirmation remains manual.

### v0.5.3 — pending live verification
- Replaces free-text country entry with a dropdown using Notre-Dame's supported country codes.
- Sets the intended rule for future donation-page automation: a zero donation only.
- Confirms that final Summary-page confirmation remains user-driven.

### v0.5.2 — pending live verification
- Simplifies temporary personal details to one email field and fills both website email fields from that value.

### v0.5.1 — pending live verification
- Adds one-time, in-memory personal-details autofill for the personal-details page.
- Adds a controlled exact-slot transition to the personal-details page, stopping before final reservation submission.
- Passes internationally formatted phone numbers to the site's phone control so its country-code selector follows the `+` prefix.

### v0.5.0
- Added explicit session-validity state to the popup and overlay.
- HTTP 403 from `/script/timeslots` is treated as **Session expired**, not a generic API error.
- Monitoring stops immediately on 403 rather than continuing to poll.
- Added **Validate session** to make one live timeslots request after Notre-Dame/security revalidation.
- Successful validation displays **Session valid ✓**, the check time, and HTTP status.
- The page bridge now preserves HTTP status even when a security response is HTML rather than JSON.
- Preserved the current safer minimum polling interval of 15 seconds and dynamic page ticket/event request context.
- Extended tests for stop-and-revalidate behavior.

### v0.4.0
- Added a proper version history.
- Added reusable `logic.js` so core rules are independently testable.
- Added local unit-style tests and representative timeslot fixtures.
- Added popup button to open the local test runner.
- Added groundwork for fixture-driven test mode.
- Added explicit tests for 403/session-expiry behavior.
- Preserved the rule that `active === true` is authoritative.

### v0.3.0
- Changed availability logic to match Notre-Dame's own JavaScript: `slot.active === true`.
- Added **Show inactive slots** diagnostic mode.
- Added live diagnostics for returned timeslots and fields such as `soldOut`, `expired`, `totalAvailable`, and `classAttr`.

### v0.2.0
- Replaced generic DOM-only availability scanning with Notre-Dame's live `/script/timeslots` endpoint.
- Added exact-time, time-range, and any-slot monitoring.
- Added timestamped availability logging.
- Kept session handling inside the already-verified browser.

### v0.1.0
- Initial Manifest V3 scaffold.
- Target date/time and visitor count.
- T−24 release-time display.
- Basic logging and Cloudflare-page awareness.
- Placeholder DOM slot scanner.

## Backlog

### Completed — Local scenario testing without site requests

Local test mode has selectable built-in availability, unavailable, opens, 403, and API-error scenarios. It uses no Notre-Dame request and does not enter the reservation flow.

### Completed — Availability-change alerts

A new matching result is visibly highlighted once in the run card, pinned monitor, and log. An unchanged available result does not repeat the alert; unavailable-to-available alerts again.

### P3 — Reservation-flow live verification

Live-verify both Test and Booking automation against the site's current Summary markup and final confirmation control. The helper must continue to use the user's normal browser session and must not bypass CAPTCHA, Cloudflare, or other site protections.

**Done when:** Test mode reliably stops on Complete without submission, and Booking mode submits only after the exact selected date/time/visitor count and Complete-page controls are independently verified.
