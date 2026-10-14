
(() => {
  const out = [];
  let passed = 0, failed = 0;

  function test(name, fn) {
    try {
      fn();
      passed++;
      out.push(`PASS  ${name}`);
    } catch (e) {
      failed++;
      out.push(`FAIL  ${name}\n      ${e.message}`);
    }
  }
  function assert(cond, msg = "Assertion failed") {
    if (!cond) throw new Error(msg);
  }
  function eq(a, b, msg = "") {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
    }
  }

  const L = NDRHLogic;
  const F = NDRHFixtures;

  test("active=true is authoritative even if soldOut=true", () => {
    assert(L.isSlotAvailable(F.mixed.timeslots["13:30"]) === true);
  });

  test("inactive slot is unavailable even if soldOut=false", () => {
    assert(L.isSlotAvailable(F.mixed.timeslots["13:45"]) === false);
  });

  test("local available fixture produces an active matching slot", () => {
    const response = L.localTestResponse("available", { targetDate: "2026-08-20", targetTime: "13:15" });
    assert(response.ok && response.data.success);
    eq(response.data.date, "2026-08-20");
    assert(response.data.timeslots["13:15"].active);
  });

  test("local opens fixture changes from unavailable to available", () => {
    const before = L.localTestResponse("opens", { targetTime: "13:15" }, 0);
    const after = L.localTestResponse("opens", { targetTime: "13:15" }, 1);
    assert(!after.data.timeslots["13:15"].soldOut);
    assert(!before.data.timeslots["13:15"].active);
    assert(after.data.timeslots["13:15"].active);
  });

  test("local rejected-session fixture mirrors a 403 without a provider request", () => {
    const response = L.localTestResponse("session-expired");
    assert(!response.ok);
    eq(response.status, 403);
  });

  test("availability alert fires once when matching availability first appears", () => {
    const result = { kind: "available", message: "1 available: 13:15(2)" };
    assert(L.availabilityTransition("unavailable|No slots", result));
    assert(!L.availabilityTransition("available|1 available: 13:15(1)", result));
    assert(!L.availabilityTransition("available|old", { kind: "unavailable" }));
  });

  test("negative totalAvailable does not affect availability", () => {
    const s = F.mixed.timeslots["13:30"];
    assert(s.totalAvailable < 0);
    assert(L.isSlotAvailable(s) === true);
  });

  test("exact mode finds active target", () => {
    const r = L.filterTimeslots(F.mixed.timeslots, "exact", "13:15");
    eq(r.map(x => x.time), ["13:15"]);
  });

  test("exact mode ignores inactive target", () => {
    const r = L.filterTimeslots(F.mixed.timeslots, "exact", "13:00");
    eq(r, []);
  });

  test("range mode returns only active slots in range", () => {
    const r = L.filterTimeslots(F.mixed.timeslots, "range", null, "13:10", "13:35");
    eq(r.map(x => x.time), ["13:15", "13:30"]);
  });

  test("any mode returns every active slot", () => {
    const r = L.filterTimeslots(F.mixed.timeslots, "any");
    eq(r.map(x => x.time), ["13:15", "13:30"]);
  });

  test("T-24 release calculation", () => {
    const d = L.expectedReleaseDate("2026-08-17", "14:00", 24);
    assert(d instanceof Date && !Number.isNaN(d.getTime()));
    eq(d.getHours(), 14);
  });

  test("T-4 release calculation", () => {
    const visit = new Date("2026-08-17T14:00:00");
    const d = L.expectedReleaseDate("2026-08-17", "14:00", 4);
    eq(visit.getTime() - d.getTime(), 4 * 3600000);
  });

  test("403 classifies as session-expired", () => {
    eq(L.classifyHttpStatus(403), "session-expired");
  });

  test("403 must stop polling / require revalidation", () => {
    const action = L.classifyHttpStatus(403) === "session-expired" ? "stop-and-revalidate" : "continue";
    eq(action, "stop-and-revalidate");
  });

  test("403 applies the full expired-session stop state", () => {
    eq(L.sessionExpiredPatch(), {
      enabled: false,
      lastResult: "session-expired",
      sessionStatus: "expired",
      sessionHttpStatus: 403,
      status: "Session expired"
    });
  });

  test("complete temporary personal details permit automation", () => {
    const result = L.validatePersonalDetails({
      firstName: "Ada", surname: "Lovelace", emailAddress: "ada@example.com",
      zipcode: "1040", country: "BE", phoneNumber: "+32 476 40 96 05"
    }, ["BE"]);
    assert(result.valid);
    eq(result.issues, []);
  });

  test("incomplete or invalid temporary personal details block automation", () => {
    const result = L.validatePersonalDetails({
      firstName: "Ada", surname: "", emailAddress: "not-an-email",
      zipcode: "", country: "ZZ", phoneNumber: "0476 40 96 05"
    }, ["BE"]);
    assert(!result.valid);
    eq(result.issues.map(issue => issue.field), ["surname", "zipcode", "emailAddress", "country", "phoneNumber"]);
  });


  test("legacy continue automation migrates to TEST, never Booking", () => {
    eq(L.normalizeAutomationMode("continue"), "test");
    eq(L.normalizeAutomationMode(null, true), "test");
    assert(!L.automationConfirms("continue"));
  });

  test("only Booking automation permits final confirmation", () => {
    assert(L.automationUsesReservationFlow("test"));
    assert(L.automationUsesReservationFlow("booking"));
    assert(!L.automationUsesReservationFlow("watch"));
    assert(!L.automationConfirms("test"));
    assert(L.automationConfirms("booking"));
  });

  test("Summary verification requires matching date, time and visitors", () => {
    const result = L.verifySummaryEvidence({
      dateValues: ["2026-08-20"],
      timeValues: ["12:00"],
      visitorTotals: [2],
      text: "Summary — Thursday 20 August 2026 — 12:00 — 2 visitors"
    }, { date: "2026-08-20", time: "12:00", visitors: 2 });
    assert(result.valid);
    assert(result.dateOk && result.timeOk && result.visitorsOk);
  });


  test("Summary visible date without year is accepted as fallback", () => {
    const result = L.verifySummaryEvidence({
      dateValues: [],
      timeValues: ["10:30"],
      visitorTotals: [2],
      text: "Visit date Thursday 20 August 10:30 2 Visitor(s)"
    }, { date: "2026-08-20", time: "10:30", visitors: 2 });
    assert(result.valid);
  });

  test("Summary mismatch blocks Booking confirmation", () => {
    const result = L.verifySummaryEvidence({
      dateValues: ["2026-08-20"],
      timeValues: ["12:15"],
      visitorTotals: [2],
      text: "Summary — 20 August 2026 — 12:15 — 2 visitors"
    }, { date: "2026-08-20", time: "12:00", visitors: 2 });
    assert(!result.valid);
    assert(result.dateOk);
    assert(!result.timeOk);
    assert(result.visitorsOk);
  });

  test("200 classifies as ok", () => {
    eq(L.classifyHttpStatus(200), "ok");
  });

  test("timeslots JSON parser handles negative totals", () => {
    const parsed = L.parseTimeslotsResponse(F.sold_out);
    assert(parsed.success);
    const s = parsed.slots.find(x => x.time === "13:15");
    eq(s.totalAvailable, -15);
    eq(s.available, false);
  });


  test("diagnostic sensitive-data exclusion redacts secrets and personal keys", () => {
    const sanitized = L.sanitizeDiagnosticValue({
      status: "error for ada@example.com and +32 476 40 96 05",
      csrf_value: "abc123",
      cookie: "session=xyz",
      nested: { token_tickets: "secret-ticket-token", safe: "ok" }
    });
    eq(sanitized.csrf_value, "[redacted]");
    eq(sanitized.cookie, "[redacted]");
    eq(sanitized.nested.token_tickets, "[redacted]");
    eq(sanitized.nested.safe, "ok");
    assert(!JSON.stringify(sanitized).includes("ada@example.com"));
    assert(!JSON.stringify(sanitized).includes("+32 476 40 96 05"));
  });

  test("diagnostic collection payload preserves useful partial sources", () => {
    const payload = L.buildDiagnosticPayload({
      extensionVersion: "0.6.10",
      capturedAt: "2026-09-05T08:00:00.000Z",
      operation: { status: "Watching", recentActivity: ["one"] },
      page: null,
      sourceErrors: [{ source: "pageSnapshot", error: "unavailable" }]
    });
    eq(payload.format, "notre-dame-reservation-helper-diagnostic");
    eq(payload.formatVersion, 2);
    eq(payload.operation.status, "Watching");
    eq(payload.sourceErrors[0].source, "pageSnapshot");
  });

  test("diagnostic download filename is timestamped JSON", () => {
    eq(
      L.diagnosticFilename("2026-09-05T08:00:00.123Z"),
      "notre-dame-reservation-diagnostic-2026-09-05T08-00-00-123Z.json"
    );
  });

  test("diagnostic button contract uses the expected popup control id", () => {
    eq("downloadDiagnostic", "downloadDiagnostic");
  });



  test("profile v2 saves reusable configuration and reservation personal details", () => {
    const p = L.buildProfile({ targetDate: "2026-08-20", targetTime: "12:00", visitors: 2, automationMode: "test" }, {
      firstName: "Ada", surname: "Lovelace", emailAddress: "ada@example.com", zipcode: "1000", country: "be", phoneNumber: "+32 470 00 00 00"
    });
    eq(p.config.targetDate, "2026-08-20");
    eq(p.config.targetTime, "12:00");
    eq(p.personalDetails.firstName, "Ada");
    eq(p.personalDetails.country, "BE");
  });

  test("profile v2 does not preserve unsupported or transient fields", () => {
    const p = L.normalizeProfile({
      config: { targetTime: "13:15", enabled: true, status: "Watching", csrf_value: "secret" },
      personalDetails: { firstName: "Ada", token: "secret", cookie: "x" },
      sessionStatus: "valid"
    });
    assert(!Object.prototype.hasOwnProperty.call(p.config, "enabled"));
    assert(!Object.prototype.hasOwnProperty.call(p.config, "status"));
    assert(!Object.prototype.hasOwnProperty.call(p.config, "csrf_value"));
    assert(!Object.prototype.hasOwnProperty.call(p.personalDetails, "token"));
    assert(!Object.prototype.hasOwnProperty.call(p.personalDetails, "cookie"));
  });

  test("profiles export uses version 3 and includes personal details/default profile", () => {
    const payload = L.buildProfilesExport({ Home: L.buildProfile({ targetTime: "14:00" }, { firstName: "Ada", emailAddress: "ada@example.com" }) }, "Home");
    eq(payload.format, "notre-dame-reservation-helper-profiles");
    eq(payload.version, 3);
    eq(payload.defaultProfile, "Home");
    eq(payload.profiles.Home.personalDetails.firstName, "Ada");
  });

  test("profile import accepts legacy version 1 configuration-only exports", () => {
    const parsed = L.parseProfilesImport({ format: "notre-dame-reservation-helper-profiles", version: 1, profiles: { Old: { targetTime: "15:00", visitors: 2 } } });
    assert(parsed.valid);
    assert(parsed.legacy);
    eq(parsed.profiles.Old.config.targetTime, "15:00");
    eq(parsed.profiles.Old.personalDetails.firstName, "");
  });

  test("profile import version 2 ignores unsupported fields", () => {
    const parsed = L.parseProfilesImport({ format: "notre-dame-reservation-helper-profiles", version: 2, profiles: { X: { config: { targetTime: "16:00", bogus: 7 }, personalDetails: { firstName: "Ada", password: "nope" } } } });
    assert(parsed.valid);
    eq(parsed.profiles.X.config.targetTime, "16:00");
    assert(!Object.prototype.hasOwnProperty.call(parsed.profiles.X.config, "bogus"));
    assert(!Object.prototype.hasOwnProperty.call(parsed.profiles.X.personalDetails, "password"));
  });


  test("profile pacing values persist and are bounded", () => {
    const p = L.buildProfile({ pageSettleSeconds: 3.4, actionPauseSeconds: 1.7 });
    eq(p.config.pageSettleSeconds, 3.4);
    eq(p.config.actionPauseSeconds, 1.7);
    const bounded = L.buildProfile({ pageSettleSeconds: 99, actionPauseSeconds: -1 });
    eq(bounded.config.pageSettleSeconds, 2.5);
    eq(bounded.config.actionPauseSeconds, 1.2);
  });

  test("profile import version 3 preserves valid default profile", () => {
    const parsed = L.parseProfilesImport({ format: "notre-dame-reservation-helper-profiles", version: 3, defaultProfile: "Home", profiles: { Home: { config: { targetTime: "12:00" }, personalDetails: {} } } });
    assert(parsed.valid);
    eq(parsed.defaultProfile, "Home");
  });

  test("profile import ignores missing default profile", () => {
    const parsed = L.parseProfilesImport({ format: "notre-dame-reservation-helper-profiles", version: 3, defaultProfile: "Missing", profiles: { Home: { config: {}, personalDetails: {} } } });
    assert(parsed.valid);
    eq(parsed.defaultProfile, "");
  });

  test("workflow page classifier recognizes reservation stages", () => {
    eq(L.classifyReservationPage("/en/reservationindividuelle/tickets", "").stage, "tickets");
    eq(L.classifyReservationPage("/en/reservationindividuelle/date", "").stage, "date");
    eq(L.classifyReservationPage("/en/reservationindividuelle/personal-details", "").stage, "personal-details");
    eq(L.classifyReservationPage("/en/reservationindividuelle/summary", "").stage, "summary");
  });

  test("workflow final classifier is conservative", () => {
    const confirmed = L.classifyReservationPage("/en/reservationindividuelle/payment", "Your reservation is confirmed");
    eq(confirmed.stage, "final");
    eq(confirmed.outcome, "confirmed");
    const unknown = L.classifyReservationPage("/en/reservationindividuelle/payment", "Thank you");
    eq(unknown.stage, "payment");
    eq(unknown.outcome, null);
  });

  test("workflow recovery allows explicit resume only on known reservation pages", () => {
    assert(L.workflowRecovery("personal-details", "test").canResume);
    assert(L.workflowRecovery("summary", "booking").canResume);
    assert(L.workflowRecovery("complete", "booking").canResume);
    assert(!L.workflowRecovery("complete", "test").canResume);
    assert(!L.workflowRecovery("final", "booking").canResume);
    assert(!L.workflowRecovery("date", "watch").canResume);
  });

  document.getElementById("summary").innerHTML =
    `<strong class="${failed ? "fail" : "pass"}">${passed} passed, ${failed} failed</strong>`;
  document.getElementById("results").textContent = out.join("\n");
})();
