const $ = (id) => document.getElementById(id);

function releaseString(dateStr, timeStr, leadHours) {
  if (!dateStr || !timeStr) return "—";
  const dt = new Date(`${dateStr}T${timeStr}:00`);
  if (Number.isNaN(dt.getTime())) return "—";
  dt.setHours(dt.getHours() - Number(leadHours || 24));
  return dt.toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function getState() { return await chrome.runtime.sendMessage({ type: "GET_STATE" }); }
async function patchState(patch) { return await chrome.runtime.sendMessage({ type: "PATCH_STATE", patch }); }


const PROFILE_STORAGE_KEY = "ndrhProfiles";
const DEFAULT_PROFILE_STORAGE_KEY = "ndrhDefaultProfile";
async function getProfiles() {
  const stored = await chrome.storage.local.get(PROFILE_STORAGE_KEY);
  const raw = stored?.[PROFILE_STORAGE_KEY];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}
async function setProfiles(profiles) { await chrome.storage.local.set({ [PROFILE_STORAGE_KEY]: profiles || {} }); }
async function getDefaultProfile() {
  const stored = await chrome.storage.local.get(DEFAULT_PROFILE_STORAGE_KEY);
  return String(stored?.[DEFAULT_PROFILE_STORAGE_KEY] || "");
}
async function setDefaultProfileName(name) { await chrome.storage.local.set({ [DEFAULT_PROFILE_STORAGE_KEY]: String(name || "") }); }
function currentReusableConfiguration() {
  return NDRHLogic.buildProfile(formPatch(), personalDetailsPatch());
}
function setProfileMessage(message) { if ($("profileMessage")) $("profileMessage").textContent = message || ""; }
async function renderProfiles(selectedName = "") {
  const select = $("profileSelect"); if (!select) return;
  const profiles = await getProfiles(), previous = selectedName || select.value, defaultName = await getDefaultProfile();
  select.innerHTML = '<option value="">Choose a saved profile</option>';
  for (const name of Object.keys(profiles).sort((a,b)=>a.localeCompare(b))) {
    const option=document.createElement("option"); option.value=name; option.textContent=(name===defaultName ? `★ ${name}` : name); select.appendChild(option);
  }
  const desired = previous || defaultName;
  if (desired && Object.prototype.hasOwnProperty.call(profiles, desired)) select.value = desired;
}
async function saveProfile() {
  const proposed=$("profileSelect")?.value || "", name=window.prompt("Profile name", proposed); if (name==null) return;
  const trimmed=name.trim(); if (!trimmed) return setProfileMessage("Profile name cannot be empty."); if (trimmed.length>80) return setProfileMessage("Profile name must be 80 characters or fewer.");
  const profiles=await getProfiles();
  if (Object.prototype.hasOwnProperty.call(profiles, trimmed) && !window.confirm(`Replace saved profile "${trimmed}"?`)) return setProfileMessage("Profile was not changed.");
  profiles[trimmed]=currentReusableConfiguration(); await setProfiles(profiles); await renderProfiles(trimmed); setProfileMessage(`Saved "${trimmed}".`);
}
async function loadProfile() {
  const name=$("profileSelect")?.value || ""; if (!name) return setProfileMessage("Choose a profile to load.");
  const profiles=await getProfiles(), profile=profiles[name]; if (!profile) { setProfileMessage("Selected profile no longer exists."); return renderProfiles(); }
  const clean=NDRHLogic.normalizeProfile(profile, formPatch());
  const next=await patchState({
    ...clean.config,
    enabled: false,
    autoSelect: false,
    finalConfirmationAttempted: false,
    finalSubmissionAttempted: false,
    summaryVerification: null,
    workflowRequestedAutomationMode: clean.config.automationMode,
    workflowExpectedStage: null,
    workflowFailureCode: null,
    workflowFailureReason: null,
    workflowCanResume: false,
    workflowResumeHint: null,
    status: "Profile loaded — click Start watching when ready"
  });
  const planDetails = $("planDetails");
  if (planDetails) planDetails.dataset.loadedProfile = name;
  render(next);
  applyPersonalDetails(clean.personalDetails);
  await chrome.runtime.sendMessage({ type: "SET_PERSONAL_DETAILS", details: clean.personalDetails });
  setProfileMessage(`Loaded "${name}" including reservation personal details.`);
  await notifyActiveTab();
}

async function renameProfile() {
  const oldName=$("profileSelect")?.value || ""; if (!oldName) return setProfileMessage("Choose a profile to rename.");
  const proposed=window.prompt("New profile name", oldName); if (proposed==null) return;
  const newName=proposed.trim(); if(!newName) return setProfileMessage("Profile name cannot be empty."); if(newName.length>80) return setProfileMessage("Profile name must be 80 characters or fewer.");
  const profiles=await getProfiles(); if(!profiles[oldName]) return setProfileMessage("Selected profile no longer exists.");
  if(newName!==oldName && Object.prototype.hasOwnProperty.call(profiles,newName) && !window.confirm(`Replace saved profile "${newName}"?`)) return;
  profiles[newName]=profiles[oldName]; if(newName!==oldName) delete profiles[oldName];
  const defaultName=await getDefaultProfile(); if(defaultName===oldName) await setDefaultProfileName(newName);
  await setProfiles(profiles); await renderProfiles(newName); setProfileMessage(`Renamed to "${newName}".`);
}
async function duplicateProfile() {
  const source=$("profileSelect")?.value || ""; if(!source) return setProfileMessage("Choose a profile to duplicate.");
  const proposed=window.prompt("Duplicate profile as", `${source} copy`); if(proposed==null) return;
  const name=proposed.trim(); if(!name) return setProfileMessage("Profile name cannot be empty."); if(name.length>80) return setProfileMessage("Profile name must be 80 characters or fewer.");
  const profiles=await getProfiles(); if(!profiles[source]) return setProfileMessage("Selected profile no longer exists.");
  if(Object.prototype.hasOwnProperty.call(profiles,name) && !window.confirm(`Replace saved profile "${name}"?`)) return;
  profiles[name]=JSON.parse(JSON.stringify(profiles[source])); await setProfiles(profiles); await renderProfiles(name); setProfileMessage(`Duplicated as "${name}".`);
}
async function setDefaultProfile() {
  const name=$("profileSelect")?.value || ""; if(!name) return setProfileMessage("Choose a profile to make default.");
  await setDefaultProfileName(name); await renderProfiles(name); setProfileMessage(`"${name}" is now the default profile.`);
}

async function deleteProfile() {
  const name=$("profileSelect")?.value || ""; if (!name) return setProfileMessage("Choose a profile to delete."); if (!window.confirm(`Delete saved profile "${name}"?`)) return;
  const profiles=await getProfiles(); delete profiles[name]; await setProfiles(profiles); if((await getDefaultProfile())===name) await setDefaultProfileName(""); await renderProfiles(); setProfileMessage(`Deleted "${name}".`);
}
async function exportProfiles() {
  const profiles=await getProfiles(), capturedAt=new Date().toISOString(), payload=NDRHLogic.buildProfilesExport(profiles, await getDefaultProfile());
  downloadJson(NDRHLogic.profilesFilename(capturedAt), payload); setProfileMessage(`Exported ${Object.keys(payload.profiles).length} profile(s).`);
}
async function importProfilesFile(file) {
  if (!file) return; let payload;
  try { payload=JSON.parse(await file.text()); } catch (_) { return setProfileMessage("Import failed: file is not valid JSON."); }
  const parsed=NDRHLogic.parseProfilesImport(payload, formPatch()); if (!parsed.valid) return setProfileMessage(`Import failed: ${parsed.error}`);
  const current=await getProfiles(); const collisions=Object.keys(parsed.profiles).filter(name=>Object.prototype.hasOwnProperty.call(current,name)); let replaceNames=[];
  if (collisions.length) {
    const list=collisions.slice(0,8).map(name=>`"${name}"`).join(", "), extra=collisions.length>8?` and ${collisions.length-8} more`:"";
    const replace=window.confirm(`${collisions.length} imported profile(s) already exist: ${list}${extra}. Replace the same-named saved profiles? Choose Cancel to keep the existing versions and import only new names.`);
    if (replace) replaceNames=collisions;
  }
  const result=NDRHLogic.mergeProfiles(current, parsed.profiles, replaceNames); await setProfiles(result.profiles); if(parsed.defaultProfile && Object.prototype.hasOwnProperty.call(result.profiles, parsed.defaultProfile)) await setDefaultProfileName(parsed.defaultProfile); await renderProfiles();
  const parts=[]; if(result.added.length)parts.push(`${result.added.length} added`); if(result.replaced.length)parts.push(`${result.replaced.length} replaced`); if(result.skipped.length)parts.push(`${result.skipped.length} kept existing`); if(parsed.legacy)parts.push("legacy export accepted");
  setProfileMessage(`Import complete: ${parts.join(", ") || "no valid profiles found"}.`);
}



function downloadJson(name, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function popupControlSnapshot(secrets = []) {
  const sensitiveIds = new Set([
    "personalFirstName", "personalSurname", "personalEmail",
    "personalZipcode", "personalCountry", "personalPhone"
  ]);
  return Array.from(document.querySelectorAll("input, select, textarea, button"))
    .slice(0, 120)
    .map((el, i) => {
      const label = el.labels?.[0]?.innerText?.trim() || el.getAttribute("aria-label") || "";
      const sensitive = sensitiveIds.has(el.id) || NDRHLogic.diagnosticSensitiveKey(el.name || el.id || "");
      let value = null;
      if (!sensitive && !["password", "hidden"].includes(String(el.type || "").toLowerCase())) {
        if (el.type === "checkbox" || el.type === "radio") value = Boolean(el.checked);
        else value = NDRHLogic.redactDiagnosticText(el.value ?? "", secrets).slice(0, 300);
      }
      return {
        i,
        tag: el.tagName,
        id: el.id || "",
        name: el.name || "",
        type: el.type || "",
        label: NDRHLogic.redactDiagnosticText(label, secrets).slice(0, 240),
        value: sensitive ? "[redacted]" : value,
        required: Boolean(el.required),
        disabled: Boolean(el.disabled),
        enabled: !Boolean(el.disabled),
        valid: typeof el.checkValidity === "function" ? Boolean(el.checkValidity()) : null,
        validationMessage: sensitive ? "" : NDRHLogic.redactDiagnosticText(el.validationMessage || "", secrets).slice(0, 240)
      };
    });
}

async function captureDiagnostic() {
  const capturedAt = new Date().toISOString();
  const sourceErrors = [];
  let tab = null;
  let state = null;
  let personal = {};
  let page = null;

  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (error) {
    sourceErrors.push({ source: "activeTab", error: String(error?.message || error) });
  }

  try {
    state = await getState();
  } catch (error) {
    sourceErrors.push({ source: "helperState", error: String(error?.message || error) });
  }

  try {
    personal = await chrome.runtime.sendMessage({ type: "GET_PERSONAL_DETAILS" }) || {};
  } catch (error) {
    sourceErrors.push({ source: "temporaryPersonalDataPresence", error: String(error?.message || error) });
  }

  const secrets = Object.values(personal || {})
    .filter(value => typeof value === "string" && value.trim())
    .map(value => value.trim());

  if (tab?.id && String(tab.url || "").startsWith("https://resa.notredamedeparis.fr/")) {
    try {
      const reply = await chrome.tabs.sendMessage(tab.id, { type: "NDRH_DIAGNOSTIC" });
      if (reply?.diagnostic) page = reply.diagnostic;
      else sourceErrors.push({ source: "pageSnapshot", error: String(reply?.error || "No page diagnostic returned") });
    } catch (error) {
      sourceErrors.push({ source: "pageSnapshot", error: String(error?.message || error) });
    }
  } else {
    sourceErrors.push({ source: "pageSnapshot", error: "Active tab is not a Notre-Dame reservation page." });
  }

  let popupControls = [];
  try {
    popupControls = popupControlSnapshot(secrets);
  } catch (error) {
    sourceErrors.push({ source: "popupControls", error: String(error?.message || error) });
  }

  const recentLogs = Array.isArray(state?.logs) ? state.logs.slice(-120) : [];
  const providerApi = {
    provider: "Notre-Dame de Paris reservation",
    timeslotsEndpoint: "/script/timeslots",
    sessionStatus: state?.sessionStatus ?? null,
    sessionCheckedAt: state?.sessionCheckedAt ?? null,
    sessionHttpStatus: state?.sessionHttpStatus ?? null,
    lastCheck: state?.lastCheck ?? null,
    lastResult: state?.lastResult ?? null,
    lastTimeslotsDate: state?.lastTimeslotsDate ?? null,
    lastTimeslots: Array.isArray(state?.lastTimeslots) ? state.lastTimeslots.slice(0, 120) : []
  };

  const diagnostic = NDRHLogic.buildDiagnosticPayload({
    extensionVersion: chrome.runtime.getManifest().version,
    capturedAt,
    tab: tab ? {
      url: tab.url || "",
      title: tab.title || "",
      incognito: Boolean(tab.incognito),
      status: tab.status || null
    } : null,
    operation: {
      status: state?.status ?? null,
      enabled: Boolean(state?.enabled),
      mode: state?.mode ?? null,
      automationMode: state?.automationMode ?? null,
      targetDate: state?.targetDate ?? null,
      targetTime: state?.targetTime ?? null,
      rangeStart: state?.rangeStart ?? null,
      rangeEnd: state?.rangeEnd ?? null,
      visitors: state?.visitors ?? null,
      pacing: {
        pageSettleSeconds: state?.pageSettleSeconds ?? 2.5,
        actionPauseSeconds: state?.actionPauseSeconds ?? 1.2,
        lastAutomationAction: state?.lastAutomationAction ?? null,
        lastAutomationActionAt: state?.lastAutomationActionAt ?? null,
        previousAutomationActionGapMs: state?.previousAutomationActionGapMs ?? null,
        lastProviderRequestAt: state?.lastProviderRequestAt ?? null,
        previousProviderRequestGapMs: state?.previousProviderRequestGapMs ?? null,
        lastProviderRequestOutcome: state?.lastProviderRequestOutcome ?? null
      },
      workflow: {
        stage: state?.workflowStage ?? null,
        expectedStage: state?.workflowExpectedStage ?? null,
        requestedAutomationMode: state?.workflowRequestedAutomationMode ?? null,
        lastTransitionAt: state?.workflowLastTransitionAt ?? null,
        lastUrl: state?.workflowLastUrl ?? null,
        failureCode: state?.workflowFailureCode ?? null,
        failureReason: state?.workflowFailureReason ?? null,
        canResume: Boolean(state?.workflowCanResume),
        resumeHint: state?.workflowResumeHint ?? null,
        bookingOutcome: state?.bookingOutcome ?? null,
        bookingOutcomeEvidence: state?.bookingOutcomeEvidence ?? null
      },
      recentActivity: recentLogs
    },
    providerApi,
    helperState: state,
    popupControls,
    temporaryPersonalData: {
      valuesIncluded: false,
      fieldsPresent: {
        firstName: Boolean(personal?.firstName),
        surname: Boolean(personal?.surname),
        emailAddress: Boolean(personal?.emailAddress),
        zipcode: Boolean(personal?.zipcode),
        country: Boolean(personal?.country),
        phoneNumber: Boolean(personal?.phoneNumber)
      }
    },
    page,
    sourceErrors,
    privacy: {
      sentExternally: false,
      excludes: ["passwords", "tokens", "cookies", "payment data", "stored personal-detail values"]
    }
  }, secrets);

  try {
    downloadJson(NDRHLogic.diagnosticFilename(capturedAt), diagnostic);
    $("status").textContent = sourceErrors.length ? "Diagnostic downloaded (partial)" : "Diagnostic downloaded";
  } catch (error) {
    $("status").textContent = `Diagnostic download failed: ${String(error?.message || error)}`;
  }
}

const personalFieldIds = [
  "personalFirstName", "personalSurname", "personalEmail",
  "personalZipcode", "personalCountry", "personalPhone"
];
const siteCountryCodes = "NL,DE,BE,FR,PL,GB,US,AF,AX,AL,DZ,AS,AD,AO,AI,AQ,AG,AR,AM,AW,AU,AT,AZ,BS,BH,BD,BB,BY,BZ,BJ,BM,BT,BO,BQ,BA,BW,BV,BR,IO,BN,BG,BF,BI,KH,CM,CA,CV,KY,CF,TD,CL,CN,CX,CC,CO,KM,CG,CD,CK,CR,CI,HR,CU,CW,CY,CZ,DK,DJ,DM,DO,TL,EC,EG,SV,GQ,ER,EE,ET,FK,FO,FJ,FI,GF,PF,TF,GA,GM,GE,GH,GI,GR,GL,GD,GP,GU,GT,GG,GN,GW,GY,HT,HM,HN,HK,HU,IS,IN,ID,IR,IQ,IE,IM,IL,IT,JM,JP,JE,JO,KZ,KE,KI,KP,KR,KO,KW,KG,LA,LV,LB,LS,LR,LY,LI,LT,LU,MO,MK,MG,MW,MY,MV,ML,MT,MH,MQ,MR,MU,YT,MX,FM,MD,MC,MN,ME,MS,MA,MZ,MM,NA,NR,NP,NC,NZ,NI,NE,NG,NU,NF,MP,NO,OM,PK,PW,PS,PA,PG,PY,PE,PH,PN,PT,PR,QA,RE,RO,RU,RW,BL,SH,MF,PM,WS,SM,ST,SA,SN,RS,SC,SL,SG,SX,SK,SI,SB,SO,ZA,GS,SS,ES,LK,KN,LC,VC,SD,SR,SJ,SZ,SE,CH,SY,TW,TJ,TZ,TH,TG,TK,TO,TT,TN,TR,TM,TC,TV,UG,UA,AE,UM,UY,UZ,VU,VA,VE,VN,VG,VI,WF,EH,YE,ZM,ZW".split(",");
const countryNameOverrides = { KO: "Kosovo" };

function populateCountryOptions() {
  const select = $("personalCountry");
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  for (const code of siteCountryCodes) {
    const option = document.createElement("option");
    option.value = code;
    try { option.textContent = countryNameOverrides[code] || names.of(code) || code; }
    catch (_) { option.textContent = code; }
    select.appendChild(option);
  }
}

function personalDetailsPatch() {
  return {
    firstName: $("personalFirstName").value.trim(),
    surname: $("personalSurname").value.trim(),
    emailAddress: $("personalEmail").value.trim(),
    zipcode: $("personalZipcode").value.trim(),
    country: $("personalCountry").value.trim(),
    phoneNumber: $("personalPhone").value.trim()
  };
}

const personalFieldByDetail = {
  firstName: "personalFirstName",
  surname: "personalSurname",
  emailAddress: "personalEmail",
  zipcode: "personalZipcode",
  country: "personalCountry",
  phoneNumber: "personalPhone"
};

function displayPersonalValidation(validation) {
  const invalidFields = new Set((validation?.issues || []).map(issue => issue.field));
  for (const [detailField, popupField] of Object.entries(personalFieldByDetail)) {
    $(popupField).toggleAttribute("aria-invalid", invalidFields.has(detailField));
  }
}

async function validatePersonalDetailsForAutomation() {
  await savePersonalDetails();
  const details = await chrome.runtime.sendMessage({ type: "GET_PERSONAL_DETAILS" });
  const validation = NDRHLogic.validatePersonalDetails(details, siteCountryCodes);
  displayPersonalValidation(validation);
  return validation;
}

async function savePersonalDetails() {
  await chrome.runtime.sendMessage({ type: "SET_PERSONAL_DETAILS", details: personalDetailsPatch() });
}

function applyPersonalDetails(details = {}) {
  $("personalFirstName").value = details.firstName || "";
  $("personalSurname").value = details.surname || "";
  $("personalEmail").value = details.emailAddress || "";
  $("personalZipcode").value = details.zipcode || "";
  $("personalCountry").value = details.country || "";
  $("personalPhone").value = details.phoneNumber || "";
}

async function renderPersonalDetails() {
  const details = await chrome.runtime.sendMessage({ type: "GET_PERSONAL_DETAILS" });
  applyPersonalDetails(details);
}

function formPatch() {
  return {
    targetDate: $("targetDate").value,
    targetTime: $("targetTime").value,
    visitors: Number($("visitors").value),
    mode: $("mode").value,
    rangeStart: $("rangeStart").value,
    rangeEnd: $("rangeEnd").value,
    releaseLeadHours: Number($("releaseLeadHours").value),
    pollSeconds: Number($("pollSeconds").value),
    releaseBoundaryMode: $("releaseBoundaryMode")?.checked || false,
    pageSettleSeconds: Number($("pageSettleSeconds")?.value || 2.5),
    actionPauseSeconds: Number($("actionPauseSeconds")?.value || 1.2),
    automationMode: $("automationMode").value,
    // autoSelect remains the compatibility switch used by the content script.
    autoSelect: NDRHLogic.automationUsesReservationFlow($("automationMode").value),
    testMode: $("testMode")?.checked || false,
    testFixture: $("testFixture")?.value || "available",
    showInactive: $("showInactive").checked
  };
}

function refreshMode() {
  $("exactFields").classList.toggle("hidden", $("mode").value !== "exact");
  $("rangeFields").classList.toggle("hidden", $("mode").value !== "range");
}

function refreshBoundaryMode() {
  const armed = Boolean($("releaseBoundaryMode")?.checked);
  if ($("pollSeconds")) $("pollSeconds").disabled = armed;
  if ($("nextBoundaryRow")) $("nextBoundaryRow").classList.toggle("hidden", !armed);
}

function refreshAutomationNote() {
  const mode = NDRHLogic.normalizeAutomationMode($("automationMode").value);
  const note = $("automationNote");
  const select = $("automationMode");
  note.classList.toggle("test-armed", mode === "test");
  note.classList.toggle("booking-armed", mode === "booking");
  select.classList.toggle("booking-armed", mode === "booking");

  if (mode === "booking") {
    note.innerHTML =
      "<strong>BOOKING AUTOMATION:</strong> when a matching slot is found, the helper will " +
      "continue through the reservation flow and submit final confirmation only after " +
      "verifying the selected date, time and visitor count on Summary. Any mismatch or " +
      "ambiguous confirmation control stops the flow.";
  } else if (mode === "test") {
    note.innerHTML =
      "<strong>TEST AUTOMATION:</strong> follows the same reservation flow as Booking, " +
      "but stops on Summary before final confirmation.";
  } else {
    note.innerHTML =
      "Use <strong>Watch only</strong> for detection only; it never enters the reservation flow.";
  }
}

function refreshRelease() {
  const mode = $("mode").value;
  const time = mode === "exact" ? $("targetTime").value : mode === "range" ? $("rangeStart").value : "";
  $("releaseAt").textContent = time ? releaseString($("targetDate").value, time, $("releaseLeadHours").value) : "—";
}

function movePopupNode(node, destination) {
  if (node && destination) destination.appendChild(node);
}

function organizePopup() {
  const main = document.querySelector("main");
  if (!main || $("ndrhWorkspace")) return;
  const workspace = document.createElement("div");
  workspace.id = "ndrhWorkspace";
  workspace.innerHTML = `
    <section class="run-card" aria-labelledby="runHeading">
      <div class="section-heading"><div><span class="eyebrow">Reservation run</span><h2 id="runHeading">Ready to watch</h2></div><span id="runStatePill" class="state-pill">Idle</span></div>
      <div id="runSummary" class="run-summary">Choose a visit plan, then start watching.</div>
      <div id="availabilityAlert" class="availability-alert hidden" role="status"></div>
      <div id="runStatusSlot"></div><div id="runActionSlot"></div>
    </section>
    <details id="planDetails" class="workspace-section plan-section" open>
      <summary><span><strong>Plan</strong><small id="planSummary">Choose a visit date</small></span><span class="summary-action">Edit</span></summary>
      <div class="section-body"><div id="planProfileSlot"></div><div id="planFieldsSlot"></div><div id="automationSlot"></div></div>
    </details>
    <details id="advancedDetails" class="workspace-section"><summary><span><strong>Monitoring options</strong><small>Polling, release timing, and pacing</small></span></summary><div id="advancedSlot" class="section-body"></div></details>
    <details id="supportDetails" class="workspace-section"><summary><span><strong>Support & diagnostics</strong><small>Session checks, logs, tests, and raw data</small></span></summary><div id="supportSlot" class="section-body"></div></details>`;
  main.appendChild(workspace);
  const plan = $("planFieldsSlot"), advanced = $("advancedSlot"), support = $("supportSlot"), runStatus = $("runStatusSlot"), runActions = $("runActionSlot"), automation = $("automationSlot");
  movePopupNode(document.querySelector(".profiles"), $("planProfileSlot"));
  [$("targetDate")?.closest("label"), $("mode")?.closest("label"), $("exactFields"), $("rangeFields"), $("visitors")?.closest("label")].forEach(node => movePopupNode(node, plan));
  [$("releaseLeadHours")?.closest(".grid"), document.querySelector(".pacing-controls"), document.querySelector(".pacing-note"), $("releaseBoundaryMode")?.closest("label"), document.querySelector(".release-boundary-note"), $("nextBoundaryRow")].forEach(node => movePopupNode(node, advanced));
  [$("automationMode")?.closest("label"), $("automationNote"), document.querySelector(".personal-details")].forEach(node => movePopupNode(node, automation));
  [document.querySelector(".release:not(#nextBoundaryRow)"), document.querySelector(".status"), $("sessionBox"), $("validateSession"), document.querySelector(".actions"), $("workflowHint")].forEach(node => movePopupNode(node, runStatus));
  [$("start"), $("openSite"), $("stop"), $("resumeAutomation")].forEach(node => movePopupNode(node, runActions));
  [$("downloadDiagnostic"), $("showInactive")?.closest("label"), $("testMode")?.closest("label"), $("testFixtureRow"), $("testModeNote"), $("runTests"), $("slotTable")?.closest("details"), $("log")?.closest("details"), main.querySelector("p.note:last-of-type")].forEach(node => movePopupNode(node, support));
}

function refreshTestMode() {
  const enabled = Boolean($("testMode")?.checked);
  $("testFixtureRow")?.classList.toggle("hidden", !enabled);
  $("testModeNote")?.classList.toggle("hidden", !enabled);
}

function refreshPlanDisclosure(state) {
  const plan = $("planDetails");
  if (!plan) return;
  const profile = plan.dataset.loadedProfile || "";
  const date = state?.targetDate || $("targetDate")?.value || "";
  const mode = state?.mode || $("mode")?.value || "exact";
  const time = mode === "exact" ? (state?.targetTime || $("targetTime")?.value) : mode === "range" ? `${state?.rangeStart || $("rangeStart")?.value}–${state?.rangeEnd || $("rangeEnd")?.value}` : "any time";
  const ready = Boolean(profile || date);
  if (!plan.dataset.disclosureInitialized) {
    plan.open = !ready;
    plan.dataset.disclosureInitialized = "true";
  }
  const label = profile ? profile.replace(/^★\s*/, "") : date ? `${date} · ${time}` : "Choose a visit date";
  $("planSummary").textContent = label;
}

function refreshRunConsole(state) {
  const status = state?.status || "Idle";
  if ($("runStatePill")) {
    $("runStatePill").textContent = state?.enabled ? "Watching" : status.includes("AVAILABLE") ? "Available" : "Idle";
    $("runStatePill").className = `state-pill ${state?.enabled ? "active" : status.includes("AVAILABLE") ? "available" : ""}`;
  }
  if ($("runSummary")) {
    const date = state?.targetDate || "No date selected";
    const mode = state?.mode === "range" ? `${state.rangeStart}–${state.rangeEnd}` : state?.mode === "any" ? "Any available time" : state?.targetTime || "Exact time";
    const automation = NDRHLogic.normalizeAutomationMode(state?.automationMode, state?.autoSelect);
    const flow = automation === "booking" ? "Booking → Complete" : automation === "test" ? "Test → Complete (stops)" : "Watch only";
    $("runSummary").textContent = `${date} · ${mode} · ${state?.visitors || 2} visitor(s) · ${flow}`;
  }
  if ($("availabilityAlert")) {
    const alert = state?.availabilityAlert;
    $("availabilityAlert").classList.toggle("hidden", !alert);
    $("availabilityAlert").textContent = alert ? `New matching availability · ${alert.message}` : "";
  }
}

function render(state) {
  $("targetDate").value = state.targetDate || "";
  $("targetTime").value = state.targetTime || "14:00";
  $("visitors").value = String(state.visitors || 2);
  $("mode").value = state.mode || "exact";
  $("rangeStart").value = state.rangeStart || "13:00";
  $("rangeEnd").value = state.rangeEnd || "16:30";
  $("releaseLeadHours").value = String(state.releaseLeadHours || 24);
  const allowedPollSeconds = [15, 30, 60, 120, 300, 900];
  const savedPollSeconds = Number(state.pollSeconds);
  $("pollSeconds").value = String(
    allowedPollSeconds.includes(savedPollSeconds) ? savedPollSeconds : 15
  );
  // Safety migration: the former "continue" automation always becomes TEST.
  // No existing setting is ever migrated into Booking automation.
  $("automationMode").value = NDRHLogic.normalizeAutomationMode(
    state.automationMode,
    state.autoSelect
  );
  if ($("testMode")) $("testMode").checked = Boolean(state.testMode);
  if ($("testFixture")) $("testFixture").value = state.testFixture || "available";
  $("showInactive").checked = Boolean(state.showInactive);
  if ($("releaseBoundaryMode")) $("releaseBoundaryMode").checked = Boolean(state.releaseBoundaryMode);
  if ($("pageSettleSeconds")) $("pageSettleSeconds").value = String(NDRHLogic.sanitizeProfileConfig(state).pageSettleSeconds);
  if ($("actionPauseSeconds")) $("actionPauseSeconds").value = String(NDRHLogic.sanitizeProfileConfig(state).actionPauseSeconds);
  $("status").textContent = state.status || "Idle";
  if ($("resumeAutomation")) {
    $("resumeAutomation").disabled = !state.workflowCanResume;
    $("resumeAutomation").title = state.workflowResumeHint || "No resumable automation state";
  }
  if ($("workflowHint")) {
    const bits = [];
    if (state.workflowStage && state.workflowStage !== "idle" && state.workflowStage !== "unknown") bits.push(`Stage: ${state.workflowStage}`);
    if (state.bookingOutcome) bits.push(`Outcome: ${state.bookingOutcome}`);
    if (state.workflowCanResume && state.workflowResumeHint) bits.push(state.workflowResumeHint);
    $("workflowHint").textContent = bits.join(" · ");
  }
  if ($("nextReleaseCheckAt")) {
    $("nextReleaseCheckAt").textContent = state.nextReleaseCheckAt
      ? new Date(state.nextReleaseCheckAt).toLocaleTimeString([], {
          hour: "2-digit", minute: "2-digit", second: "2-digit"
        })
      : "—";
  }

  if ($("sessionStatus")) {
    const session = state.sessionStatus || "unknown";
    const labels = {
      valid: "Valid ✓",
      expired: "Rejected (403)",
      verifying: "Verifying…",
      "page-context": "Page context",
      error: "Check failed",
      unknown: "Unknown"
    };
    $("sessionStatus").textContent = labels[session] || session;
    $("sessionBox").classList.toggle("valid", session === "valid");
    $("sessionBox").classList.toggle("expired", session === "expired");
    const checked = state.sessionCheckedAt
      ? new Date(state.sessionCheckedAt).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"})
      : null;
    $("sessionDetail").textContent =
      session === "expired"
        ? "HTTP 403 — security rejected the request; reload Notre-Dame and revalidate."
        : session === "page-context"
          ? "No extra validation request used; the next required site/API action will provide session evidence."
          : checked
            ? `Last checked ${checked}${state.sessionHttpStatus ? ` · HTTP ${state.sessionHttpStatus}` : ""}`
            : "Not checked yet";
  }

  refreshMode();
  refreshBoundaryMode();
  refreshAutomationNote();
  refreshTestMode();
  refreshRelease();
  refreshPlanDisclosure(state);
  refreshRunConsole(state);

  $("diagnosticDate").textContent = state.lastTimeslotsDate ? `— ${state.lastTimeslotsDate}` : "";
  const slots = state.lastTimeslots || [];
  const rows = $("slotRows");
  rows.innerHTML = "";
  if (!slots.length) {
    rows.innerHTML = '<tr><td colspan="6">No API data yet.</td></tr>';
  } else {
    for (const slot of slots) {
      const tr = document.createElement("tr");
      if (slot.active) tr.classList.add("slot-active");
      tr.innerHTML = `
        <td>${slot.time}</td>
        <td>${slot.active ? "✓" : ""}</td>
        <td>${slot.soldOut ? "✓" : ""}</td>
        <td>${slot.expired ? "✓" : ""}</td>
        <td>${slot.totalAvailable ?? ""}</td>
        <td>${slot.classAttr || ""}</td>`;
      rows.appendChild(tr);
    }
  }

  const logs = (state.logs || []).slice(-30).reverse();
  $("log").textContent = logs.length ? logs.map(x => `[${x.at}] ${x.message}`).join("\n") : "No checks yet.";
}

async function notifyActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try { await chrome.tabs.sendMessage(tab.id, { type: "STATE_CHANGED" }); } catch (_) {}
}

const planControlIds = new Set(["targetDate", "targetTime", "visitors", "mode", "rangeStart", "rangeEnd", "automationMode", "testMode", "testFixture"]);
["targetDate","targetTime","visitors","mode","rangeStart","rangeEnd","releaseLeadHours","pollSeconds","releaseBoundaryMode","pageSettleSeconds","actionPauseSeconds","automationMode","showInactive","testMode","testFixture"].forEach(id => {
  $(id).addEventListener("change", async () => {
    const next = planControlIds.has(id)
      ? await patchState({
          ...formPatch(),
          enabled: false,
          autoSelect: false,
          finalConfirmationAttempted: false,
          finalSubmissionAttempted: false,
          summaryVerification: null,
          workflowRequestedAutomationMode: formPatch().automationMode,
          workflowExpectedStage: null,
          workflowFailureCode: null,
          workflowFailureReason: null,
          workflowCanResume: false,
          workflowResumeHint: null,
          status: "Plan changed — click Start watching to retry"
        })
      : await patchState(formPatch());
    render(next);
    refreshMode();
    refreshAutomationNote();
    refreshTestMode();
    refreshRelease();
    await notifyActiveTab();
  });
});

$("start").addEventListener("click", async () => {
  const form = formPatch();
  if (!form.testMode && NDRHLogic.automationUsesReservationFlow(form.automationMode)) {
    const validation = await validatePersonalDetailsForAutomation();
    if (!validation.valid) {
      document.querySelector(".personal-details").open = true;
      const labels = validation.issues.map(issue => issue.label).join(", ");
      const next = await patchState({
        ...form,
        enabled: false,
        status: `Personal details required: ${labels}`
      });
      render(next);
      return;
    }
  }

  const normalizedAutomation = NDRHLogic.normalizeAutomationMode(form.automationMode);
  const startStatus = form.testMode
    ? `LOCAL TEST · ${form.testFixture || "available"} scenario`
    : form.releaseBoundaryMode
    ? normalizedAutomation === "booking" ? "BOOKING ARMED — waiting for release boundary"
      : normalizedAutomation === "test" ? "TEST ARMED — waiting for release boundary"
      : "ARMED — waiting for release boundary"
    : normalizedAutomation === "booking" ? "BOOKING ARMED — watching"
      : normalizedAutomation === "test" ? "TEST AUTOMATION — watching"
      : "Watching";

  const next = await patchState({
    ...form,
    automationMode: normalizedAutomation,
    // Fixture runs exercise monitoring state only. They never fill, click, or
    // navigate Notre-Dame, even if the user selected an automation mode.
    autoSelect: form.testMode ? false : NDRHLogic.automationUsesReservationFlow(normalizedAutomation),
    enabled: true,
    status: startStatus,
    lastAvailabilityKey: null,
    availabilityAlert: null,
    automationSelectedDate: null,
    automationSelectedTime: null,
    automationSelectedVisitors: null,
    finalConfirmationAttempted: false,
    finalSubmissionAttempted: false,
    summaryVerification: null,
    workflowRequestedAutomationMode: formPatch().automationMode,
    workflowExpectedStage: null,
    workflowFailureCode: null,
    workflowFailureReason: null,
    workflowCanResume: false,
    workflowResumeHint: null,
    bookingOutcome: null,
    bookingOutcomeEvidence: null,
    pinnedMonitor: true,
    nextReleaseCheckAt: null,
    boundaryHandoffCheckPending: false,
    lastResult: null
  });
  render(next);
  await notifyActiveTab();
});

$("stop").addEventListener("click", async () => {
  const next = await patchState({ enabled: false, status: "Stopped", nextReleaseCheckAt: null, boundaryHandoffCheckPending: false });
  render(next);
  await notifyActiveTab();
});


$("resumeAutomation")?.addEventListener("click", async () => {
  const current = await getState();
  if (!current.workflowCanResume) return;
  const mode = NDRHLogic.normalizeAutomationMode(current.workflowRequestedAutomationMode);
  if (mode === "watch") return;
  const next = await patchState({
    enabled: true,
    automationMode: mode,
    autoSelect: true,
    workflowExpectedStage: null,
    finalSubmissionAttempted: false,
    workflowFailureCode: null,
    workflowFailureReason: null,
    workflowCanResume: false,
    workflowResumeHint: null,
    status: `Resuming ${mode} automation`
  });
  render(next);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    try { await chrome.tabs.sendMessage(tab.id, { type: "RESUME_WORKFLOW" }); } catch (_) {}
  }
});

$("openSite").addEventListener("click", async () => {
  await chrome.tabs.create({ url: "https://resa.notredamedeparis.fr/en/reservationindividuelle/tickets" });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.ndrhState?.newValue) render(changes.ndrhState.newValue);
});

organizePopup();
getState().then(render);
populateCountryOptions();
renderPersonalDetails();

personalFieldIds.forEach(id => {
  const saveAndClearInvalid = () => {
    savePersonalDetails();
    $(id).removeAttribute("aria-invalid");
  };
  $(id).addEventListener("input", saveAndClearInvalid);
  $(id).addEventListener("change", saveAndClearInvalid);
});

$("fillPersonalDetails").addEventListener("click", async () => {
  await savePersonalDetails();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "FILL_PERSONAL_DETAILS" });
      personalFieldIds.forEach(id => { $(id).value = ""; });
    } catch (_) {}
  }
});

$("clearPersonalDetails").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "CLEAR_PERSONAL_DETAILS" });
  personalFieldIds.forEach(id => { $(id).value = ""; });
});



const profileSelect = $("profileSelect");
if (profileSelect) profileSelect.addEventListener("change", () => {
  setProfileMessage("");
  if ($("planDetails")) delete $("planDetails").dataset.loadedProfile;
  refreshPlanDisclosure();
});
$("saveProfile")?.addEventListener("click", saveProfile);
$("loadProfile")?.addEventListener("click", loadProfile);
$("renameProfile")?.addEventListener("click", renameProfile);
$("duplicateProfile")?.addEventListener("click", duplicateProfile);
$("setDefaultProfile")?.addEventListener("click", setDefaultProfile);
$("deleteProfile")?.addEventListener("click", deleteProfile);
$("exportProfiles")?.addEventListener("click", exportProfiles);
$("importProfiles")?.addEventListener("click", () => $("importProfilesFile")?.click());
$("importProfilesFile")?.addEventListener("change", async (event) => {
  const file=event.target.files?.[0];
  try { await importProfilesFile(file); } finally { event.target.value=""; }
});
renderProfiles();

const diagnosticButton = document.getElementById("downloadDiagnostic");
if (diagnosticButton) {
  diagnosticButton.addEventListener("click", captureDiagnostic);
}

const runTestsButton = document.getElementById("runTests");
if (runTestsButton) {
  runTestsButton.addEventListener("click", async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL("tests/index.html") });
  });
}


const validateSessionButton = document.getElementById("validateSession");
if (validateSessionButton) {
  validateSessionButton.addEventListener("click", async () => {
    await patchState({ ...formPatch(), status: "Checking session…" });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !String(tab.url || "").startsWith("https://resa.notredamedeparis.fr/")) {
      await patchState({ sessionStatus: "unknown", status: "Open Notre-Dame first" });
      await chrome.tabs.create({ url: "https://resa.notredamedeparis.fr/en/reservationindividuelle/tickets" });
      return;
    }
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "VALIDATE_SESSION" });
    } catch (_) {
      await patchState({ sessionStatus: "unknown", status: "Reload Notre-Dame page" });
    }
  });
}
