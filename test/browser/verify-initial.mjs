/**
 * Taking the marking of a run as the initial marking of the net, in a real browser.
 *
 * A run never changes the document. This button is the one way from a run to it, and it is an
 * edit like typing the numbers: one command, one step of undo, one change for the host. The
 * run ends, the drawing does not jump, and Ctrl+Z takes it all back.
 */
import { chromium } from 'playwright';
import { serve } from './serve.mjs';

const { server, port } = await serve();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

await page.goto(`http://127.0.0.1:${port}/index.html`);
await page.waitForFunction(() => window.ptnReady === true, null, { timeout: 15000 });

const problems = [];
const check = (condition, message) => { if (!condition) problems.push(message); };
const ev = (fn, arg) => page.evaluate(fn, arg);
const steps = () => ev(() => {
  const stack = window.ptn.get('commandStack');
  return new Set(stack._stack.slice(0, stack._stackIdx + 1).map((entry) => entry.id)).size;
});

// Idle (2) -> Work -> Busy -> Rest -> Idle: a net with a few markings to walk through.
const ids = await ev(() => {
  const m = window.ptn;
  const factory = m.get('elementFactory');
  const modeling = m.get('modeling');
  const root = m.get('canvas').getRootElement();
  const place = (x, y, name, marking) => {
    const shape = modeling.createShape(factory.createShape({ type: 'ptn:Place' }), { x, y }, root);
    modeling.updateLabel(shape, name);
    if (marking) modeling.updateProperty(shape, 'initialMarking', marking, { rerender: true });
    return shape;
  };
  const idle = place(200, 250, 'Idle', 2);
  const work = modeling.createShape(factory.createShape({ type: 'ptn:Transition' }), { x: 360, y: 200 }, root);
  const busy = place(520, 250, 'Busy', 0);
  const rest = modeling.createShape(factory.createShape({ type: 'ptn:Transition' }), { x: 360, y: 320 }, root);
  modeling.connect(idle, work, { type: 'ptn:Arc' });
  modeling.connect(work, busy, { type: 'ptn:Arc' });
  modeling.connect(busy, rest, { type: 'ptn:Arc' });
  modeling.connect(rest, idle, { type: 'ptn:Arc' });
  return { idle: idle.id, busy: busy.id, work: work.id, rest: rest.id };
});

const adopt = page.locator('.ptn-simulation-adopt');
const dots = (id) => ev((x) => window.ptn.get('elementRegistry').getGraphics(x).querySelectorAll('.ptn-tokens circle').length, id);

// ── outside a run: not there ───────────────────────────────────────────────
check(await adopt.isHidden(), 'the button is shown outside a run');

// ── in a run at the document's marking: shown, and nothing to adopt ────────
await ev(() => window.ptn.get('simulation').start());
await page.waitForTimeout(50);
check(await adopt.isVisible(), 'the button is not shown during a run');
check(await adopt.isDisabled(), 'the button is offered at the marking the document already holds');
check(await ev(() => window.ptn.get('simulation').setAsInitial()) === false, 'setAsInitial did something at the document marking');

// ── fire twice, take the marking ───────────────────────────────────────────
await ev((id) => { const s = window.ptn.get('simulation'); s.fire(id); s.fire(id); }, ids.work);
await page.waitForTimeout(50);
check(await adopt.isEnabled(), 'the button is not offered at a marking that differs');
const pnmlBefore = await ev(() => window.ptn.savePNML());
const before = await steps();
const drawn = { idle: await dots(ids.idle), busy: await dots(ids.busy) };
await ev(() => window.ptn.get('eventBus').on('simulation.changed', (e) => { window.__lastProblem = e.problem; }));
await adopt.click();
await page.waitForTimeout(150);

const after = { idle: await dots(ids.idle), busy: await dots(ids.busy) };
check(await steps() === before + 1, `taking the marking took ${await steps() - before} steps of undo`);
check(await ev(() => window.ptn.get('simulation').active) === false, 'the run did not end');
check(JSON.stringify(drawn) === JSON.stringify(after), `the drawing jumped: ${JSON.stringify(drawn)} became ${JSON.stringify(after)}`);
check(await ev((x) => window.ptn.get('elementRegistry').get(x).businessObject.initialMarking, ids.busy) === 2, 'the document does not hold the marking of the run');
check(await ev((x) => window.ptn.get('elementRegistry').get(x).businessObject.initialMarking, ids.idle) === 0, 'a place the run emptied was not set to 0');
check(/initial marking of the net\. Ctrl\+Z takes it back/.test(await ev(() => window.__lastProblem ?? '')), 'the run did not say why it ended');
check(await adopt.isHidden(), 'the button is shown after the run ended');
check(await ev(() => document.activeElement === document.querySelector('.djs-container svg')), 'the drawing does not have the focus, so Ctrl+Z would not work');

const pnmlAfter = await ev(() => window.ptn.savePNML());
check(pnmlAfter !== pnmlBefore, 'the PNML does not hold the new marking');

// ── Ctrl+Z puts everything back, byte for byte ─────────────────────────────
await page.keyboard.press('Control+z');
await page.waitForTimeout(100);
check(await ev(() => window.ptn.savePNML()) === pnmlBefore, 'one Ctrl+Z did not restore the document');
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(100);
check(await ev(() => window.ptn.savePNML()) === pnmlAfter, 'redo did not take the marking again');

// ── a simulation starts from the new marking ───────────────────────────────
await ev(() => window.ptn.get('simulation').start());
await page.waitForTimeout(50);
check(await adopt.isDisabled(), 'a new run does not start at the marking the document holds now');
await ev(() => window.ptn.get('simulation').stop());

// ── a node of the state space, then the button ─────────────────────────────
await page.evaluate(async () => { await window.ptn.get('reachabilityView').show(); });
await page.waitForTimeout(150);
const nodes = await ev(() => document.querySelectorAll('.ptn-states-node').length);
check(nodes > 1, 'the state space has no nodes to take a marking from');
await ev(() => { [...document.querySelectorAll('.ptn-states-node')].at(-1).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
await page.waitForTimeout(100);
check(/Set as initial marking/.test(await ev(() => document.querySelector('.ptn-states-note')?.textContent ?? '')) || await adopt.isVisible(),
  'a click on a node neither says where the button is nor shows it');
const stateBefore = await steps();
if (await adopt.isEnabled()) {
  await adopt.click();
  await page.waitForTimeout(100);
  check(await steps() === stateBefore + 1, 'a marking taken from the state space was not one step');
}

// ── refused before anything is written ─────────────────────────────────────
const refused = await ev((id) => {
  const modeling = window.ptn.get('modeling');
  const steps = window.ptn.get('commandStack')._stackIdx;
  const errors = [];
  for (const bad of [{ nowhere: 1 }, { [id]: -1 }, { [id]: 1.5 }, { [id]: Infinity }]) {
    try { modeling.setInitialMarking(bad); } catch (error) { errors.push(error.message); }
  }
  return { errors: errors.length, unchanged: window.ptn.get('commandStack')._stackIdx === steps, none: modeling.setInitialMarking({}) };
}, ids.idle);
check(refused.errors === 4 && refused.unchanged, `an invalid marking was not refused before writing: ${JSON.stringify(refused)}`);

// ── narrow: the button does not cover the side row ─────────────────────────
await page.setViewportSize({ width: 600, height: 700 });
await ev(() => window.ptn.get('simulation').start());
await ev((id) => window.ptn.get('simulation').fire(id), ids.work);
await page.waitForTimeout(100);
const overlap = await ev(() => {
  const a = document.querySelector('.ptn-simulation-adopt').getBoundingClientRect();
  const row = document.querySelector('.ptn-side-row').getBoundingClientRect();
  return a.right > row.left && a.bottom > row.top && a.top < row.bottom;
});
check(!overlap, 'at 600 px the button covers the buttons on the right');

await browser.close();
server.close();

if (pageErrors.length) problems.push('page errors: ' + pageErrors.join('; '));

if (problems.length) {
  console.log('FAIL: ' + problems.join('; '));
  process.exitCode = 1;
} else {
  console.log('OK: the marking of a run becomes the initial marking in one undoable step, and the run ends without a jump');
}
