const DEFAULT_STATE = {
  targetDate: "",
  targetTime: "14:00",
  visitors: 2,
  mode: "exact",
  rangeStart: "13:00",
  rangeEnd: "16:30",
  enabled: false,
  autoSelect: false,
  testMode: false,
  testFixture: "available",
  automationMode: "watch",
  automationSelectedDate: null,
  automationSelectedTime: null,
  automationSelectedVisitors: null,
  finalConfirmationAttempted: false,
  finalSubmissionAttempted: false,
  summaryVerification: null,
  showInactive: false,
  releaseLeadHours: 24,
  pollSeconds: 15,
  releaseBoundaryMode: false,
  boundaryOffsetSeconds: 2,
  nextReleaseCheckAt: null,
  boundaryHandoffCheckPending: false,
  pageSettleSeconds: 2.5,
  actionPauseSeconds: 1.2,
  workflowStage: "idle",
  workflowExpectedStage: null,
  workflowRequestedAutomationMode: "watch",
  workflowLastTransitionAt: null,
  workflowLastUrl: null,
  workflowFailureCode: null,
  workflowFailureReason: null,
  workflowCanResume: false,
  workflowResumeHint: null,
  bookingOutcome: null,
  bookingOutcomeEvidence: null,
  pinnedMonitor: false,
  status: "Idle",
  sessionStatus: "unknown",
  sessionCheckedAt: null,
  sessionHttpStatus: null,
  lastCheck: null,
  lastResult: null,
  lastAvailabilityKey: null,
  availabilityAlert: null,
  lastTimeslotsDate: null,
  lastTimeslots: [],
  logs: []
};

// The toolbar icon opens the persistent side panel. Unlike an action popup,
// the panel remains available while the reservation site navigates between steps.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.sidePanel.setOptions({ path: "popup.html", enabled: false }).catch(() => {});

const NOTRE_DAME_RESERVATION_ORIGIN = "https://resa.notredamedeparis.fr";

async function configureSidePanelForTab(tabId, url) {
  const enabled = typeof url === "string" && url.startsWith(NOTRE_DAME_RESERVATION_ORIGIN + "/");
  await Promise.all([
    chrome.sidePanel.setOptions({
      tabId,
      path: "popup.html",
      enabled
    }),
    // On Notre-Dame, the action opens the persistent panel. Everywhere else
    // it remains a small launcher popup so the user can open the site first.
    chrome.action.setPopup({ tabId, popup: enabled ? "" : "popup.html" })
  ]);
}

// Keep the panel available only where this helper can act. Chrome hides it on
// unrelated tabs instead of carrying the reservation UI through all browsing.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || (changeInfo.status === "complete" ? tab.url : null);
  if (url) configureSidePanelForTab(tabId, url).catch(() => {});
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId)
    .then(tab => configureSidePanelForTab(tabId, tab.url))
    .catch(() => {});
});

chrome.tabs.query({}).then(tabs => {
  for (const tab of tabs) configureSidePanelForTab(tab.id, tab.url).catch(() => {});
}).catch(() => {});

chrome.runtime.onInstalled.addListener(async () => {
  const { ndrhState } = await chrome.storage.local.get("ndrhState");
  await chrome.storage.local.set({ ndrhState: { ...DEFAULT_STATE, ...(ndrhState || {}) } });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_PERSONAL_DETAILS") {
    chrome.storage.session.get("ndrhPersonalDetails").then(({ ndrhPersonalDetails }) => {
      sendResponse(ndrhPersonalDetails || {});
    });
    return true;
  }

  if (message?.type === "SET_PERSONAL_DETAILS") {
    chrome.storage.session.set({ ndrhPersonalDetails: message.details || {} }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === "CLEAR_PERSONAL_DETAILS") {
    chrome.storage.session.remove("ndrhPersonalDetails").then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === "GET_STATE") {
    chrome.storage.local.get("ndrhState").then(({ ndrhState }) => {
      sendResponse({ ...DEFAULT_STATE, ...(ndrhState || {}) });
    });
    return true;
  }

  if (message?.type === "PATCH_STATE") {
    chrome.storage.local.get("ndrhState").then(async ({ ndrhState }) => {
      const next = { ...DEFAULT_STATE, ...(ndrhState || {}), ...(message.patch || {}) };
      await chrome.storage.local.set({ ndrhState: next });
      sendResponse(next);
    });
    return true;
  }

  if (message?.type === "LOG") {
    chrome.storage.local.get("ndrhState").then(async ({ ndrhState }) => {
      const state = { ...DEFAULT_STATE, ...(ndrhState || {}) };
      const logs = [...(state.logs || []), message.entry].slice(-500);
      await chrome.storage.local.set({ ndrhState: { ...state, logs } });
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === "UNPIN_MONITOR") {
    chrome.storage.local.get("ndrhState").then(async ({ ndrhState }) => {
      const next = { ...DEFAULT_STATE, ...(ndrhState || {}), pinnedMonitor: false };
      await chrome.storage.local.set({ ndrhState: next });
      sendResponse({ ok: true });
    });
    return true;
  }
});
