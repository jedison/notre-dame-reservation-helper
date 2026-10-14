(function (global) {
  const NDRHLogic = {
    isSlotAvailable(slot) {
      return !!slot && slot.active === true;
    },

    availabilityTransition(previousKey = "", result = {}) {
      if (result?.kind !== "available") return null;
      // A matching result may gain/lose diagnostic details while it remains
      // available. Alert only when availability itself has newly appeared.
      if (String(previousKey || "").startsWith("available|")) return null;
      return {
        kind: "new-availability",
        message: String(result.message || "Matching availability found")
      };
    },

    localTestResponse(scenario = "available", config = {}, step = 0) {
      const allowed = ["available", "unavailable", "opens", "session-expired", "api-error"];
      const selected = allowed.includes(scenario) ? scenario : "available";
      const time = this.normalizeTime(config?.targetTime) || "13:15";
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(config?.targetDate || ""))
        ? String(config.targetDate)
        : "2026-08-17";
      if (selected === "session-expired") {
        return { ok: false, status: 403, data: null, error: "Local fixture: session rejected (403)" };
      }
      if (selected === "api-error") {
        return { ok: false, status: 500, data: null, error: "Local fixture: API error (500)" };
      }
      const active = selected === "available" || (selected === "opens" && Number(step) > 0);
      return {
        ok: true,
        status: 200,
        data: {
          success: true,
          date,
          timeslots: {
            [time]: {
              active,
              soldOut: !active,
              expired: false,
              time,
              title: time,
              totalAvailable: active ? 2 : 0,
              classAttr: active ? "" : "timeslotFull"
            }
          }
        }
      };
    },

    normalizeTime(time) {
      const m = String(time || "").match(/^(\d{1,2}):([0-5]\d)$/);
      if (!m) return null;
      const h = Number(m[1]);
      if (h < 0 || h > 23) return null;
      return `${String(h).padStart(2, "0")}:${m[2]}`;
    },

    timeToMinutes(time) {
      const n = this.normalizeTime(time);
      if (!n) return null;
      const [h, m] = n.split(":").map(Number);
      return h * 60 + m;
    },

    filterTimeslots(timeslots, mode, targetTime, rangeStart, rangeEnd) {
      const entries = Object.values(timeslots || {});
      const available = entries.filter(slot => this.isSlotAvailable(slot));

      if (mode === "any") return available;

      if (mode === "range") {
        const start = this.timeToMinutes(rangeStart);
        const end = this.timeToMinutes(rangeEnd);
        if (start == null || end == null) return [];
        return available.filter(slot => {
          const t = this.timeToMinutes(slot.time);
          return t != null && t >= start && t <= end;
        });
      }

      const target = this.normalizeTime(targetTime);
      if (!target) return [];
      return available.filter(slot => this.normalizeTime(slot.time) === target);
    },

    expectedReleaseDate(visitDate, visitTime, leadHours) {
      if (!visitDate || !visitTime) return null;
      const dt = new Date(`${visitDate}T${visitTime}:00`);
      if (Number.isNaN(dt.getTime())) return null;
      return new Date(dt.getTime() - Number(leadHours || 24) * 3600000);
    },

    classifyHttpStatus(status) {
      if (status === 403) return "session-expired";
      if (status >= 200 && status < 300) return "ok";
      if (status >= 500) return "server-error";
      if (status >= 400) return "request-error";
      return "other";
    },

    sessionExpiredPatch() {
      return {
        enabled: false,
        lastResult: "session-expired",
        sessionStatus: "expired",
        sessionHttpStatus: 403,
        status: "Session expired"
      };
    },

    validatePersonalDetails(details, supportedCountries) {
      const value = field => String(details?.[field] || "").trim();
      const issues = [];
      const require = (field, label) => {
        if (!value(field)) issues.push({ field, label, message: `${label} is required` });
      };

      require("firstName", "First name");
      require("surname", "Surname");
      require("emailAddress", "Email address");
      require("zipcode", "Zip code");
      require("country", "Country");
      require("phoneNumber", "Phone number");

      const email = value("emailAddress");
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        issues.push({ field: "emailAddress", label: "Email address", message: "Enter a valid email address" });
      }

      const country = value("country").toUpperCase();
      if (country && Array.isArray(supportedCountries) && !supportedCountries.includes(country)) {
        issues.push({ field: "country", label: "Country", message: "Choose a supported country" });
      }

      const phone = value("phoneNumber");
      const digits = phone.replace(/[^0-9]/g, "");
      if (phone && (!phone.startsWith("+") || digits.length < 7 || digits.length > 15)) {
        issues.push({ field: "phoneNumber", label: "Phone number", message: "Use an international number beginning with +" });
      }

      return { valid: issues.length === 0, issues };
    },


    normalizeAutomationMode(mode, autoSelect = false) {
      if (mode === "watch" || mode === "test" || mode === "booking") return mode;
      // v0.5.7-v0.6.1 called the no-confirmation flow "continue".
      // Always migrate it to TEST, never to booking.
      if (mode === "continue") return "test";
      return autoSelect ? "test" : "watch";
    },

    automationUsesReservationFlow(mode, autoSelect = false) {
      const normalized = this.normalizeAutomationMode(mode, autoSelect);
      return normalized === "test" || normalized === "booking";
    },

    automationConfirms(mode, autoSelect = false) {
      return this.normalizeAutomationMode(mode, autoSelect) === "booking";
    },

    normalizeSummaryText(text) {
      return String(text || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
    },

    summaryDateTokens(date) {
      const match = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return [];
      const [, year, month, day] = match;
      const monthNumber = Number(month);
      const dayNumber = Number(day);
      const englishMonths = [
        "", "january", "february", "march", "april", "may", "june",
        "july", "august", "september", "october", "november", "december"
      ];
      const frenchMonths = [
        "", "janvier", "fevrier", "mars", "avril", "mai", "juin",
        "juillet", "aout", "septembre", "octobre", "novembre", "decembre"
      ];
      return [
        `${year}-${month}-${day}`,
        `${day}/${month}/${year}`,
        `${day}-${month}-${year}`,
        `${day}.${month}.${year}`,
        `${dayNumber} ${englishMonths[monthNumber]} ${year}`,
        `${englishMonths[monthNumber]} ${dayNumber}, ${year}`,
        `${dayNumber} ${frenchMonths[monthNumber]} ${year}`,
        // Notre-Dame's live Summary currently displays e.g. "Thursday 20 August 10:30"
        // without the year. Keep these as visible-text fallbacks; Booking mode prefers
        // the page's chosenTicketDate/chosenTicketTime globals when available.
        `${dayNumber} ${englishMonths[monthNumber]}`,
        `${dayNumber} ${frenchMonths[monthNumber]}`
      ];
    },

    verifySummaryEvidence(evidence, expected) {
      const expectedDate = String(expected?.date || "");
      const expectedTime = this.normalizeTime(expected?.time);
      const expectedVisitors = Number(expected?.visitors);
      const bodyText = this.normalizeSummaryText(evidence?.text || "");
      const dateText = this.normalizeSummaryText([
        ...(evidence?.dateValues || []),
        bodyText
      ].join(" "));
      const timeText = this.normalizeSummaryText([
        ...(evidence?.timeValues || []),
        bodyText
      ].join(" "));

      const dateOk = this.summaryDateTokens(expectedDate)
        .map(token => this.normalizeSummaryText(token))
        .some(token => token && dateText.includes(token));

      const timeOk = Boolean(expectedTime && timeText.includes(expectedTime));

      const visitorTotals = (evidence?.visitorTotals || [])
        .map(Number)
        .filter(Number.isFinite);
      let visitorsOk = Number.isFinite(expectedVisitors) &&
        visitorTotals.includes(expectedVisitors);

      if (!visitorsOk && Number.isFinite(expectedVisitors)) {
        const n = String(expectedVisitors).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const visitorAfterNumber = new RegExp(
          `\\b${n}\\s*(?:visitor(?:\\(s\\)|s)?|visiteur(?:\\(s\\)|s)?)\\b`, "i"
        );
        const numberAfterVisitor = new RegExp(
          `\\b(?:visitor(?:\\(s\\)|s)?|visiteur(?:\\(s\\)|s)?)\\s*[:x×-]?\\s*${n}\\b`, "i"
        );
        visitorsOk = visitorAfterNumber.test(bodyText) || numberAfterVisitor.test(bodyText);
      }

      return {
        valid: Boolean(dateOk && timeOk && visitorsOk),
        dateOk: Boolean(dateOk),
        timeOk: Boolean(timeOk),
        visitorsOk: Boolean(visitorsOk),
        expected: {
          date: expectedDate,
          time: expectedTime,
          visitors: expectedVisitors
        }
      };
    },


    profileConfigDefaults() {
      return {
        targetDate: "",
        targetTime: "14:00",
        visitors: 2,
        mode: "exact",
        rangeStart: "13:00",
        rangeEnd: "16:30",
        releaseLeadHours: 24,
        pollSeconds: 15,
        releaseBoundaryMode: false,
        pageSettleSeconds: 2.5,
        actionPauseSeconds: 1.2,
        automationMode: "watch",
        autoSelect: false,
        testMode: false,
        testFixture: "available",
        showInactive: false
      };
    },

    sanitizeProfileConfig(input = {}, defaults = {}) {
      const d = { ...this.profileConfigDefaults(), ...(defaults || {}) };
      const out = { ...d };
      const date = String(input?.targetDate ?? d.targetDate ?? "");
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) || date === "") out.targetDate = date;
      out.targetTime = this.normalizeTime(input?.targetTime) || this.normalizeTime(d.targetTime) || "14:00";
      const visitors = Number(input?.visitors);
      out.visitors = Number.isInteger(visitors) && visitors >= 1 && visitors <= 20 ? visitors : Number(d.visitors || 2);
      out.mode = ["exact", "range", "any"].includes(input?.mode) ? input.mode : (["exact", "range", "any"].includes(d.mode) ? d.mode : "exact");
      out.rangeStart = this.normalizeTime(input?.rangeStart) || this.normalizeTime(d.rangeStart) || "13:00";
      out.rangeEnd = this.normalizeTime(input?.rangeEnd) || this.normalizeTime(d.rangeEnd) || "16:30";
      const lead = Number(input?.releaseLeadHours);
      out.releaseLeadHours = Number.isFinite(lead) && lead > 0 && lead <= 168 ? lead : Number(d.releaseLeadHours || 24);
      const poll = Number(input?.pollSeconds);
      out.pollSeconds = [15, 30, 60, 120, 300, 900].includes(poll) ? poll : ([15,30,60,120,300,900].includes(Number(d.pollSeconds)) ? Number(d.pollSeconds) : 15);
      out.releaseBoundaryMode = typeof input?.releaseBoundaryMode === "boolean" ? input.releaseBoundaryMode : Boolean(d.releaseBoundaryMode);
      const pageSettle = Number(input?.pageSettleSeconds);
      const actionPause = Number(input?.actionPauseSeconds);
      out.pageSettleSeconds = Number.isFinite(pageSettle) && pageSettle >= 0 && pageSettle <= 10 ? pageSettle : Number(d.pageSettleSeconds ?? 2.5);
      out.actionPauseSeconds = Number.isFinite(actionPause) && actionPause >= 0 && actionPause <= 10 ? actionPause : Number(d.actionPauseSeconds ?? 1.2);
      out.automationMode = this.normalizeAutomationMode(input?.automationMode, input?.autoSelect);
      out.autoSelect = this.automationUsesReservationFlow(out.automationMode);
      out.testMode = typeof input?.testMode === "boolean" ? input.testMode : Boolean(d.testMode);
      out.testFixture = ["available", "unavailable", "opens", "session-expired", "api-error"].includes(input?.testFixture)
        ? input.testFixture
        : (["available", "unavailable", "opens", "session-expired", "api-error"].includes(d.testFixture) ? d.testFixture : "available");
      out.showInactive = typeof input?.showInactive === "boolean" ? input.showInactive : Boolean(d.showInactive);
      return out;
    },

    sanitizeProfilePersonalDetails(input = {}) {
      const clean = (key, max = 200) => String(input?.[key] || "").trim().slice(0, max);
      const country = clean("country", 2).toUpperCase();
      return {
        firstName: clean("firstName", 120),
        surname: clean("surname", 120),
        emailAddress: clean("emailAddress", 254),
        zipcode: clean("zipcode", 40),
        country: /^[A-Z]{2}$/.test(country) ? country : "",
        phoneNumber: clean("phoneNumber", 80)
      };
    },

    buildProfile(config = {}, personalDetails = {}) {
      return {
        config: this.sanitizeProfileConfig(config),
        personalDetails: this.sanitizeProfilePersonalDetails(personalDetails)
      };
    },

    normalizeProfile(profile = {}, configDefaults = {}) {
      // v1/backward compatibility: profiles were plain reusable-config objects.
      if (profile && typeof profile === "object" && !Array.isArray(profile) && !profile.config && !profile.personalDetails) {
        return {
          config: this.sanitizeProfileConfig(profile, configDefaults),
          personalDetails: this.sanitizeProfilePersonalDetails({})
        };
      }
      return {
        config: this.sanitizeProfileConfig(profile?.config || {}, configDefaults),
        personalDetails: this.sanitizeProfilePersonalDetails(profile?.personalDetails || {})
      };
    },

    sanitizeProfile(profile = {}, configDefaults = {}) {
      return this.normalizeProfile(profile, configDefaults);
    },

    buildProfilesExport(profiles = {}, defaultProfile = "") {
      const clean = {};
      for (const [rawName, profile] of Object.entries(profiles || {})) {
        const name = String(rawName || "").trim().slice(0, 80);
        if (!name) continue;
        clean[name] = this.normalizeProfile(profile);
      }
      const wantedDefault = String(defaultProfile || "").trim();
      return {
        format: "notre-dame-reservation-helper-profiles",
        version: 3,
        defaultProfile: Object.prototype.hasOwnProperty.call(clean, wantedDefault) ? wantedDefault : "",
        profiles: clean
      };
    },

    profilesFilename(isoString) {
      const stamp = String(isoString || new Date().toISOString()).replace(/[:.]/g, "-");
      return `notre-dame-reservation-profiles-${stamp}.json`;
    },

    parseProfilesImport(payload, configDefaults = {}) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { valid: false, error: "expected a JSON object", profiles: {} };
      let version = Number(payload.version || 1);
      let source = payload.profiles;
      let legacy = false;
      if (!source || typeof source !== "object" || Array.isArray(source)) return { valid: false, error: "missing profiles object", profiles: {} };
      const format = payload.format;
      if (format && format !== "notre-dame-reservation-helper-profiles" && format !== "app-profiles") return { valid: false, error: "unsupported profile format", profiles: {} };
      if (![1,2,3].includes(version)) return { valid: false, error: `unsupported profile version ${version}`, profiles: {} };
      if (!payload.format || version === 1) legacy = true;
      const profiles = {};
      for (const [rawName, rawProfile] of Object.entries(source)) {
        const name = String(rawName || "").trim().slice(0, 80);
        if (!name || !rawProfile || typeof rawProfile !== "object" || Array.isArray(rawProfile)) continue;
        profiles[name] = this.normalizeProfile(rawProfile, configDefaults);
      }
      const requestedDefault = version >= 3 ? String(payload.defaultProfile || "").trim() : "";
      const defaultProfile = Object.prototype.hasOwnProperty.call(profiles, requestedDefault) ? requestedDefault : "";
      return { valid: true, version, profiles, legacy, defaultProfile };
    },

    mergeProfiles(current = {}, imported = {}, replaceNames = []) {
      const replace = new Set(replaceNames || []);
      const profiles = { ...(current || {}) };
      const added = [], replaced = [], skipped = [];
      for (const [name, profile] of Object.entries(imported || {})) {
        if (!Object.prototype.hasOwnProperty.call(profiles, name)) { profiles[name] = profile; added.push(name); }
        else if (replace.has(name)) { profiles[name] = profile; replaced.push(name); }
        else skipped.push(name);
      }
      return { profiles, added, replaced, skipped };
    },


    classifyReservationPage(pathname = "", text = "") {
      const path = String(pathname || "").toLowerCase();
      const body = String(text || "").replace(/\s+/g, " ").trim().slice(0, 12000);
      if (/performing security verification|cloudflare|security verification/i.test(body) && /verification|not a bot|security service/i.test(body)) {
        return { stage: "security", outcome: null, confidence: "high" };
      }
      if (/\/reservationindividuelle\/tickets(?:[/?#]|$)/.test(path)) return { stage: "tickets", outcome: null, confidence: "high" };
      if (/\/reservationindividuelle\/date(?:[/?#]|$)/.test(path)) return { stage: "date", outcome: null, confidence: "high" };
      if (/personal-details/.test(path)) return { stage: "personal-details", outcome: null, confidence: "high" };
      if (/donation/.test(path)) return { stage: "donation", outcome: null, confidence: "high" };
      if (/\/summary(?:[/?#]|$)/.test(path)) return { stage: "summary", outcome: null, confidence: "high" };
      const failure = /reservation (?:could not|cannot|failed)|booking failed|payment failed|unable to (?:complete|confirm)|échec|erreur.*réservation/i.test(body);
      const success = /reservation (?:is |has been )?confirmed|booking (?:is )?confirmed|réservation (?:est )?confirmée|confirmation de (?:la )?réservation/i.test(body);
      if (/\/payment(?:[/?#]|$)/.test(path)) {
        if (success) return { stage: "final", outcome: "confirmed", confidence: "high" };
        if (failure) return { stage: "final", outcome: "failed", confidence: "high" };
        return { stage: "payment", outcome: null, confidence: "high" };
      }
      const finalish = /\/(?:confirm|confirmation|complete|success)(?:[/?#]|$)/.test(path);
      if (finalish && success) return { stage: "final", outcome: "confirmed", confidence: "high" };
      if (finalish && failure) return { stage: "final", outcome: "failed", confidence: "high" };
      if (finalish) return { stage: "final", outcome: "unclassified", confidence: "low" };
      return { stage: "unknown", outcome: null, confidence: "low" };
    },

    workflowRecovery(stage, requestedMode = "watch") {
      const mode = this.normalizeAutomationMode(requestedMode);
      const resumable = (mode !== "watch" && ["tickets", "date", "personal-details", "donation", "summary"].includes(stage)) ||
        (mode === "booking" && stage === "complete");
      const hints = {
        tickets: "Reload/revalidate if needed, then resume from Visitors.",
        date: "Resume on the current Date page; availability will be rechecked only when required.",
        "personal-details": "Resume on Personal details; stored profile details can be filled again.",
        donation: "Resume on Donation; the helper will keep donation at zero.",
        summary: "Resume on Summary; automation will re-verify date, time and visitor count before opening Complete.",
        complete: "Resume on Complete to accept the Terms and Conditions and submit the reservation."
      };
      return { canResume: resumable, hint: resumable ? hints[stage] : null };
    },

    diagnosticSensitiveKey(key) {
      return /(?:password|passwd|secret|token|csrf|cookie|authorization|payment|card|cvv|cvc|iban|clearance|datadome|__cf|personal(?:firstname|surname|email|zipcode|country|phone)|emailaddress|phonenumber)/i.test(String(key || ""));
    },

    redactDiagnosticText(value, secrets = []) {
      let out = String(value ?? "");
      for (const secret of secrets || []) {
        const s = String(secret || "").trim();
        if (s.length >= 2) out = out.split(s).join("[redacted]");
      }
      out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email redacted]");
      out = out.replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone redacted]");
      out = out.replace(/((?:csrf_(?:name|value)|token(?:_tickets)?|cf_clearance|__cf_bm|datadome|authorization|cookie)\s*[:=]\s*)[^\s&]+/gi, "$1[redacted]");
      return out;
    },

    sanitizeDiagnosticValue(value, secrets = [], key = "") {
      if (this.diagnosticSensitiveKey(key)) return "[redacted]";
      if (Array.isArray(value)) return value.map(item => this.sanitizeDiagnosticValue(item, secrets, key));
      if (value && typeof value === "object") {
        const out = {};
        for (const [childKey, item] of Object.entries(value)) {
          out[childKey] = this.sanitizeDiagnosticValue(item, secrets, childKey);
        }
        return out;
      }
      if (typeof value === "string") return this.redactDiagnosticText(value, secrets);
      return value;
    },

    diagnosticFilename(isoString) {
      const stamp = String(isoString || new Date().toISOString()).replace(/[:.]/g, "-");
      return `notre-dame-reservation-diagnostic-${stamp}.json`;
    },

    buildDiagnosticPayload(parts = {}, secrets = []) {
      return this.sanitizeDiagnosticValue({
        format: "notre-dame-reservation-helper-diagnostic",
        formatVersion: 2,
        ...parts
      }, secrets);
    },

    summarizeSlot(slot) {
      if (!slot) return null;
      return {
        time: slot.time ?? "",
        available: this.isSlotAvailable(slot),
        active: slot.active === true,
        soldOut: slot.soldOut === true,
        expired: slot.expired === true,
        totalAvailable: Number(slot.totalAvailable ?? 0),
        classAttr: slot.classAttr ?? ""
      };
    },

    parseTimeslotsResponse(payload) {
      if (!payload || payload.success !== true || !payload.timeslots) {
        return { success: false, date: payload?.date || null, slots: [] };
      }
      return {
        success: true,
        date: payload.date || null,
        slots: Object.values(payload.timeslots).map(slot => this.summarizeSlot(slot))
      };
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = NDRHLogic;
  global.NDRHLogic = NDRHLogic;
})(typeof globalThis !== "undefined" ? globalThis : window);
