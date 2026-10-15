# Changelog

This file records the public release history. Detailed implementation evidence
lives in Git history and the offline test suite.

## 0.7.23 — 2026-09-18

- Added isolated local availability scenarios and one-time availability alerts.
- Kept local test mode free of Notre-Dame requests and page automation.

## 0.7 series

- Improved session handling, request pacing, flow-state recovery, and the
  persistent side-panel experience.
- Added explicit Watch only, Test automation, and Booking automation modes.
- Added local profiles, privacy-redacted diagnostics, local test scenarios, and
  guarded Summary/Complete-page verification.
- Kept site protections, 403 responses, order limits, and ambiguous controls as
  stop conditions.

## 0.6 series

- Added reusable core logic, offline tests, diagnostic downloads, local profile
  import/export, and conservative reservation-flow assistance.
- Added explicit session validation, 15-minute availability choices, and
  safety checks for selected date, time, visitor count, and final controls.

## 0.5 series

- Introduced opt-in automation choices, local personal-detail autofill, normal
  site-flow progression, and safe stop behavior for unavailable slots.

## 0.4 series

- Added local unit-style tests, fixture groundwork, and explicit 403 handling.

## 0.3 series

- Aligned availability detection with the site's active-slot signal and added
  diagnostic visibility for inactive slots.

## 0.2 series

- Added live availability monitoring, exact/range/any-slot planning, and
  session-aware request handling.

## 0.1 series

- Initial Manifest V3 prototype with date/time planning, visitor count,
  release-time guidance, and basic logging.
