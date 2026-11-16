/**
 * The searches in a worker, in a real browser.
 *
 * What the node tests cannot see: that a worker really starts from a Blob in a
 * browser, that the page stays alive while it searches, that stopping and
 * editing end the search and leave a list that says why, and that a policy that
 * forbids workers leaves the modeler working as it did before.
 */
import { chromium } from 'playwright';
import { serve } from './serve.mjs';

const { server, port } = await serve();
const browser = await chromium.launch();
const problems = [];
const check = (condition, message) => { if (!condition) problems.push(message); };
const pageErrors = [];

async function open(query = '', before = async () => {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const warnings = [];
  page.on('console', (message) => { if (message.type() === 'warning') warnings.push(message.text()); });
  await before(page);
  await page.goto(`http://127.0.0.1:${port}/index.html${query}`);
  await page.waitForFunction(() => window.ptnReady === true, null, { timeout: 15000 });
  return { page, warnings };
}

/** More than the panel's own limits, so that the search takes seconds and not a moment. */
const BIG = { markings: 100000, milliseconds: 60000 };

/** Places that each lose their token on their own: 2^n reachable markings. */
const build = (page, count) => page.evaluate((n) => {
  const m = window.ptn;
  const factory = m.get('elementFactory');
  const modeling = m.get('modeling');
  const root = m.get('canvas').getRootElement();
  for (let i = 0; i < n; i += 1) {
    const x = 100 + (i % 7) * 120;
    const y = 120 + Math.floor(i / 7) * 120;
    const p = modeling.createShape(factory.createShape({ type: 'ptn:Place' }), { x, y }, root);
    modeling.updateProperty(p, 'initialMarking', 1, { rerender: true });
    const t = modeling.createShape(factory.createShape({ type: 'ptn:Transition' }), { x: x + 50, y }, root);
    modeling.connect(p, t, { type: 'ptn:Arc' });
  }
}, count);

// How big a net has to be for the search to take long enough to measure. Machines differ by a factor of
// several, so the size is found by trying: the smallest net whose search on the page takes 1.5 s.
async function calibrate() {
  for (let n = 12; n <= 18; n += 1) {
    const trial = await open('?worker=off');
    await build(trial.page, n);
    const took = await trial.page.evaluate(async (limits) => {
      const started = performance.now();
      await window.ptn.get('findings').analyse(limits);
      return performance.now() - started;
    }, BIG);
    await trial.page.close();
    if (took >= 1500) return n;
  }
  return 18;
}
const SIZE = await calibrate();

// ── a worker starts, and the page stays alive while it searches ────────────
const worker = await open();
const workers = [];
worker.page.on('worker', (w) => workers.push(w));
await build(worker.page, SIZE);

const live = await worker.page.evaluate(async (limits) => {
  const search = window.ptn.get('netSearch');
  const gaps = [];
  let last = performance.now();
  const timer = setInterval(() => { const now = performance.now(); gaps.push(now - last); last = now; }, 20);

  const started = performance.now();
  window.ptn.get('findingsPanel').open();
  const running = window.ptn.get('findings').analyse(limits);
  const during = {
    busy: window.ptn.get('findings').busy,
    row: document.querySelector('.ptn-findings-busy')?.textContent ?? null,
    button: document.querySelector('.ptn-findings-button').textContent,
    disabled: document.querySelector('.ptn-findings-button').disabled,
    stop: Boolean(document.querySelector('.ptn-findings-stop')),
  };
  await running;
  clearInterval(timer);
  return {
    mode: search.mode,
    during,
    milliseconds: performance.now() - started,
    longest: gaps.length ? Math.max(...gaps) : performance.now() - started,
    markings: window.ptn.get('findings').all.length,
    after: { busy: window.ptn.get('findings').busy, button: document.querySelector('.ptn-findings-button').textContent },
  };
}, BIG);

check(live.mode === 'worker', `the search ran in mode '${live.mode}'`);
check(workers.length >= 1, 'the browser saw no worker');
check(live.during.busy === true && /^Analysing/.test(live.during.row ?? ''), `the list did not say it was working: '${live.during.row}'`);
check(live.during.button === 'Analysing…' && live.during.disabled === true, 'the button did not say it was working');
check(live.during.stop === true, 'there is no way to stop it');
check(live.milliseconds > 1000, `the search took only ${Math.round(live.milliseconds)} ms, too short to show that the page stays alive`);
check(live.longest < 400, `the page was blocked for ${Math.round(live.longest)} ms while the worker searched`);
check(live.after.busy === false && live.after.button === 'Analyse', 'the list still says it is working after the answer');
check(live.markings > 0, 'the analysis gave no findings');

// ── the same net on the page freezes it, so the check above measures something ─
const inline = await open('?worker=off');
await build(inline.page, SIZE);
const frozen = await inline.page.evaluate(async (limits) => {
  const gaps = [];
  let last = performance.now();
  const timer = setInterval(() => { const now = performance.now(); gaps.push(now - last); last = now; }, 20);
  const started = performance.now();
  window.ptn.get('findingsPanel').open();
  await window.ptn.get('findings').analyse(limits);
  clearInterval(timer);
  // A page that is blocked does not tick at all, so the time it took is the time it was blocked.
  return {
    mode: window.ptn.get('netSearch').mode,
    longest: Math.max(performance.now() - started - 50, gaps.length ? Math.max(...gaps) : 0),
    count: window.ptn.get('findings').all.length,
  };
}, BIG);
check(frozen.mode === 'inline', `the page search ran in mode '${frozen.mode}'`);
check(frozen.longest > 1000, `the page was blocked for only ${Math.round(frozen.longest)} ms without a worker, so the check proves nothing`);
check(frozen.count === live.markings, `worker and page gave ${live.markings} and ${frozen.count} findings`);
await inline.page.close();

// ── worker and page give the same state space ──────────────────────────────
const states = async (page) => {
  await build(page, 6);
  return page.evaluate(async () => {
    const view = window.ptn.get('reachabilityView');
    const state = await view.show();
    return { state, title: document.querySelector('.ptn-states-title').textContent };
  });
};
const fromWorker = await open();
const a = await states(fromWorker.page);
const fromPage = await open('?worker=off');
const b = await states(fromPage.page);
check(JSON.stringify(a) === JSON.stringify(b) && a.state.markings === 64, `the state spaces differ: ${JSON.stringify(a)} against ${JSON.stringify(b)}`);
await fromWorker.page.close();
await fromPage.page.close();

// ── stopping, and an edit during the search ────────────────────────────────
const stop = await open();
await build(stop.page, SIZE);
const stopped = await stop.page.evaluate(async (limits) => {
  window.ptn.get('findingsPanel').open();
  const running = window.ptn.get('findings').analyse(limits);
  await new Promise((resolve) => setTimeout(resolve, 100));
  document.querySelector('.ptn-findings-stop').click();
  const answer = await running;
  return {
    answer,
    busy: window.ptn.get('findings').busy,
    stopped: window.ptn.get('netSearch').busy(),
    rows: [...document.querySelectorAll('.ptn-finding')].map((row) => row.textContent),
    button: document.querySelector('.ptn-findings-button').textContent,
  };
}, BIG);
check(stopped.answer === null && stopped.busy === false && stopped.stopped === false, 'Stop did not end the search');
check(stopped.rows.some((row) => /The analysis was stopped\. Analyse again\./.test(row)), `Stop left '${stopped.rows}'`);
check(stopped.button === 'Analyse', 'the button did not come back after Stop');

const edited = await stop.page.evaluate(async (limits) => {
  window.ptn.get('findingsPanel').open();
  const running = window.ptn.get('findings').analyse(limits);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const modeling = window.ptn.get('modeling');
  const place = window.ptn.get('elementRegistry').filter((e) => e.type === 'ptn:Place')[0];
  modeling.updateLabel(place, 'Changed');
  const answer = await running;
  return {
    answer,
    busy: window.ptn.get('netSearch').busy(),
    stale: window.ptn.get('findings').stale,
    rows: [...document.querySelectorAll('.ptn-finding')].map((row) => row.textContent),
  };
}, BIG);
check(edited.answer === null && edited.busy === false, 'an edit did not end the search');
check(edited.stale === true && edited.rows.some((row) => /The net changed/.test(row)), `an edit left '${edited.rows}'`);

// The next analysis works after both.
const again = await stop.page.evaluate(async () => (await window.ptn.get('findingsPanel').analyse())?.length);
check(again > 0, 'the analysis does not work after a stop and an edit');
await stop.page.close();

// ── the state space: busy, Stop, and a question asked while it searches ───
const view = await open();
await build(view.page, SIZE);
const stateSearch = await view.page.evaluate(async (limits) => {
  const v = window.ptn.get('reachabilityView');
  const running = v.show(limits);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const during = {
    busy: v.busy,
    title: document.querySelector('.ptn-states-title').textContent,
    stopShown: !document.querySelector('.ptn-states-stop').hidden,
  };
  // A question asked now is answered when the search has finished, not before.
  const asked = v.ask('p0 = 1');
  document.querySelector('.ptn-states-stop').click();
  const answer = await running;
  return {
    during,
    answer,
    busy: v.busy,
    title: document.querySelector('.ptn-states-title').textContent,
    stopShown: !document.querySelector('.ptn-states-stop').hidden,
    asked: await asked,
    searching: window.ptn.get('netSearch').busy(),
  };
}, BIG);
check(stateSearch.during.busy === true && /^Searching/.test(stateSearch.during.title) && stateSearch.during.stopShown, `the state space did not say it searched: ${JSON.stringify(stateSearch.during)}`);
check(stateSearch.answer === null && stateSearch.busy === false && stateSearch.stopShown === false && /stopped/.test(stateSearch.title), `Stop on the state space left ${JSON.stringify(stateSearch)}`);
check(typeof stateSearch.asked === 'string' && stateSearch.asked.length > 0, 'a question asked during the search was not answered');
check(stateSearch.searching === false, 'the state space search was still running after Stop');
await view.page.close();

// ── searching further: ten times the limits, once, only with a worker ──────
const further = await open();
await build(further.page, 6); // 64 markings
const cutOff = await further.page.evaluate(async () => {
  window.ptn.get('findingsPanel').open();
  await window.ptn.get('findings').analyse({ markings: 10 });
  const actions = () => [...document.querySelectorAll('.ptn-finding-action')].map((button) => button.title);
  const before = {
    rows: [...document.querySelectorAll('.ptn-finding')].map((row) => row.querySelector('.ptn-finding-rule')?.textContent),
    offered: actions().filter((label) => /ten times the limits/.test(label ?? '')),
    visible: [...document.querySelectorAll('.ptn-finding-action')].some((button) => /Search further/.test(button.textContent)),
  };
  const button = [...document.querySelectorAll('.ptn-finding-action')].find((b) => /Search further/.test(b.textContent));
  button?.click();
  const busyNow = window.ptn.get('findings').busy;
  const busyRow = String(window.ptn.get('findings').progress?.limit ?? '');
  await window.ptn.get('netSearch').idle();
  await new Promise((resolve) => setTimeout(resolve, 50));
  return {
    before, busyNow, busyRow,
    after: {
      rules: [...document.querySelectorAll('.ptn-finding')].map((row) => row.querySelector('.ptn-finding-rule')?.textContent),
      offered: [...document.querySelectorAll('.ptn-finding-action')].some((b) => /Search further/.test(b.textContent)),
      complete: window.ptn.get('findings').canSearchFurther,
    },
  };
});
check(cutOff.before.rows.includes('PT17'), 'a search cut off at ten markings gave no PT17');
check(cutOff.before.visible && cutOff.before.offered.length === 1 && /up to 100 markings/.test(cutOff.before.offered[0]),
  `the PT17 row offers ${JSON.stringify(cutOff.before.offered)}`);
check(cutOff.busyNow === true && cutOff.busyRow === '100', `the further search ran with a limit of '${cutOff.busyRow}' markings`);
check(!cutOff.after.rules.includes('PT17') && cutOff.after.offered === false, 'after a further search that was enough, the list still offers one');
await further.page.close();

const noWorker = await open('?worker=off');
await build(noWorker.page, 6);
const inlineOffer = await noWorker.page.evaluate(async () => {
  window.ptn.get('findingsPanel').open();
  await window.ptn.get('findings').analyse({ markings: 10 });
  return [...document.querySelectorAll('.ptn-finding-action')].some((b) => /Search further/.test(b.textContent));
});
check(inlineOffer === false, 'a further search is offered without a worker');
await noWorker.page.close();

const stopFurther = await open();
await build(stopFurther.page, SIZE);
const stoppedFurther = await stopFurther.page.evaluate(async (size) => {
  window.ptn.get('findingsPanel').open();
  await window.ptn.get('findings').analyse({ markings: 2000, milliseconds: 60000 });
  const first = [...document.querySelectorAll('.ptn-finding')].map((row) => row.textContent);
  const button = [...document.querySelectorAll('.ptn-finding-action')].find((b) => /Search further/.test(b.textContent));
  button?.click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const duringBusy = window.ptn.get('findings').busy;
  document.querySelector('.ptn-findings-stop')?.click();
  await window.ptn.get('netSearch').idle();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const rows = [...document.querySelectorAll('.ptn-finding')].map((row) => row.textContent);
  return { size, hadButton: Boolean(button), duringBusy, first: first.length, rows };
}, SIZE);
check(stoppedFurther.hadButton && stoppedFurther.duringBusy === true, 'the further search did not start on the large net');
check(stoppedFurther.rows.some((text) => /further search was stopped; this is the earlier answer/.test(text)), `Stop left '${stoppedFurther.rows.slice(-2)}'`);
check(stoppedFurther.rows.length >= stoppedFurther.first, 'Stop did not bring the earlier list back');
await stopFurther.page.close();

const furtherView = await open();
await build(furtherView.page, 6);
const viewResult = await furtherView.page.evaluate(async () => {
  const v = window.ptn.get('reachabilityView');
  await v.show({ markings: 10 });
  const offered = !document.querySelector('.ptn-states-further').hidden;
  const first = v.state;
  document.querySelector('.ptn-states-further').click();
  await window.ptn.get('netSearch').idle();
  await new Promise((resolve) => setTimeout(resolve, 80));
  return { offered, first, second: v.state, hidden: document.querySelector('.ptn-states-further').hidden };
});
check(viewResult.offered && viewResult.first.markings <= 10 && viewResult.first.complete === false, `the state space of a cut off search: ${JSON.stringify(viewResult)}`);
check(viewResult.second.markings === 64 && viewResult.second.complete === true && viewResult.hidden === true, `after a further search: ${JSON.stringify(viewResult.second)}`);
await furtherView.page.close();

// ── the element search of diagram-js still works: the service of the worker has its own name ──
const finder = await open();
await build(finder.page, 3);
await finder.page.evaluate(() => window.ptn.get('canvas').focus());
await finder.page.keyboard.press('Control+f');
await finder.page.waitForTimeout(150);
await finder.page.keyboard.type('p');
await finder.page.waitForTimeout(150);
check(await finder.page.evaluate(() => window.ptn.get('searchPad').isOpen()), 'Ctrl+F does not open the search of elements');
await finder.page.keyboard.press('Escape');
await finder.page.close();

// ── a policy that forbids workers: the same answers from the page ──────────
const policy = await open('', async (page) => {
  await page.route('**/index.html', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': "worker-src 'none'" } });
  });
});
await build(policy.page, 6);
const governed = await policy.page.evaluate(async () => {
  const answer = await window.ptn.get('findingsPanel').analyse();
  return { count: answer?.length, mode: window.ptn.get('netSearch').mode };
});
check(governed.mode === 'inline', `with worker-src 'none' the search ran in mode '${governed.mode}'`);
check(governed.count > 0, 'with worker-src \'none\' the analysis gave nothing');
check(policy.warnings.some((text) => /not in a worker/.test(text)), 'the fall back did not warn on the console');
await policy.page.close();

await browser.close();
server.close();

if (pageErrors.length) problems.push('page errors: ' + pageErrors.join('; '));

if (problems.length) {
  console.log('FAIL: ' + problems.join('; '));
  process.exitCode = 1;
} else {
  console.log('OK: the search runs in a worker and keeps the page alive; stopping, editing and a worker ban behave');
}
