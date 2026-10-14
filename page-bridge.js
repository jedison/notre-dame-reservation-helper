(() => {
  if (window.__NDRH_PAGE_BRIDGE__) return;
  window.__NDRH_PAGE_BRIDGE__ = true;

  // Give Notre-Dame's own handlers and page state time to settle between
  // automated actions. These are fixed waits, not randomized human imitation,
  // and they do not attempt to bypass security checks.
  const ACTION_SETTLE_MS = 900;
  const FINAL_CONFIRM_SETTLE_MS = 1200;

  function afterSettle(callback, delay = ACTION_SETTLE_MS) {
    window.setTimeout(() => {
      try { callback(); }
      catch (error) { workflowError(String(error?.message || error)); }
    }, delay);
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== "NDRH_EXTENSION") return;

    if (msg.type === "SET_SHOW_INACTIVE") {
      try {
        if (typeof window.__NDRH_ORIGINAL_DISPLAY_INACTIVE__ === "undefined") {
          window.__NDRH_ORIGINAL_DISPLAY_INACTIVE__ =
            typeof window.settingsDisplayInactiveTimeslots !== "undefined"
              ? window.settingsDisplayInactiveTimeslots
              : false;
        }

        const previousDisplayInactive = Boolean(window.settingsDisplayInactiveTimeslots);
        window.settingsDisplayInactiveTimeslots = msg.enabled
          ? true
          : window.__NDRH_ORIGINAL_DISPLAY_INACTIVE__;

        const selectedDate = document.querySelector("#calendar-date")?.value;
        if (selectedDate && previousDisplayInactive !== Boolean(window.settingsDisplayInactiveTimeslots)) {
          if (typeof window.ticketDateChosen === "function") {
            window.ticketDateChosen(selectedDate);
          } else if (typeof window.getTimeslots === "function") {
            window.getTimeslots(selectedDate);
          }
        }

        window.postMessage({
          source: "NDRH_PAGE",
          type: "SHOW_INACTIVE_RESULT",
          enabled: Boolean(window.settingsDisplayInactiveTimeslots),
          ok: true
        }, "*");
      } catch (error) {
        window.postMessage({
          source: "NDRH_PAGE",
          type: "SHOW_INACTIVE_RESULT",
          ok: false,
          error: String(error?.message || error)
        }, "*");
      }
      return;
    }

    if (msg.type === "ADVANCE_TO_PERSONAL_DETAILS") {
      try {
        const csrfName = document.querySelector('input[name="csrf_name"]')?.value;
        const csrfValue = document.querySelector('input[name="csrf_value"]')?.value;
        if (!csrfName || !csrfValue) {
          throw new Error("Open the reservation date page normally so its CSRF fields are available");
        }

        // Submit the same date/time form that the site uses to open the
        // personal-details page. Tokens are read fresh from this browser page
        // and are never stored by the extension.
        const form = document.createElement("form");
        form.method = "POST";
        form.action = new URL("personal-details", window.location.href).href;
        form.style.display = "none";

        for (const [name, value] of Object.entries({
          csrf_name: csrfName,
          csrf_value: csrfValue,
          ticketDate: msg.date,
          ticketTime: msg.time
        })) {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = name;
          input.value = value;
          form.appendChild(input);
        }

        document.documentElement.appendChild(form);
        afterSettle(() => form.submit());
      } catch (error) {
        window.postMessage({
          source: "NDRH_PAGE",
          type: "ADVANCE_ERROR",
          error: String(error?.message || error)
        }, "*");
      }
      return;
    }

    if (msg.type === "PREPARE_TICKETS") {
      try {
        const visitorCount = Number(msg.visitors);
        if (!Number.isInteger(visitorCount) || visitorCount < 1) {
          throw new Error("Choose a valid visitor count in the extension");
        }

        const ticketSelects = [...document.querySelectorAll(
          '#tickets-section .row-container select[name^="tickets["]:not([disabled]), ' +
          '#tickets-section .row-container select[name^="ticketNumbers["]:not([disabled])'
        )];
        if (ticketSelects.length === 0) {
          throw new Error("Could not find the site's visitor quantity selector");
        }
        // This reservation flow normally has one individual-visitor selector.
        // Do not guess among multiple ticket categories (adult, child, group,
        // etc.); asking the user to choose one on the site is safer than
        // silently assigning the requested visitors to the wrong category.
        if (ticketSelects.length !== 1) {
          throw new Error("More than one ticket category is shown; choose the ticket category on the site first");
        }

        const ticketSelect = ticketSelects[0];
        const requestedOption = [...ticketSelect.options].find(option =>
          String(option.value) === String(visitorCount)
        );
        if (!requestedOption || requestedOption.disabled) {
          throw new Error(`The site does not offer ${visitorCount} visitors for this ticket`);
        }

        ticketSelect.value = String(visitorCount);
        ticketSelect.dispatchEvent(new Event("input", { bubbles: true }));
        ticketSelect.dispatchEvent(new Event("change", { bubbles: true }));
        if (window.jQuery) {
          const $ticketSelect = window.jQuery(ticketSelect);
          if ($ticketSelect.hasClass("gt-desktop-select")) {
            try { $ticketSelect.selectmenu("refresh"); } catch (_) {}
          }
        }

        // Let the site's own change handlers finish, then report that the
        // visitor selection is ready. The extension performs a live session
        // check in this exact browser tab/session before it is allowed to use
        // the site's Next control.
        setTimeout(() => {
          const nextButton = [...document.querySelectorAll("#button-steps .next")].find(button =>
            !button.disabled && !button.hasAttribute("disabled") &&
            getComputedStyle(button).display !== "none"
          );
          if (!nextButton) {
            workflowError("The site's Next button did not become available after selecting visitors");
            return;
          }
          window.postMessage({
            source: "NDRH_PAGE",
            type: "TICKETS_PREPARED",
            visitors: visitorCount
          }, "*");
        }, ACTION_SETTLE_MS);
      } catch (error) {
        window.postMessage({
          source: "NDRH_PAGE",
          type: "WORKFLOW_ERROR",
          error: String(error?.message || error)
        }, "*");
      }
      return;
    }

    if (msg.type === "CONTINUE_TICKETS") {
      try {
        const nextButton = [...document.querySelectorAll("#button-steps .next")].find(button =>
          !button.disabled && !button.hasAttribute("disabled") &&
          getComputedStyle(button).display !== "none"
        );
        if (!nextButton) {
          throw new Error("The site's Next button is no longer available");
        }
        window.postMessage({
          source: "NDRH_PAGE",
          type: "TICKETS_READY",
          visitors: Number(msg.visitors) || null
        }, "*");
        afterSettle(() => {
          if (!visibleEnabled(nextButton)) {
            throw new Error("The site's Next button changed before it could be used");
          }
          nextButton.click();
        });
      } catch (error) {
        workflowError(String(error?.message || error));
      }
      return;
    }

    function workflowError(message) {
      window.postMessage({ source: "NDRH_PAGE", type: "WORKFLOW_ERROR", error: message }, "*");
    }

    function submitPageForm(anchorSelector, expectedPath) {
      const anchor = document.querySelector(anchorSelector);
      const form = anchor?.closest("form");
      if (!form) throw new Error("Could not find the site's reservation form");
      const action = new URL(form.getAttribute("action") || window.location.href, window.location.href);
      if (!action.pathname.endsWith(expectedPath)) {
        throw new Error(`Expected the ${expectedPath} form, found ${action.pathname}`);
      }
      if (typeof form.requestSubmit === "function") form.requestSubmit();
      else form.submit();
    }

    if (msg.type === "SUBMIT_PERSONAL_DETAILS") {
      afterSettle(() => submitPageForm("#firstName", "/donation"));
      return;
    }

    if (msg.type === "SUBMIT_ZERO_DONATION") {
      try {
        const donationCheck = document.querySelector("#donation-check");
        if (donationCheck) {
          donationCheck.checked = false;
          donationCheck.dispatchEvent(new Event("change", { bubbles: true }));
        }
        const donationOptions = [...document.querySelectorAll('[name="donation-input"]')];
        const zeroOption = donationOptions.find(input => String(input.value) === "0");
        if (zeroOption) {
          zeroOption.checked = true;
          zeroOption.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          donationOptions.forEach(input => { input.value = "0"; });
        }
        const otherDonation = document.querySelector("#donation");
        if (otherDonation) otherDonation.value = "0";
        afterSettle(() => submitPageForm("#donation-check, [name=\"donation-input\"]", "/summary"));
      } catch (error) {
        workflowError(String(error?.message || error));
      }
      return;
    }


    function normalizeSummaryText(text) {
      return String(text || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
    }

    function summaryDateTokens(date) {
      const match = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return [];
      const [, year, month, day] = match;
      const monthNumber = Number(month);
      const dayNumber = Number(day);
      const en = ["","january","february","march","april","may","june","july","august","september","october","november","december"];
      const fr = ["","janvier","fevrier","mars","avril","mai","juin","juillet","aout","septembre","octobre","novembre","decembre"];
      return [
        `${year}-${month}-${day}`, `${day}/${month}/${year}`,
        `${day}-${month}-${year}`, `${day}.${month}.${year}`,
        `${dayNumber} ${en[monthNumber]} ${year}`,
        `${en[monthNumber]} ${dayNumber}, ${year}`,
        `${dayNumber} ${fr[monthNumber]} ${year}`,
        // Notre-Dame's Summary can show its visit date without the year.
        // Keep this aligned with logic.js, which performs the first check.
        `${dayNumber} ${en[monthNumber]}`,
        `${dayNumber} ${fr[monthNumber]}`
      ];
    }

    function collectSummaryEvidence() {
      if (!/\/summary(?:[/?#]|$)/.test(window.location.pathname)) {
        throw new Error("The browser is not on the reservation Summary page");
      }

      const controls = [...document.querySelectorAll("input, select, time, [data-date], [data-time]")];
      const dateValues = [];
      const timeValues = [];
      for (const control of controls) {
        const key = [
          control.getAttribute?.("name"),
          control.getAttribute?.("id"),
          control.getAttribute?.("data-date"),
          control.getAttribute?.("data-time")
        ].filter(Boolean).join(" ").toLowerCase();
        const value = control.value ?? control.getAttribute?.("datetime") ??
          control.getAttribute?.("data-date") ?? control.getAttribute?.("data-time") ?? "";
        if (key.includes("date") && value) dateValues.push(String(value));
        if (key.includes("time") && value) timeValues.push(String(value));
      }

      const quantityControls = [...document.querySelectorAll(
        'input[name^="tickets["], select[name^="tickets["], ' +
        'input[name^="ticketNumbers["], select[name^="ticketNumbers["]'
      )];
      const quantities = quantityControls
        .map(control => Number(control.value))
        .filter(value => Number.isFinite(value) && value > 0);
      const visitorTotals = quantities.length
        ? [quantities.reduce((sum, value) => sum + value, 0)]
        : [];

      return {
        dateValues: [...new Set(dateValues)],
        timeValues: [...new Set(timeValues)],
        visitorTotals,
        // Kept in memory only for the immediate verification; never persisted or logged.
        text: String(document.body?.innerText || "").slice(0, 30000)
      };
    }

    function summaryMatchesExpected(evidence, expected) {
      const normalizedText = normalizeSummaryText(evidence.text || "");
      const dateText = normalizeSummaryText([...(evidence.dateValues || []), normalizedText].join(" "));
      const timeText = normalizeSummaryText([...(evidence.timeValues || []), normalizedText].join(" "));
      const dateOk = summaryDateTokens(expected?.date)
        .map(normalizeSummaryText)
        .some(token => token && dateText.includes(token));
      const time = String(expected?.time || "");
      const timeOk = /^\d{2}:\d{2}$/.test(time) && timeText.includes(time);
      const visitors = Number(expected?.visitors);
      const totals = (evidence.visitorTotals || []).map(Number).filter(Number.isFinite);
      let visitorsOk = Number.isFinite(visitors) && totals.includes(visitors);
      if (!visitorsOk && Number.isFinite(visitors)) {
        const n = String(visitors).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        visitorsOk =
          new RegExp(`\\b${n}\\s*(?:visitor(?:\\(s\\)|s)?|visiteur(?:\\(s\\)|s)?)\\b`, "i").test(normalizedText) ||
          new RegExp(`\\b(?:visitor(?:\\(s\\)|s)?|visiteur(?:\\(s\\)|s)?)\\s*[:x×-]?\\s*${n}\\b`, "i").test(normalizedText);
      }
      return { valid: Boolean(dateOk && timeOk && visitorsOk), dateOk, timeOk, visitorsOk };
    }

    function visibleEnabled(element) {
      if (!element || element.disabled || element.hasAttribute?.("disabled")) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" &&
        Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0;
    }

    function confirmationControl() {
      // The live reservation Summary has one known handoff to Payment. Prefer
      // that concrete control over generic wording heuristics so Booking mode
      // reliably reaches Payment without treating that page as a payment
      // submission. Test mode never invokes this path.
      const paymentControls = [...document.querySelectorAll(
        'form#summary-form[action$="/reservationindividuelle/payment"] button.next[type="submit"], ' +
        'form#summary-form[action$="/reservationindividuelle/payment"] input.next[type="submit"]'
      )].filter(visibleEnabled);
      if (paymentControls.length === 1) return paymentControls[0];
      if (paymentControls.length > 1) {
        throw new Error("More than one Summary-to-Payment control is visible");
      }

      const candidates = [...document.querySelectorAll(
        'button, input[type="submit"], input[type="button"], a.button, a.btn, #button-steps .next'
      )].filter(visibleEnabled);

      const label = element => normalizeSummaryText(
        element.innerText || element.value || element.getAttribute("aria-label") ||
        element.getAttribute("title") || ""
      );
      const backwards = /(previous|back|return|precedent|précédent|retour)/i;
      const finalWords = /(confirm|confirmation|book|reserve|reservation|finish|complete|validate|submit|terminer|confirmer|reserver|réserver|valider)/i;

      const strong = candidates.filter(element => {
        const text = label(element);
        return finalWords.test(text) && !backwards.test(text);
      });

      if (strong.length === 1) return strong[0];
      if (strong.length > 1) {
        throw new Error("More than one possible final-confirmation control is visible");
      }

      // Conservative fallback: exactly one visible submit control on Summary.
      const submits = candidates.filter(element =>
        element.matches?.('button[type="submit"], input[type="submit"]')
      );
      if (submits.length === 1) return submits[0];
      throw new Error("Could not identify one unambiguous final-confirmation control");
    }

    if (msg.type === "INSPECT_SUMMARY") {
      try {
        window.postMessage({
          source: "NDRH_PAGE",
          type: "SUMMARY_INSPECTION_RESULT",
          requestId: msg.requestId,
          ok: true,
          evidence: collectSummaryEvidence()
        }, "*");
      } catch (error) {
        window.postMessage({
          source: "NDRH_PAGE",
          type: "SUMMARY_INSPECTION_RESULT",
          requestId: msg.requestId,
          ok: false,
          error: String(error?.message || error)
        }, "*");
      }
      return;
    }

    if (msg.type === "OPEN_PAYMENT") {
      try {
        const evidence = collectSummaryEvidence();
        const verification = summaryMatchesExpected(evidence, msg.expected || {});
        if (!verification.valid) {
          throw new Error(
            "Summary changed before confirmation " +
            `(date=${verification.dateOk}, time=${verification.timeOk}, visitors=${verification.visitorsOk})`
          );
        }

        const control = confirmationControl();
        const buttonText = String(
          control.innerText || control.value || control.getAttribute("aria-label") || ""
        ).trim();

        window.postMessage({
          source: "NDRH_PAGE",
          type: "PAYMENT_HANDOFF_STARTED",
          buttonText
        }, "*");

        // Post the status first, then trigger the site's actual visible Next
        // button. The reservation page may attach its own click handler before
        // the browser performs the form submission.
        setTimeout(() => {
          control.click();
        }, FINAL_CONFIRM_SETTLE_MS);
      } catch (error) {
        workflowError(String(error?.message || error));
      }
      return;
    }

    if (msg.type === "COMPLETE_RESERVATION") {
      try {
        const terms = document.querySelector("#terms-and-conditions");
        if (!terms || terms.disabled) throw new Error("Could not find an enabled Terms and Conditions checkbox");
        if (!terms.checked) {
          terms.click();
          terms.dispatchEvent(new Event("input", { bubbles: true }));
          terms.dispatchEvent(new Event("change", { bubbles: true }));
        }
        if (!terms.checked) throw new Error("Terms and Conditions were not accepted");

        const completeControls = [...document.querySelectorAll('button[type="submit"], input[type="submit"]')]
          .filter(isVisible)
          .filter(element => /\bcomplete\b/i.test(String(element.innerText || element.value || element.getAttribute("aria-label") || "")));
        if (completeControls.length !== 1) {
          throw new Error("Could not identify one unambiguous enabled Complete control");
        }
        const control = completeControls[0];
        if (control.disabled) throw new Error("The Complete control did not become enabled after accepting Terms and Conditions");
        window.postMessage({ source: "NDRH_PAGE", type: "COMPLETE_SUBMISSION_STARTED" }, "*");
        setTimeout(() => {
          const form = control.closest?.("form");
          if (form && typeof form.requestSubmit === "function") form.requestSubmit(control);
          else control.click();
        }, FINAL_CONFIRM_SETTLE_MS);
      } catch (error) {
        workflowError(String(error?.message || error));
      }
      return;
    }

    if (msg.type === "SET_PHONE_NUMBER") {
      const phone = document.querySelector("#phone-number");
      if (!phone) return;
      try {
        if (window.jQuery?.fn?.intlTelInput) {
          window.jQuery(phone).intlTelInput("setNumber", msg.phoneNumber || "");
        } else {
          phone.value = msg.phoneNumber || "";
          phone.dispatchEvent(new Event("input", { bubbles: true }));
          phone.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } catch (_) {
        phone.value = msg.phoneNumber || "";
        phone.dispatchEvent(new Event("input", { bubbles: true }));
        phone.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }

    if (msg.type !== "GET_TIMESLOTS") return;

    const requestId = msg.requestId;
    try {
      // Mirror the page's own request context. Availability can vary by ticket
      // type, quantity, event, and timeslot group, so do not use fixed values.
      const body = new URLSearchParams({
        tag: document.documentElement.getAttribute("data-tag") || "",
        eventId: window.eventId ? String(window.eventId) : "",
        productEventId: window.productEventId ? String(window.productEventId) : "",
        ticketDate: msg.date,
        timeslotsGroup: window.timeslotsGroup ? String(window.timeslotsGroup) : "",
        streetname: window.streetname ? String(window.streetname) : ""
      });

      const pageTicketNumbers = window.ticketNumbers && typeof window.ticketNumbers === "object"
        ? Object.entries(window.ticketNumbers)
        : [];
      const selectedTicketNumbers = pageTicketNumbers.length
        ? pageTicketNumbers
        : [...document.querySelectorAll(
            '#tickets-section select[name^="tickets["], #tickets-section select[name^="ticketNumbers["'
          )]
            .map(select => {
              const name = select.name || "";
              const start = name.startsWith("tickets[") ? 8 : 14;
              return [name.slice(start, -1), select.value];
            })
            .filter(([, count]) => Number(count) > 0);

      if (!selectedTicketNumbers.length) {
        throw new Error("Select visitor tickets on the reservation page before monitoring availability");
      }

      let selectedTotal = 0;
      for (const [ticketTypeId, count] of selectedTicketNumbers) {
        const quantity = Number(count) || 0;
        body.append(`ticketNumbers[${ticketTypeId}]`, String(quantity));
        selectedTotal += quantity;
      }

      body.set("ticketNumber", String(Number(window.ticketsTotalNumber) || selectedTotal));

      const response = await fetch("/script/timeslots", {
        method: "POST",
        credentials: "include",
        headers: {
          "Accept": "application/json, text/javascript, */*; q=0.01",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest"
        },
        body
      });

      const text = await response.text();
      let data = null;
      let parseError = null;
      try {
        data = JSON.parse(text);
      } catch (_) {
        parseError = `Expected JSON but received HTTP ${response.status}: ${text.slice(0, 160)}`;
      }

      window.postMessage({
        source: "NDRH_PAGE",
        type: "TIMESLOTS_RESULT",
        requestId,
        ok: response.ok,
        status: response.status,
        data,
        error: parseError
      }, "*");
    } catch (error) {
      window.postMessage({
        source: "NDRH_PAGE",
        type: "TIMESLOTS_RESULT",
        requestId,
        ok: false,
        error: String(error?.message || error)
      }, "*");
    }
  });
})();
