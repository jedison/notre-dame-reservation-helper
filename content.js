
/* Shared logic available as window.NDRHLogic from logic.js */
(() => {
  let timer = null;
  let state = null;
  let overlay = null;
  let bridgeReady = false;
  let bridgeLoadPromise = null;
  let personalDetailsFilled = false;
  let reservationFlowStarting = false;
  let ticketsFlowStarting = false;
  let ticketsReadyTimer = null;
  let tickInProgress = false;
  let loopGeneration = 0;
  let renderedSlotObserver = null;
  let renderedSlotWatchTimer = null;
  let renderedSlotCheckQueued = false;
  let workflowTransitionTimer = null;
  const pending = new Map();

  // Per-tab only: a successful timeslot response is itself proof that this
  // exact browser tab/security context was accepted. Reuse it briefly rather
  // than immediately issuing a redundant second API call before automation.
  let lastSuccessfulTimeslotCheck = null;
  const RECENT_SESSION_PROOF_MS = 8000;
  const pageLoadedAt = Date.now();
  let lastAutomationActionAtMs = null;
  let lastProviderRequestAtMs = null;
  let localFixtureStep = 0;

  function boundedSeconds(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 10) return fallback;
    return n;
  }

  async function ensurePageSettled(label) {
    const seconds = boundedSeconds(state?.pageSettleSeconds, 2.5);
    const targetMs = Math.round(seconds * 1000);
    const elapsed = Date.now() - pageLoadedAt;
    const remaining = Math.max(0, targetMs - elapsed);
    if (remaining > 0) {
      await patch({ status: `Waiting for page to settle · ${label}` });
      await log(`PACE · page settle ${remaining}ms remaining before ${label}.`);
      await new Promise(resolve => setTimeout(resolve, remaining));
    }
  }

  async function beforeAutomationAction(label) {
    await ensurePageSettled(label);
    const seconds = boundedSeconds(state?.actionPauseSeconds, 1.2);
    const targetMs = Math.round(seconds * 1000);
    const now = Date.now();
    const previousGap = lastAutomationActionAtMs == null ? null : now - lastAutomationActionAtMs;
    if (lastAutomationActionAtMs != null) {
      const remaining = Math.max(0, targetMs - previousGap);
      if (remaining > 0) {
        await log(`PACE · waiting ${remaining}ms before ${label}.`);
        await new Promise(resolve => setTimeout(resolve, remaining));
      }
    }
    const actionAt = Date.now();
    const gap = lastAutomationActionAtMs == null ? null : actionAt - lastAutomationActionAtMs;
    lastAutomationActionAtMs = actionAt;
    await patch({
      lastAutomationAction: label,
      lastAutomationActionAt: new Date(actionAt).toISOString(),
      previousAutomationActionGapMs: gap
    });
  }

  class SessionExpiredError extends Error {
    constructor(message = "Notre-Dame security session is no longer valid") {
      super(message);
      this.name = "SessionExpiredError";
      this.code = "SESSION_EXPIRED";
      this.httpStatus = 403;
    }
  }

  function injectBridge() {
    if (bridgeReady) return Promise.resolve();
    if (bridgeLoadPromise) return bridgeLoadPromise;
    bridgeLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("page-bridge.js");
    script.onload = () => { bridgeReady = true; script.remove(); resolve(); };
    script.onerror = () => { bridgeLoadPromise = null; script.remove(); reject(new Error("Could not load the reservation-page bridge")); };
    (document.head || document.documentElement).appendChild(script);
    });
    return bridgeLoadPromise;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (msg?.source === "NDRH_PAGE" && (msg.type === "ADVANCE_ERROR" || msg.type === "WORKFLOW_ERROR")) {
      clearWorkflowTransitionWatch();
      if (ticketsReadyTimer) clearTimeout(ticketsReadyTimer);
      ticketsReadyTimer = null;
      ticketsFlowStarting = false;
      patch({ enabled: false, autoSelect: false, automationMode: "watch", workflowExpectedStage: null, status: "Reservation flow stopped" });
      recordWorkflowFailure("page-workflow-error", msg.error);
      log(`Reservation flow stopped: ${msg.error}`);
      return;
    }
    if (msg?.source === "NDRH_PAGE" && msg.type === "TICKETS_PREPARED") {
      if (ticketsReadyTimer) clearTimeout(ticketsReadyTimer);
      ticketsReadyTimer = null;
      ticketsFlowStarting = false;
      handlePreparedTickets(msg.visitors);
      return;
    }

    if (msg?.source === "NDRH_PAGE" && msg.type === "TICKETS_READY") {
      if (ticketsReadyTimer) clearTimeout(ticketsReadyTimer);
      ticketsReadyTimer = null;
      patch({ status: `Selected ${msg.visitors} visitor(s); opening date selection` });
      log(`Selected ${msg.visitors} visitor(s) on the Visitors page; using the site's Next step.`);
      return;
    }
    if (msg?.source === "NDRH_PAGE" && msg.type === "DATE_SELECTION_STARTED") {
      patch({ status: `Selecting ${msg.date} ${msg.time}` });
      log(`DATE · selecting ${msg.date} and waiting for ${msg.time} on Notre-Dame's own date page.`);
      return;
    }

    if (msg?.source === "NDRH_PAGE" && msg.type === "DATE_TIME_SELECTED") {
      patch({ status: `Selected ${msg.date} ${msg.time}` });
      log(`DATE · selected ${msg.date} ${msg.time} using Notre-Dame's own controls.`);
      return;
    }

    if (msg?.source === "NDRH_PAGE" && msg.type === "DATE_TIME_READY") {
      patch({ status: "Opening personal details" });
      log("DATE · Notre-Dame's Next control is ready; continuing to personal details.");
      return;
    }

    if (msg?.source === "NDRH_PAGE" && msg.type === "PAYMENT_HANDOFF_STARTED") {
      patch({
        enabled: false,
        status: `Opening Complete${msg.buttonText ? ` · ${msg.buttonText}` : ""}`
      });
      log(`AUTOMATION · Summary verified; opening Complete${msg.buttonText ? ` using "${msg.buttonText}"` : ""}.`);
      return;
    }
    if (msg?.source === "NDRH_PAGE" && msg.type === "COMPLETE_SUBMISSION_STARTED") {
      patch({ enabled: false, autoSelect: false, status: "Submitting completed reservation" });
      log("BOOKING · Terms and Conditions accepted; submitting the Complete control.");
      return;
    }

    if (!msg || msg.source !== "NDRH_PAGE" ||
        !["TIMESLOTS_RESULT", "SUMMARY_INSPECTION_RESULT"].includes(msg.type)) return;
    const handler = pending.get(msg.requestId);
    if (!handler) return;
    pending.delete(msg.requestId);
    clearTimeout(handler.timeout);
    handler.resolve(msg);
  });

  async function requestTimeslots(date, visitors) {
    if (state?.testMode) {
      if (state.lastAvailabilityKey == null) localFixtureStep = 0;
      const response = NDRHLogic.localTestResponse(state.testFixture, {
        targetDate: date,
        targetTime: state.targetTime
      }, localFixtureStep++);
      await patch({
        lastProviderRequestOutcome: `local-fixture-${state.testFixture || "available"}`,
        lastProviderRequestAt: null,
        previousProviderRequestGapMs: null
      });
      return response;
    }
    await injectBridge();
    const requestAt = Date.now();
    const requestGap = lastProviderRequestAtMs == null ? null : requestAt - lastProviderRequestAtMs;
    lastProviderRequestAtMs = requestAt;
    await patch({
      lastProviderRequestAt: new Date(requestAt).toISOString(),
      previousProviderRequestGapMs: requestGap,
      lastProviderRequestOutcome: "pending"
    });
    const response = await new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("Notre-Dame timeslot request timed out"));
      }, 10000);
      pending.set(requestId, { resolve, reject, timeout });
      window.postMessage({
        source: "NDRH_EXTENSION",
        type: "GET_TIMESLOTS",
        requestId,
        date,
        visitors
      }, "*");
    });

    await patch({
      lastProviderRequestOutcome: response?.status === 403
        ? "http-403"
        : response?.ok && response?.data?.success
          ? `http-${response.status || 200}-success`
          : `http-${response?.status || "unknown"}-failure`
    });

    if (response?.ok && response?.data?.success) {
      lastSuccessfulTimeslotCheck = {
        at: Date.now(),
        date: String(date || ""),
        visitors: Number(visitors || 0),
        status: response.status || 200,
        data: response.data
      };
    }
    return response;
  }


  function requestSummaryInspection() {
    return injectBridge().then(() => new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-summary-${Math.random().toString(36).slice(2)}`;
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("Summary verification timed out"));
      }, 5000);
      pending.set(requestId, { resolve, reject, timeout });
      window.postMessage({
        source: "NDRH_EXTENSION",
        type: "INSPECT_SUMMARY",
        requestId
      }, "*");
    }));
  }

  async function openCompleteFromSummary(expected) {
    await patch({ workflowExpectedStage: "complete" });
    await injectBridge();
    expectWorkflowTransition("complete", "opening Complete");
    window.postMessage({
      source: "NDRH_EXTENSION",
      type: "OPEN_PAYMENT",
      expected
    }, "*");
  }

  function setPageShowInactive(enabled) {
    injectBridge().then(() => {
      window.postMessage({
        source: "NDRH_EXTENSION",
        type: "SET_SHOW_INACTIVE",
        enabled: Boolean(enabled)
      }, "*");
    }).catch(() => {});
  }

  function nowStamp() {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  async function log(message) {
    await chrome.runtime.sendMessage({ type: "LOG", entry: { at: nowStamp(), message } });
  }

  async function patch(patchObj) {
    state = await chrome.runtime.sendMessage({ type: "PATCH_STATE", patch: patchObj });
    updateOverlay();
  }

  function ensureOverlay() {
    if (overlay && document.documentElement.contains(overlay)) return overlay;
    overlay = document.createElement("div");
    overlay.id = "ndrh-overlay";
    overlay.innerHTML = "<strong>Notre-Dame Helper</strong><span>Loaded</span>";
    document.documentElement.appendChild(overlay);
    return overlay;
  }

  function overlayEscape(value) {
    return String(value || "").replace(/[&<>]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]));
  }

  function updateOverlay(extra = "", available = false) {
    if (!state?.pinnedMonitor) {
      overlay?.remove();
      overlay = null;
      return;
    }
    const el = ensureOverlay();
    const target = state?.targetDate
      ? `${state.targetDate} ${state.mode === "exact" ? state.targetTime : state.mode === "range" ? `${state.rangeStart}–${state.rangeEnd}` : "any time"}`
      : "No target set";
    const automationMode = NDRHLogic.normalizeAutomationMode(state?.automationMode, state?.autoSelect);
    const hasAvailable = available || state?.lastResult === "available";
    const status = state?.enabled
      ? state?.releaseBoundaryMode
        ? automationMode === "booking" ? "BOOKING ARMED"
          : automationMode === "test" ? "TEST ARMED"
          : "ARMED"
        : automationMode === "booking" ? "BOOKING ARMED"
          : automationMode === "test" ? "TEST AUTOMATION"
          : "Watching"
      : "Idle";
    el.classList.toggle("available", hasAvailable);
    el.classList.toggle("armed", Boolean(state?.enabled && state?.releaseBoundaryMode && !hasAvailable));
    el.classList.toggle("rejected", state?.sessionHttpStatus === 403);
    const phase = state?.workflowStage && state.workflowStage !== "idle"
      ? state.workflowStage.replace(/-/g, " ")
      : status;
    const recent = (state?.logs || []).slice(-2)
      .map(entry => overlayEscape(entry?.message))
      .filter(Boolean)
      .join("<br>");
    const alert = state?.availabilityAlert?.message;
    el.innerHTML = `
      <div class="ndrh-monitor-heading"><strong>Notre-Dame Helper</strong><span>${overlayEscape(phase)}</span></div>
      <div class="ndrh-monitor-target">${overlayEscape(status)} · ${overlayEscape(target)} · ${state?.visitors || 2} visitor(s)</div>
      ${extra ? `<div class="ndrh-monitor-detail">${overlayEscape(extra)}</div>` : ""}
      ${alert ? `<div class="ndrh-monitor-alert">New matching availability · ${overlayEscape(alert)}</div>` : ""}
      ${recent ? `<div class="ndrh-monitor-activity">${recent}</div>` : ""}
      <button type="button" data-ndrh-unpin>Unpin</button>
    `;
    el.querySelector("[data-ndrh-unpin]")?.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "UNPIN_MONITOR" }).catch(() => {});
    }, { once: true });
  }

  function pageLooksLikeCloudflareChallenge() {
    const text = document.body?.innerText || "";
    return /performing security verification|verifying|cloudflare/i.test(text) &&
           /not a bot|security service|verification/i.test(text);
  }

  function slotAvailable(slot) {
    return Boolean(slot && slot.active === true);
  }

  function selectInterestingSlots(timeslots) {
    const entries = Object.entries(timeslots || {}).sort(([a], [b]) => a.localeCompare(b));
    if (state.mode === "any") return entries;
    if (state.mode === "range") {
      return entries.filter(([time]) => time >= state.rangeStart && time <= state.rangeEnd);
    }
    return entries.filter(([time]) => time === state.targetTime);
  }

  // The reservation page creates one enabled ticketTime radio for each slot
  // that it considers selectable. Read those controls before the helper makes
  // its own request: this lets automation continue from the site's initial
  // render without adding another /script/timeslots POST to a fresh page.
  function inspectRenderedSelectableTimes() {
    const selectable = [...document.querySelectorAll('input[name="ticketTime"]')]
      .filter(input => input.type !== "hidden" && !input.disabled && String(input.value || "").trim())
      .map(input => String(input.value).trim())
      .sort((a, b) => a.localeCompare(b));
    const matching = state.mode === "exact"
      ? selectable.filter(time => time === state.targetTime)
      : state.mode === "range"
        ? selectable.filter(time => time >= state.rangeStart && time <= state.rangeEnd)
        : selectable;
    if (!matching.length) return null;
    return {
      kind: "available",
      message: state.mode === "exact"
        ? `${state.targetTime} is selectable on the Date page`
        : `${matching.length} selectable slot${matching.length === 1 ? "" : "s"} already rendered: ${matching.join(", ")}`,
      available: matching.map(time => [time, { active: true, source: "page-render" }]),
      source: "page-render"
    };
  }

  async function continueFromRenderedSlot() {
    if (!state?.enabled || !state?.autoSelect || reservationFlowStarting) return false;
    const rendered = inspectRenderedSelectableTimes();
    if (!rendered) return false;
    updateOverlay(rendered.message, true);
    await patch({
      lastResult: "available",
      lastAvailabilityKey: `page-render|${rendered.message}`,
      lastTimeslotsDate: state.targetDate,
      lastTimeslots: rendered.available.map(([time]) => ({
        time,
        active: true,
        soldOut: false,
        expired: false,
        totalAvailable: null,
        classAttr: "page-rendered"
      })),
      status: "AVAILABLE · using the Date page's rendered slot"
    });
    await log(`PAGE SLOT · ${rendered.message}; continuing without a helper availability request.`);
    return maybeAutoSelect(rendered);
  }

  function stopRenderedSlotWatch() {
    renderedSlotCheckQueued = false;
    if (renderedSlotObserver) renderedSlotObserver.disconnect();
    renderedSlotObserver = null;
    if (renderedSlotWatchTimer) clearTimeout(renderedSlotWatchTimer);
    renderedSlotWatchTimer = null;
  }

  function watchForRenderedSlot(generation, durationMs) {
    stopRenderedSlotWatch();
    if (!document.body || !state?.enabled || !state?.autoSelect) return;
    const check = () => {
      if (renderedSlotCheckQueued || generation !== loopGeneration) return;
      renderedSlotCheckQueued = true;
      setTimeout(async () => {
        renderedSlotCheckQueued = false;
        if (generation !== loopGeneration || !state?.enabled || !state?.autoSelect) return;
        if (await continueFromRenderedSlot()) stopLoop();
      }, 0);
    };
    renderedSlotObserver = new MutationObserver(check);
    renderedSlotObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled", "value", "type"]
    });
    renderedSlotWatchTimer = setTimeout(stopRenderedSlotWatch, durationMs);
  }

  function clearWorkflowTransitionWatch() {
    if (workflowTransitionTimer) clearTimeout(workflowTransitionTimer);
    workflowTransitionTimer = null;
  }

  function expectWorkflowTransition(expectedStage, action) {
    clearWorkflowTransitionWatch();
    const sourcePath = window.location.pathname;
    workflowTransitionTimer = setTimeout(async () => {
      if (window.location.pathname !== sourcePath) return;
      state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
      if (state?.workflowExpectedStage !== expectedStage) return;
      await patch({
        enabled: false,
        autoSelect: false,
        automationMode: "watch",
        workflowExpectedStage: null,
        status: `Automation stopped — ${action} did not open ${expectedStage}`
      });
      await recordWorkflowFailure("transition-timeout", `${action} did not open ${expectedStage} within 15 seconds`);
      await log(`WORKFLOW STOPPED · ${action} did not open ${expectedStage} within 15 seconds.`);
      stopLoop();
    }, 15000);
  }

  async function advanceToPersonalDetails(date, time) {
    await patch({ workflowExpectedStage: "personal-details" });
    await injectBridge();
    await beforeAutomationAction("select date/time and continue");
    expectWorkflowTransition("personal-details", "selecting the time");
    window.postMessage({
      source: "NDRH_EXTENSION",
      type: "ADVANCE_TO_PERSONAL_DETAILS",
      date,
      time
    }, "*");
  }

  async function submitPersonalDetails() {
    await patch({ workflowExpectedStage: "donation" });
    await injectBridge();
    await beforeAutomationAction("submit personal details");
    expectWorkflowTransition("donation", "submitting personal details");
    window.postMessage({ source: "NDRH_EXTENSION", type: "SUBMIT_PERSONAL_DETAILS" }, "*");
  }

  async function submitZeroDonation() {
    await patch({ workflowExpectedStage: "summary" });
    await injectBridge();
    await beforeAutomationAction("set zero donation and continue");
    expectWorkflowTransition("summary", "submitting zero donation");
    window.postMessage({ source: "NDRH_EXTENSION", type: "SUBMIT_ZERO_DONATION" }, "*");
  }

  function currentWorkflowClassification() {
    const base = NDRHLogic.classifyReservationPage(
      window.location.pathname,
      String(document.body?.innerText || "").slice(0, 12000)
    );
    if (base.stage === "security" || base.stage === "final") return base;
    if (isCompletePage()) return { stage: "complete", outcome: null, confidence: "high" };
    if (document.querySelector("#firstName, #emailAddress")) return { stage: "personal-details", outcome: null, confidence: "high" };
    if (document.querySelector("#donation-check, [name=\"donation-input\"]")) return { stage: "donation", outcome: null, confidence: "high" };
    if (/\/summary(?:[/?#]|$)/.test(window.location.pathname)) return { stage: "summary", outcome: null, confidence: "high" };
    if (document.querySelector("#calendar-date, input[name=\"ticketTime\"]")) return { stage: "date", outcome: null, confidence: "high" };
    return base;
  }

  async function recordWorkflowPage(source = "page") {
    const classification = currentWorkflowClassification();
    const requestedMode = NDRHLogic.normalizeAutomationMode(
      state?.workflowRequestedAutomationMode || state?.automationMode,
      state?.autoSelect
    );
    const recovery = NDRHLogic.workflowRecovery(classification.stage, requestedMode);
    const expectedStage = state?.workflowExpectedStage || null;
    const transitionMatched = !expectedStage || classification.stage === expectedStage || classification.stage === "final";
    const patchValue = {
      workflowStage: classification.stage,
      workflowExpectedStage: transitionMatched ? null : expectedStage,
      workflowLastTransitionAt: new Date().toISOString(),
      workflowLastUrl: window.location.href,
      workflowCanResume: Boolean(recovery.canResume && state?.workflowFailureCode),
      workflowResumeHint: state?.workflowFailureCode ? recovery.hint : null
    };
    if (!transitionMatched && classification.stage !== "unknown" && classification.stage !== "security") {
      patchValue.enabled = false;
      patchValue.autoSelect = false;
      patchValue.workflowFailureCode = "unexpected-page";
      patchValue.workflowFailureReason = `Expected ${expectedStage}, reached ${classification.stage}`;
      patchValue.workflowCanResume = Boolean(recovery.canResume);
      patchValue.workflowResumeHint = recovery.hint;
      patchValue.status = `Automation stopped - expected ${expectedStage}, reached ${classification.stage}`;
    }
    if (classification.stage === "final") {
      patchValue.enabled = false;
      patchValue.autoSelect = false;
      patchValue.bookingOutcome = classification.outcome || "unclassified";
      patchValue.bookingOutcomeEvidence = {
        pathname: window.location.pathname,
        confidence: classification.confidence
      };
      patchValue.status = classification.outcome === "confirmed"
        ? "Booking confirmed"
        : classification.outcome === "failed"
          ? "Booking failed"
          : "Final result page reached - outcome unclassified";
    }
    if (classification.stage === "complete" && requestedMode === "test") {
      patchValue.enabled = false;
      patchValue.autoSelect = false;
      patchValue.status = "TEST · reached Complete — no submission";
    }
    await patch(patchValue);
    if (["complete", "final"].includes(classification.stage)) {
      await chrome.runtime.sendMessage({ type: "CLEAR_PERSONAL_DETAILS" });
      await log("PERSONAL DETAILS · cleared temporary details after Complete was reached.");
    }
    if (!transitionMatched && classification.stage !== "unknown" && classification.stage !== "security") {
      await log(`WORKFLOW STOPPED · expected ${expectedStage}, reached ${classification.stage}.`);
    }
    if (classification.stage === "final") {
      await log(`FINAL RESULT · ${classification.outcome || "unclassified"} · ${window.location.pathname} · confidence=${classification.confidence}`);
    } else if (source === "page-load") {
      await log(`WORKFLOW · page=${classification.stage} · ${window.location.pathname}`);
    }
    return classification;
  }

  async function recordWorkflowFailure(code, reason) {
    const classification = currentWorkflowClassification();
    const requestedMode = NDRHLogic.normalizeAutomationMode(
      state?.workflowRequestedAutomationMode || state?.automationMode,
      state?.autoSelect
    );
    const recovery = NDRHLogic.workflowRecovery(classification.stage, requestedMode);
    await patch({
      workflowStage: classification.stage,
      workflowExpectedStage: state?.workflowExpectedStage || null,
      workflowLastTransitionAt: new Date().toISOString(),
      workflowLastUrl: window.location.href,
      workflowFailureCode: String(code || "workflow-error"),
      workflowFailureReason: String(reason || "Reservation workflow stopped"),
      workflowCanResume: Boolean(recovery.canResume),
      workflowResumeHint: recovery.hint
    });
  }

  function isTicketsPage() {
    return /\/reservationindividuelle\/tickets(?:[/?#]|$)/.test(window.location.pathname);
  }

  async function rejectAutomationForSession(error, context = "before continuing automation") {
    const rejected = error?.code === "SESSION_EXPIRED" || error?.httpStatus === 403;
    if (rejected) {
      document.title = "⚠ ND 403 — REVALIDATE";
      updateOverlay("Security rejected request (HTTP 403) · reload Notre-Dame and revalidate");
      await patch({
        ...NDRHLogic.sessionExpiredPatch(),
        status: "Security rejected (403) — automation stopped",
        lastResult: "security-rejected",
        sessionCheckedAt: new Date().toISOString(),
        nextReleaseCheckAt: null,
        boundaryHandoffCheckPending: false
      });
      await recordWorkflowFailure("http-403", `HTTP 403 ${context}`);
      await log(`SECURITY REJECTED · HTTP 403 ${context} · automation did not continue`);
    } else {
      await patch({
        enabled: false,
        autoSelect: false,
        automationMode: "watch",
        status: "Session check failed — automation stopped",
        sessionStatus: "error",
        sessionCheckedAt: new Date().toISOString(),
        nextReleaseCheckAt: null,
        boundaryHandoffCheckPending: false
      });
      await recordWorkflowFailure("session-check-error", String(error?.message || error));
      await log(`SESSION CHECK ERROR ${context} · ${String(error?.message || error)} · automation did not continue`);
    }
    stopLoop();
  }

  async function verifyCurrentSessionForAutomation(visitors, { boundaryHandoff = false } = {}) {
    state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    const date = state?.targetDate;
    if (!date) {
      await rejectAutomationForSession(new Error("Choose a target date first"));
      return false;
    }
    if (pageLooksLikeCloudflareChallenge()) {
      await patch({
        enabled: false,
        autoSelect: false,
        automationMode: "watch",
        sessionStatus: "verifying",
        status: "Security verification in progress — automation stopped",
        nextReleaseCheckAt: null,
        boundaryHandoffCheckPending: false
      });
      await log("SESSION CHECK · security verification is still in progress · automation did not continue");
      stopLoop();
      return false;
    }

    try {
      const requestedVisitors = Number(visitors || state?.visitors || 2);
      const recent = lastSuccessfulTimeslotCheck;
      const canReuseRecentProof = Boolean(
        recent &&
        Date.now() - recent.at <= RECENT_SESSION_PROOF_MS &&
        recent.date === String(date) &&
        recent.visitors === requestedVisitors
      );

      let response;
      if (canReuseRecentProof) {
        response = { ok: true, status: recent.status, data: recent.data };
        await patch({ status: "Recent session proof ✓ - continuing automation" });
        await log(`SESSION VALID · reusing this tab's successful /timeslots response from ${Math.round((Date.now() - recent.at) / 1000)}s ago; no redundant API call.`);
      } else if (boundaryHandoff) {
        // At a release boundary this request is useful work: it is the actual
        // availability check for the boundary, not a separate validation ping.
        await patch({ status: "Release boundary - checking availability" });
        response = await requestTimeslots(date, requestedVisitors);
      } else {
        // Do not spend an extra /timeslots request merely to prove the session.
        // Continue through Notre-Dame's own visible Next action. The first live
        // availability request on the Date page becomes the session proof.
        await patch({
          sessionStatus: "page-context",
          status: "Continuing with Notre-Dame page - no separate session request"
        });
        await log("SESSION · no separate validation request; using the site's own page transition and the next required availability request as proof.");
        return true;
      }
      if (response.status === 403) throw new SessionExpiredError();
      if (!response.ok || !response.data?.success) {
        throw new Error(response.error || `Timeslot API failed (HTTP ${response.status || "?"})`);
      }
      const slotSnapshot = Object.entries(response.data.timeslots || {}).map(([time, slot]) => ({
        time, active: Boolean(slot.active), soldOut: Boolean(slot.soldOut),
        expired: Boolean(slot.expired), totalAvailable: slot.totalAvailable, classAttr: slot.classAttr || ""
      }));
      await patch({
        sessionStatus: "valid",
        sessionCheckedAt: new Date().toISOString(),
        sessionHttpStatus: response.status || 200,
        lastTimeslotsDate: response.data.date || date,
        lastTimeslots: slotSnapshot,
        boundaryHandoffCheckPending: Boolean(boundaryHandoff),
        status: "Session valid ✓ — continuing automation"
      });
      await log(`SESSION VALID · current tab/session accepted (HTTP ${response.status || 200}) · continuing automation`);
      return true;
    } catch (error) {
      await rejectAutomationForSession(error);
      return false;
    }
  }

  async function continueTicketsAutomation(visitors, { boundaryHandoff = false } = {}) {
    const valid = await verifyCurrentSessionForAutomation(visitors, { boundaryHandoff });
    if (!valid) return false;
    await patch({ workflowExpectedStage: "date" });
    await injectBridge();
    await beforeAutomationAction("continue from Visitors");
    window.postMessage({ source: "NDRH_EXTENSION", type: "CONTINUE_TICKETS", visitors }, "*");
    return true;
  }

  async function handlePreparedTickets(visitors) {
    state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (!state?.enabled || !state?.autoSelect) return;
    if (state.releaseBoundaryMode) {
      await patch({ status: "ARMED — visitors selected; waiting to validate this session at release boundary" });
      await log("ARMED · visitor count prepared; no live session check until the release boundary.");
      await scheduleNextReleaseBoundary({ allowImmediateIfPast: true });
      return;
    }
    await continueTicketsAutomation(visitors, { boundaryHandoff: false });
  }

  async function beginTicketsAutomation() {
    if (ticketsFlowStarting || !state?.autoSelect) return;
    const validation = await validateStoredPersonalDetails();
    if (!validation.valid) {
      await stopForIncompletePersonalDetails(validation);
      return;
    }
    ticketsFlowStarting = true;
    try {
      await patch({ status: `Preparing ${state.visitors || 2} visitor(s)` });
      await log(`Starting from the Visitors page with ${state.visitors || 2} visitor(s); automation will not continue until this tab/session passes a live check.`);
      await injectBridge();
      await beforeAutomationAction("prepare visitor quantity");
      window.postMessage({
        source: "NDRH_EXTENSION",
        type: "PREPARE_TICKETS",
        visitors: state.visitors || 2
      }, "*");
      // A page left open while the extension was reloaded can still contain an
      // older bridge script. Fail clearly instead of leaving the user on the
      // Visitors page with an apparently active automation setting.
      ticketsReadyTimer = setTimeout(async () => {
        if (!ticketsFlowStarting) return;
        ticketsFlowStarting = false;
        await patch({
          enabled: false,
          autoSelect: false,
          automationMode: "watch",
          status: "Reload the Visitors page, then try again"
        });
        await recordWorkflowFailure("visitor-setup-timeout", "Visitor setup did not receive a response");
        await log("Visitor setup did not receive a response; reload the Visitors page after updating the extension.");
      }, 4000);
    } catch (error) {
      if (ticketsReadyTimer) clearTimeout(ticketsReadyTimer);
      ticketsReadyTimer = null;
      ticketsFlowStarting = false;
      await patch({
        enabled: false,
        autoSelect: false,
        automationMode: "watch",
        status: "Visitor setup stopped"
      });
      await recordWorkflowFailure("visitor-setup-error", String(error?.message || error));
      await log(`Visitor setup stopped: ${String(error?.message || error)}`);
    }
  }

  function setPersonalField(selector, value) {
    const field = document.querySelector(selector);
    if (!field || !value) return false;
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  async function validateStoredPersonalDetails() {
    const details = await chrome.runtime.sendMessage({ type: "GET_PERSONAL_DETAILS" });
    return NDRHLogic.validatePersonalDetails(details);
  }

  async function stopForIncompletePersonalDetails(validation) {
    const labels = validation.issues.map(issue => issue.label).join(", ");
    await patch({
      enabled: false,
      autoSelect: false,
      automationMode: "watch",
      status: `Personal details required: ${labels}`
    });
    await recordWorkflowFailure("personal-details-incomplete", `Personal details need attention: ${labels}`);
    await log(`Reservation flow stopped: temporary personal details need attention (${labels}).`);
  }

  function setCountry(value) {
    const country = document.querySelector("#country");
    if (!country || !value) return false;
    const normalize = text => String(text || "").trim().toLocaleLowerCase();
    const wanted = normalize(value);
    const option = [...country.options].find(item =>
      normalize(item.value) === wanted || normalize(item.textContent) === wanted
    );
    if (!option) return false;
    country.value = option.value;
    country.dispatchEvent(new Event("input", { bubbles: true }));
    country.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  async function fillPersonalDetails() {
    if (personalDetailsFilled) return true;
    if (!document.querySelector("#firstName, #emailAddress, #phone-number")) return false;
    const details = await chrome.runtime.sendMessage({ type: "GET_PERSONAL_DETAILS" });
    if (!Object.values(details || {}).some(Boolean)) return false;

    const fieldsSet = [
      setPersonalField("#firstName", details.firstName),
      setPersonalField("#surname", details.surname),
      setPersonalField("#emailAddress", details.emailAddress),
      setPersonalField("#emailAddressConfirm", details.emailAddress),
      setPersonalField("#zipcode", details.zipcode),
      setCountry(details.country),
      setPersonalField("#phone-number", details.phoneNumber)
    ].every(Boolean);
    if (!fieldsSet) {
      await log("PERSONAL DETAILS · one or more required site fields could not be filled; temporary details retained.");
      return false;
    }
    if (details.phoneNumber) {
      await injectBridge();
      window.postMessage({
        source: "NDRH_EXTENSION",
        type: "SET_PHONE_NUMBER",
        phoneNumber: details.phoneNumber
      }, "*");
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    personalDetailsFilled = true;
    return true;
  }

  function isPersonalDetailsPage() {
    return Boolean(document.querySelector("#firstName, #emailAddress"));
  }

  function isDonationPage() {
    return Boolean(document.querySelector("#donation-check, [name=\"donation-input\"]"));
  }

  function isSummaryPage() {
    return /\/summary(?:[/?#]|$)/.test(window.location.pathname);
  }

  function isCompletePage() {
    return /\/payment(?:[/?#]|$)/.test(window.location.pathname) &&
      Boolean(document.querySelector("#terms-and-conditions"));
  }

  function pageReportsSlotShortage() {
    const text = document.body?.innerText || "";
    return /too few tickets in stock at the selected time|not enough tickets.*selected time/i.test(text);
  }

  function pageReportsOrderLimit() {
    return /maximum amount of orders has been reached/i.test(document.body?.innerText || "");
  }

  async function continueReservationFlow() {
    state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (!state?.autoSelect) return;

    if (pageReportsSlotShortage()) {
      await patch({
        enabled: false,
        autoSelect: false,
        automationMode: "watch",
        lastResult: "slot-lost",
        status: "Slot no longer available"
      });
      await recordWorkflowFailure("slot-lost", "The selected slot was no longer available");
      await log("Reservation flow stopped: the selected slot was no longer available.");
      return;
    }

    if (pageReportsOrderLimit()) {
      await patch({
        enabled: false,
        autoSelect: false,
        automationMode: "watch",
        workflowExpectedStage: null,
        status: "Reservation order limit reached"
      });
      await recordWorkflowFailure("order-limit", "The reservation site reported that its maximum order limit was reached");
      await log("Reservation flow stopped: the reservation site reported its maximum order limit was reached.");
      return;
    }

    if (isSummaryPage()) {
      const automationMode = NDRHLogic.normalizeAutomationMode(state.automationMode, state.autoSelect);

      if (automationMode === "watch") {
        await patch({
          enabled: false,
          autoSelect: false,
          automationMode: "watch",
          status: "Ready for Payment"
        });
        await log("Reservation flow reached Summary; Payment remains manual.");
        return;
      }

      if (state.finalConfirmationAttempted) {
        await patch({ enabled: false, autoSelect: false, status: "Complete-page handoff already attempted" });
        await log("AUTOMATION · Complete-page handoff was already attempted; not repeating it.");
        return;
      }

      const expected = {
        date: state.automationSelectedDate || state.targetDate,
        time: state.automationSelectedTime || (state.mode === "exact" ? state.targetTime : null),
        visitors: state.automationSelectedVisitors || state.visitors
      };

      if (!expected.date || !expected.time || !Number.isFinite(Number(expected.visitors))) {
        await patch({
          enabled: false,
          autoSelect: false,
          automationMode: "watch",
          status: "Automation stopped — selected reservation target is incomplete"
        });
        await log("AUTOMATION STOPPED · could not reconstruct the exact selected date/time/visitor count.");
        return;
      }

      try {
        const inspection = await requestSummaryInspection();
        if (!inspection.ok || !inspection.evidence) {
          throw new Error(inspection.error || "Could not inspect Summary");
        }
        const verification = NDRHLogic.verifySummaryEvidence(inspection.evidence, expected);
        await patch({ summaryVerification: verification });

        if (!verification.valid) {
          const failed = [
            !verification.dateOk ? "date" : null,
            !verification.timeOk ? "time" : null,
            !verification.visitorsOk ? "visitor count" : null
          ].filter(Boolean).join(", ");
          await patch({
            enabled: false,
            autoSelect: false,
            automationMode: "watch",
            status: `Automation stopped — Summary mismatch: ${failed}`
          });
          await recordWorkflowFailure("summary-mismatch", `Summary mismatch: ${failed}`);
          await log(`AUTOMATION STOPPED · Summary verification failed (${failed}). Payment was not opened.`);
          return;
        }

        await patch({
          enabled: false,
          finalConfirmationAttempted: true,
          status: automationMode === "test"
            ? "TEST · Summary verified; opening Complete and stopping there"
            : "BOOKING · Summary verified; opening Complete"
        });
        await log(
          `${automationMode === "test" ? "TEST" : "BOOKING"} · Summary verified: ${expected.date} ${expected.time}, ` +
          `${expected.visitors} visitor(s). Opening Complete.`
        );
        await beforeAutomationAction("open Complete");
        await patch({ status: "Opening Complete" });
        await openCompleteFromSummary(expected);
      } catch (error) {
        await patch({
          enabled: false,
          autoSelect: false,
          automationMode: "watch",
          status: "Automation stopped — Summary verification error"
        });
        await recordWorkflowFailure("summary-verification-error", String(error?.message || error));
        await log(`AUTOMATION STOPPED · ${String(error?.message || error)}. Payment was not opened.`);
      }
      return;
    }

    if (isCompletePage()) {
      const automationMode = NDRHLogic.normalizeAutomationMode(state.automationMode, state.autoSelect);
      if (automationMode !== "booking") {
        await patch({ enabled: false, autoSelect: false, status: "TEST · reached Complete — no submission" });
        await log("TEST AUTOMATION · reached Complete and stopped before accepting Terms and Conditions or submitting.");
        return;
      }
      if (state.finalSubmissionAttempted) {
        await patch({ enabled: false, autoSelect: false, status: "Complete submission already attempted" });
        await log("BOOKING · Complete submission was already attempted; not repeating it.");
        return;
      }
      await patch({ finalSubmissionAttempted: true, workflowExpectedStage: "final", status: "BOOKING · accepting T&Cs and completing reservation" });
      await log("BOOKING · reached Complete; accepting Terms and Conditions and submitting the reservation.");
      await beforeAutomationAction("accept Terms and Conditions and complete reservation");
      await injectBridge();
      expectWorkflowTransition("final", "submitting the completed reservation");
      window.postMessage({ source: "NDRH_EXTENSION", type: "COMPLETE_RESERVATION" }, "*");
      return;
    }

    if (isPersonalDetailsPage()) {
      const validation = await validateStoredPersonalDetails();
      if (!validation.valid) {
        await stopForIncompletePersonalDetails(validation);
        return;
      }
      await beforeAutomationAction("fill personal details");
      const filled = await fillPersonalDetails();
      if (!filled) {
        await patch({ enabled: false, autoSelect: false, status: "Personal details could not be filled" });
        await recordWorkflowFailure("personal-details-fill-failed", "One or more required site fields could not be filled");
        await log("Reservation flow stopped: one or more required site fields could not be filled.");
        return;
      }
      await patch({ enabled: false, status: "Opening donation" });
      await log("Personal details filled; opening the donation page.");
      await submitPersonalDetails();
      return;
    }

    if (isDonationPage()) {
      await patch({ enabled: false, status: "Opening summary" });
      await log("Setting donation to zero and opening Summary.");
      await submitZeroDonation();
    }
  }

  function interpretTimeslotsData(data) {
    const timeslots = data?.timeslots || {};
    const considered = selectInterestingSlots(timeslots);
    const available = considered.filter(([, slot]) => slotAvailable(slot));

    if (state.mode === "exact") {
      const slot = timeslots?.[state.targetTime];
      if (!slot) return { kind: "missing", message: `${state.targetTime} is not listed for ${state.targetDate}`, data };
      if (slotAvailable(slot)) return { kind: "available", message: `${state.targetTime} AVAILABLE · totalAvailable=${slot.totalAvailable}`, available, data };
      return {
        kind: "unavailable",
        message: `${state.targetTime} unavailable · active=${slot.active} soldOut=${slot.soldOut} expired=${slot.expired} totalAvailable=${slot.totalAvailable} class=${slot.classAttr || ""}`,
        available, data
      };
    }
    if (available.length) {
      const summary = available.map(([time, slot]) => `${time}(${slot.totalAvailable})`).join(", ");
      return { kind: "available", message: `${available.length} available: ${summary}`, available, data };
    }
    const scope = state.mode === "range" ? `${state.rangeStart}–${state.rangeEnd}` : "the day";
    return { kind: "unavailable", message: `No available slots in ${scope}`, available, data };
  }

  function cachedTimeslotsData() {
    const entries = Array.isArray(state?.lastTimeslots) ? state.lastTimeslots : [];
    if (!entries.length) return null;
    return {
      success: true,
      date: state.lastTimeslotsDate || state.targetDate,
      timeslots: Object.fromEntries(entries.map(slot => [slot.time, { ...slot }]))
    };
  }

  async function inspectApi() {
    if (!state?.targetDate) return { kind: "config", message: "Set a target date" };
    if (!state?.testMode && pageLooksLikeCloudflareChallenge()) return { kind: "cloudflare", message: "Waiting for Cloudflare verification" };
    const response = await requestTimeslots(state.targetDate, state.visitors || 2);
    if (response.status === 403) throw new SessionExpiredError();
    if (!response.ok || !response.data?.success) throw new Error(response.error || `Timeslot API failed (HTTP ${response.status || "?"})`);
    return interpretTimeslotsData(response.data);
  }

  async function maybeAutoSelect(result) {
    if (!state.autoSelect || result.kind !== "available" || reservationFlowStarting) return false;
    if (state.testMode) {
      await log("LOCAL TEST · matching fixture availability detected; reservation automation remains disabled.");
      return false;
    }
    const validation = await validateStoredPersonalDetails();
    if (!validation.valid) {
      await stopForIncompletePersonalDetails(validation);
      return false;
    }
    const selectedTime = state.mode === "exact"
      ? state.targetTime
      : result.available?.[0]?.[0];
    if (!selectedTime) return false;
    reservationFlowStarting = true;
    try {
      await patch({
        enabled: false,
        status: "Opening personal details",
        automationSelectedDate: state.targetDate,
        automationSelectedTime: selectedTime,
        automationSelectedVisitors: Number(state.visitors || 2),
        finalConfirmationAttempted: false,
        finalSubmissionAttempted: false,
        summaryVerification: null
      });
      await log(`${selectedTime} is the earliest matching active slot; selecting the date/time on Notre-Dame's page.`);
      await advanceToPersonalDetails(state.targetDate, selectedTime);
      return true;
    } catch (error) {
      reservationFlowStarting = false;
      await patch({ enabled: false, autoSelect: false, automationMode: "watch", status: "Reservation flow stopped" });
      await log(`Reservation flow stopped: ${String(error?.message || error)}`);
      return false;
    }
  }


  function quarterHourTimes(start = "00:00", end = "23:45") {
    const toMinutes = value => {
      const [h, m] = String(value || "").split(":").map(Number);
      return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
    };
    const from = toMinutes(start);
    const to = toMinutes(end);
    if (from === null || to === null || from > to) return [];
    const out = [];
    for (let minutes = from; minutes <= to; minutes += 15) {
      out.push(`${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`);
    }
    return out;
  }

  function releaseBoundaryTimes(currentState) {
    if (!currentState?.targetDate) return [];
    if (currentState.mode === "exact") return [currentState.targetTime];
    if (currentState.mode === "range") return quarterHourTimes(currentState.rangeStart, currentState.rangeEnd);
    return quarterHourTimes();
  }

  function releaseCheckTimestamp(currentState, visitTime) {
    const date = String(currentState?.targetDate || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(String(visitTime || ""))) return null;
    const visit = new Date(`${date}T${visitTime}:00`);
    if (Number.isNaN(visit.getTime())) return null;
    const leadMs = Number(currentState.releaseLeadHours || 24) * 60 * 60 * 1000;
    const offsetMs = Number(currentState.boundaryOffsetSeconds ?? 2) * 1000;
    return visit.getTime() - leadMs + offsetMs;
  }

  function nextReleaseBoundary(currentState, nowMs = Date.now()) {
    const candidates = releaseBoundaryTimes(currentState)
      .map(time => ({ time, at: releaseCheckTimestamp(currentState, time) }))
      .filter(item => Number.isFinite(item.at) && item.at > nowMs + 250)
      .sort((a, b) => a.at - b.at);
    return candidates[0] || null;
  }

  async function scheduleNextReleaseBoundary({ allowImmediateIfPast = false } = {}) {
    stopLoop();
    state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (!state?.enabled || !state.releaseBoundaryMode) return;

    const next = nextReleaseBoundary(state);
    if (next) {
      const iso = new Date(next.at).toISOString();
      const local = new Date(next.at).toLocaleTimeString([], {
        hour: "2-digit", minute: "2-digit", second: "2-digit"
      });
      await patch({
        nextReleaseCheckAt: iso,
        status: `ARMED — next live check ${local}`
      });
      updateOverlay(`No API requests while waiting · next check ${local}`);
      await log(`ARMED · no live requests until ${local} (release boundary for ${next.time}).`);
      timer = setTimeout(runReleaseBoundaryCheck, Math.max(0, next.at - Date.now()));
      return;
    }

    if (allowImmediateIfPast) {
      const at = Date.now() + 250;
      await patch({
        nextReleaseCheckAt: new Date(at).toISOString(),
        status: "ARMED — release boundary already passed; checking once now"
      });
      await log("ARMED · configured release boundary has already passed; making one live check now.");
      timer = setTimeout(runReleaseBoundaryCheck, 250);
      return;
    }

    await patch({
      enabled: false,
      nextReleaseCheckAt: null,
      status: "Armed window complete — no later release boundary"
    });
    await log("ARMED · no later configured release boundary remains; monitoring stopped.");
    updateOverlay("Armed window complete — no later release boundary");
  }

  async function runReleaseBoundaryCheck() {
    timer = null;
    state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (!state?.enabled || !state.releaseBoundaryMode) return;

    await patch({ nextReleaseCheckAt: null, status: "ARMED · checking release boundary" });

    if (isTicketsPage() && state.autoSelect) {
      const continued = await continueTicketsAutomation(state.visitors || 2, { boundaryHandoff: true });
      if (continued) await log("ARMED · release-boundary session check passed; continuing to the date page.");
      return;
    }

    await tick();

    const after = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (!after?.enabled || !after.releaseBoundaryMode) return;
    if (after.lastResult === "available") {
      await patch({ nextReleaseCheckAt: null });
      stopLoop();
      return;
    }
    await scheduleNextReleaseBoundary({ allowImmediateIfPast: false });
  }

  async function tick() {
    if (tickInProgress) return;
    tickInProgress = true;
    try {
    state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    updateOverlay();
    if (!state?.enabled) return;

    try {
      const result = await inspectApi();
      const key = `${result.kind}|${result.message}`;
      const changed = key !== state.lastAvailabilityKey;
      const availabilityAlert = NDRHLogic.availabilityTransition(state.lastAvailabilityKey, result);
      updateOverlay(result.message, result.kind === "available");

      const slotSnapshot = result.data?.timeslots
        ? Object.entries(result.data.timeslots).map(([time, slot]) => ({
            time,
            active: Boolean(slot.active),
            soldOut: Boolean(slot.soldOut),
            expired: Boolean(slot.expired),
            totalAvailable: slot.totalAvailable,
            classAttr: slot.classAttr || ""
          }))
        : state.lastTimeslots || [];

      await patch({
        lastCheck: new Date().toISOString(),
        lastResult: result.kind,
        lastAvailabilityKey: key,
        availabilityAlert,
        lastTimeslotsDate: result.data?.date || state.lastTimeslotsDate || null,
        lastTimeslots: slotSnapshot,
        sessionStatus: result.kind === "cloudflare" ? "verifying" : "valid",
        sessionCheckedAt: result.kind === "cloudflare" ? state.sessionCheckedAt : new Date().toISOString(),
        sessionHttpStatus: result.kind === "cloudflare" ? state.sessionHttpStatus : 200,
        status: result.kind === "available" ? "AVAILABLE" : result.kind === "cloudflare" ? "Waiting for Cloudflare" : "Watching"
      });

      // Log every check; prefix changes so release transitions stand out.
      await log(`${availabilityAlert ? "ALERT · NEW AVAILABILITY · " : changed ? "CHANGE · " : ""}${result.message}`);

      if (result.kind === "available") {
        document.title = `★ ND ${state.targetTime || "slot"} AVAILABLE`;
        const selected = await maybeAutoSelect(result);
        if (selected) stopLoop();
      }
    } catch (error) {
      if (error?.code === "SESSION_EXPIRED" || error?.httpStatus === 403) {
        const message = "Security rejected request (HTTP 403) · reload Notre-Dame and revalidate";
        document.title = "⚠ ND 403 — REVALIDATE";
        updateOverlay(message);
        await patch({
          ...NDRHLogic.sessionExpiredPatch(),
          status: "Security rejected (403)",
          lastResult: "security-rejected",
          lastCheck: new Date().toISOString(),
          sessionCheckedAt: new Date().toISOString(),
          nextReleaseCheckAt: null
        });
        if (state?.autoSelect || NDRHLogic.automationUsesReservationFlow(state?.workflowRequestedAutomationMode)) {
          await recordWorkflowFailure("http-403", "HTTP 403 from /script/timeslots");
        }
        await log("SECURITY REJECTED · HTTP 403 from /script/timeslots · monitoring stopped");
        stopLoop();
        return;
      }

      const message = `API error: ${String(error?.message || error)}`;
      updateOverlay(message);
      await patch({
        lastCheck: new Date().toISOString(),
        lastResult: "error",
        sessionStatus: "error",
        sessionCheckedAt: new Date().toISOString(),
        status: "API error"
      });
      if (state?.autoSelect || NDRHLogic.automationUsesReservationFlow(state?.workflowRequestedAutomationMode)) {
        await recordWorkflowFailure("api-error", String(error?.message || error));
      }
      await log(message);
    }
    } finally {
      tickInProgress = false;
    }
  }

  function stopLoop() {
    loopGeneration++;
    stopRenderedSlotWatch();
    if (timer) {
      clearInterval(timer);
      clearTimeout(timer);
    }
    timer = null;
  }

  async function startLoop() {
    stopLoop();
    state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    updateOverlay();
    const workflowPage = await recordWorkflowPage("page-load");
    if (workflowPage.stage === "final") { stopLoop(); return; }
    if (workflowPage.stage === "security") {
      await recordWorkflowFailure("security-challenge", "Notre-Dame security verification is active");
      stopLoop();
      return;
    }
    injectBridge();
    setPageShowInactive(Boolean(state?.showInactive));
    if (!state?.enabled) return;
    if (["personal-details", "donation", "summary", "complete"].includes(workflowPage.stage)) {
      // These pages are advanced by continueReservationFlow(). Availability
      // polling here cannot help and can create an unnecessary site request
      // while a form handoff is still settling.
      stopLoop();
      return;
    }
    if (isTicketsPage()) {
      if (state.autoSelect) {
        await beginTicketsAutomation();
      } else {
        await patch({ status: "Choose Test or Booking automation to start from Visitors" });
      }
      return;
    }
    if (state.releaseBoundaryMode) {
      if (state.boundaryHandoffCheckPending) {
        await patch({ boundaryHandoffCheckPending: false, status: "ARMED · using cached release-boundary result" });
        const cached = cachedTimeslotsData();
        if (cached) {
          const result = interpretTimeslotsData(cached);
          await patch({ lastResult: result.kind, status: result.kind === "available" ? "AVAILABLE" : "ARMED · no matching slot at this boundary" });
          await log(`ARMED · reused the release-boundary /timeslots result after page handoff; no duplicate API request. ${result.message}`);
          if (result.kind === "available") {
            const selected = await maybeAutoSelect(result);
            if (selected) stopLoop();
            return;
          }
        } else {
          await log("ARMED · cached release-boundary result was unavailable; performing one required availability request.");
          await tick();
        }
        const afterHandoff = await chrome.runtime.sendMessage({ type: "GET_STATE" });
        if (afterHandoff?.enabled && afterHandoff.releaseBoundaryMode && afterHandoff.lastResult !== "available") await scheduleNextReleaseBoundary({ allowImmediateIfPast: false });
        return;
      }
      await scheduleNextReleaseBoundary({ allowImmediateIfPast: true });
      return;
    }
    if (workflowPage.stage === "date" && state.autoSelect) {
      // The site normally renders its timeslots shortly after navigation.
      // Give that render the configured settle time, then use its actual
      // selectable controls if a requested slot is already present. This is
      // intentionally not a retry loop and does not contact the provider.
      await ensurePageSettled("checking the site's visible timeslots");
      if (await continueFromRenderedSlot()) {
        stopLoop();
        return;
      } else {
        await log("PAGE SLOT · no matching selectable time is rendered yet; watching the page render until the normal helper check.");
      }
    }
    const seconds = Math.min(900, Math.max(15, Number(state.pollSeconds || 15)));
    // The Date page loads its own timeslots. Leave one full polling interval
    // before the helper checks, avoiding a second POST during that page load.
    // Schedule from completion so slow requests cannot overlap or bunch up.
    const generation = loopGeneration;
    async function pollNext() {
      if (generation !== loopGeneration) return;
      timer = null;
      stopRenderedSlotWatch();
      await tick();
      if (generation === loopGeneration && state?.enabled) {
        timer = setTimeout(pollNext, seconds * 1000);
      }
    }
    await log(`POLL · first helper check in ${seconds}s; allowing the site's initial timeslot request to finish.`);
    if (generation === loopGeneration && state?.enabled) {
      watchForRenderedSlot(generation, seconds * 1000);
      timer = setTimeout(pollNext, seconds * 1000);
    }
  }

  async function validateSession() {
    state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    const date = state?.targetDate || document.querySelector("#calendar-date")?.value;

    if (!date) {
      await patch({ sessionStatus: "unknown", status: "Choose a date first" });
      await log("SESSION CHECK · choose a target date first");
      return;
    }

    if (pageLooksLikeCloudflareChallenge()) {
      await patch({ sessionStatus: "verifying", status: "Waiting for Cloudflare" });
      await log("SESSION CHECK · security verification still in progress");
      return;
    }

    try {
      const response = await requestTimeslots(date, state?.visitors || 2);
      if (response.status === 403) throw new SessionExpiredError();
      if (!response.ok || !response.data?.success) {
        throw new Error(response.error || `Timeslot API failed (HTTP ${response.status || "?"})`);
      }

      const slotSnapshot = Object.entries(response.data.timeslots || {}).map(([time, slot]) => ({
        time,
        active: Boolean(slot.active),
        soldOut: Boolean(slot.soldOut),
        expired: Boolean(slot.expired),
        totalAvailable: slot.totalAvailable,
        classAttr: slot.classAttr || ""
      }));

      await patch({
        sessionStatus: "valid",
        sessionCheckedAt: new Date().toISOString(),
        sessionHttpStatus: response.status || 200,
        lastTimeslotsDate: response.data.date || date,
        lastTimeslots: slotSnapshot,
        status: "Session valid ✓"
      });
      updateOverlay("Session valid ✓");
      await log(`SESSION VALID · HTTP ${response.status || 200} from /script/timeslots`);
    } catch (error) {
      if (error?.code === "SESSION_EXPIRED" || error?.httpStatus === 403) {
        await patch({
          ...NDRHLogic.sessionExpiredPatch(),
          status: "Security rejected (403)",
          lastResult: "security-rejected",
          sessionCheckedAt: new Date().toISOString(),
          nextReleaseCheckAt: null
        });
        updateOverlay("Security rejected request (HTTP 403) · revalidate Notre-Dame");
        await log("SECURITY REJECTED · HTTP 403 from /script/timeslots");
        stopLoop();
        return;
      }

      await patch({
        sessionStatus: "error",
        sessionCheckedAt: new Date().toISOString(),
        status: "Session check failed"
      });
      await log(`SESSION CHECK ERROR · ${String(error?.message || error)}`);
    }
  }

  function redactDiagnosticText(value, secrets = []) {
    return NDRHLogic.redactDiagnosticText(value, secrets);
  }

  async function diagnosticSnapshot() {
    const collectionErrors = [];
    let details = {};
    try {
      details = await chrome.runtime.sendMessage({ type: "GET_PERSONAL_DETAILS" }) || {};
    } catch (error) {
      collectionErrors.push({ source: "temporaryPersonalDataPresence", error: String(error?.message || error) });
    }
    const secrets = Object.values(details || {}).filter(value => typeof value === "string" && value.trim()).map(value => value.trim());
    const path = location.pathname || "";
    const sensitivePage = /personal-details|summary|payment|complete/i.test(path);
    const controls = Array.from(document.querySelectorAll("input, select, textarea, button, a, [role='button']"))
      .slice(0, 140)
      .map((el, i) => {
        const nameKey = `${el.getAttribute?.("name") || ""} ${el.id || ""} ${el.getAttribute?.("autocomplete") || ""}`;
        const hidden = String(el.getAttribute?.("type") || "").toLowerCase() === "hidden";
        const personal = /first.?name|surname|last.?name|email|phone|zip|postal|address|country/i.test(nameKey);
        const secret = hidden || NDRHLogic.diagnosticSensitiveKey(nameKey);
        const sensitiveValue = sensitivePage && personal;
        const label = el.labels?.[0]?.innerText?.trim()
          || el.closest?.("label")?.innerText?.trim()
          || el.getAttribute?.("aria-label")
          || "";
        let value = null;
        if (!secret && !sensitiveValue && "value" in el && el.tagName !== "BUTTON") {
          if (String(el.type || "").toLowerCase() === "checkbox" || String(el.type || "").toLowerCase() === "radio") {
            value = Boolean(el.checked);
          } else {
            value = redactDiagnosticText(el.value || "", secrets).slice(0, 300);
          }
        }
        return {
          i,
          tag: el.tagName,
          role: el.getAttribute?.("role") || "",
          type: el.getAttribute?.("type") || "",
          name: secret ? "[redacted]" : (el.getAttribute?.("name") || ""),
          id: el.id || "",
          label: redactDiagnosticText(label, secrets).slice(0, 240),
          ariaLabel: redactDiagnosticText(el.getAttribute?.("aria-label") || "", secrets),
          placeholder: personal ? "" : redactDiagnosticText(el.getAttribute?.("placeholder") || "", secrets),
          value: (secret || sensitiveValue) ? "[redacted]" : value,
          required: Boolean(el.required),
          disabled: Boolean(el.disabled),
          enabled: !Boolean(el.disabled),
          checked: "checked" in el ? Boolean(el.checked) : undefined,
          valid: typeof el.checkValidity === "function" ? Boolean(el.checkValidity()) : null,
          validationMessage: (secret || sensitiveValue) ? "" : redactDiagnosticText(el.validationMessage || "", secrets).slice(0, 240),
          text: redactDiagnosticText((el.tagName === "BUTTON" || el.tagName === "A" || el.getAttribute?.("role") === "button") ? (el.innerText || el.textContent || "").trim().slice(0, 180) : "", secrets)
        };
      });

    const excerpt = sensitivePage
      ? null
      : redactDiagnosticText(document.body?.innerText || "", secrets).slice(0, 7000);

    return {
      url: location.href,
      capturedAt: new Date().toISOString(),
      path,
      title: document.title,
      readyState: document.readyState,
      securityChallengeVisible: pageLooksLikeCloudflareChallenge(),
      workflowPage: currentWorkflowClassification(),
      helperOverlayText: redactDiagnosticText(overlay?.innerText || "", secrets).slice(0, 600),
      sensitivePage,
      excerptOmittedReason: sensitivePage ? "Page may contain reservation personal data; body text intentionally omitted." : null,
      controls,
      excerpt,
      collectionErrors
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "STATE_CHANGED") startLoop();
    if (message?.type === "RESUME_WORKFLOW") {
      startLoop();
      continueReservationFlow();
    }
    if (message?.type === "FILL_PERSONAL_DETAILS") fillPersonalDetails();
    if (message?.type === "VALIDATE_SESSION") validateSession();
    if (message?.type === "NDRH_DIAGNOSTIC") {
      diagnosticSnapshot()
        .then(diagnostic => sendResponse({ diagnostic }))
        .catch(error => sendResponse({ error: String(error?.message || error) }));
      return true;
    }
    return false;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.ndrhState?.newValue) {
      const previousShowInactive = state?.showInactive;
      state = changes.ndrhState.newValue;
      if (previousShowInactive !== state.showInactive) {
        setPageShowInactive(Boolean(state.showInactive));
      }
      if (!state.enabled) stopLoop();
      updateOverlay();
    }
  });

  startLoop();
  continueReservationFlow();
})();
