// Offline regression checks against the actual bridge and content functions.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

async function main() {
  let listener;
  let refreshes = 0;
  const window = {
    settingsDisplayInactiveTimeslots: false,
    addEventListener: (_, callback) => { listener = callback; },
    postMessage() {},
    ticketDateChosen() { refreshes++; }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'page-bridge.js'), 'utf8'), {
    window, document: { querySelector: () => ({ value: '2026-09-09' }) }
  });
  const toggle = enabled => listener({ source: window, data: {
    source: 'NDRH_EXTENSION', type: 'SET_SHOW_INACTIVE', enabled
  } });
  await toggle(false);
  await toggle(false);
  assert.equal(refreshes, 0, 'unchanged off must make no native refresh');
  await toggle(true);
  await toggle(true);
  assert.equal(refreshes, 1, 'only a changed setting refreshes');
  await toggle(false);
  assert.equal(refreshes, 2, 'turning diagnostics off restores the page once');

  const source = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
  const startLoop = source.slice(source.indexOf('  async function startLoop()'), source.indexOf('  async function validateSession()'));
  let requests = 0;
  let scheduled;
  const context = {
    state: null, timer: null, loopGeneration: 0,
    chrome: { runtime: { sendMessage: async () => ({ enabled: true, pollSeconds: 30 }) } },
    updateOverlay() {}, recordWorkflowPage: async () => ({ stage: 'date' }),
    injectBridge() {}, setPageShowInactive() {}, isTicketsPage: () => false,
    ensurePageSettled: async () => {}, inspectRenderedSelectableTimes: () => null,
    stopRenderedSlotWatch() {}, watchForRenderedSlot() {},
    log: async () => {}, tick: async () => { requests++; },
    setTimeout: (callback, delay) => { scheduled = { callback, delay }; return 1; }
  };
  context.stopLoop = () => { context.loopGeneration++; };
  vm.createContext(context);
  vm.runInContext(startLoop, context);
  await context.startLoop();
  assert.equal(requests, 0, 'starting must not make an immediate helper request');
  assert.equal(scheduled.delay, 30000);
  await scheduled.callback();
  assert.equal(requests, 1);
  const stale = scheduled.callback;
  context.stopLoop();
  await stale();
  assert.equal(requests, 1, 'stopped loops must not resume');

  let renderedWatch;
  let renderedPoll;
  const renderedContext = {
    state: null, timer: null, loopGeneration: 0,
    chrome: { runtime: { sendMessage: async () => ({ enabled: true, autoSelect: true, pollSeconds: 30 }) } },
    updateOverlay() {}, recordWorkflowPage: async () => ({ stage: 'date' }),
    injectBridge() {}, setPageShowInactive() {}, isTicketsPage: () => false,
    ensurePageSettled: async () => {}, continueFromRenderedSlot: async () => false,
    stopRenderedSlotWatch() {}, log: async () => {}, tick: async () => {},
    watchForRenderedSlot: (_, delay) => { renderedWatch = delay; },
    setTimeout: (callback, delay) => { renderedPoll = { callback, delay }; return 1; }
  };
  renderedContext.stopLoop = () => { renderedContext.loopGeneration++; };
  vm.createContext(renderedContext);
  vm.runInContext(startLoop, renderedContext);
  await renderedContext.startLoop();
  assert.equal(renderedWatch, 30000, 'late site-rendered slots must be watched through the first fallback interval');
  assert.equal(renderedPoll.delay, 30000, 'the normal helper fallback remains scheduled');
  console.log('Request pacing regressions passed (offline).');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
