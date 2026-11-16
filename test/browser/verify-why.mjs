/**
 * "Why", in a real browser: the way into the marking from which a transition can never fire again.
 *
 * "Not live" says that something is lost; this lets the reader watch where. The way is computed
 * where the state space is, in the worker, and loaded into the simulation like "Way there".
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

const result = await page.evaluate(async () => {
  const m = window.ptn;
  const factory = m.get('elementFactory');
  const modeling = m.get('modeling');
  const registry = m.get('elementRegistry');
  const simulation = m.get('simulation');
  const root = m.get('canvas').getRootElement();

  const place = (x, y, name, marking) => {
    const shape = modeling.createShape(factory.createShape({ type: 'ptn:Place' }), { x, y }, root);
    modeling.updateLabel(shape, name);
    if (marking) modeling.updateProperty(shape, 'initialMarking', marking, { rerender: true });
    return shape;
  };
  const transition = (x, y, name) => {
    const shape = modeling.createShape(factory.createShape({ type: 'ptn:Transition' }), { x, y }, root);
    modeling.updateLabel(shape, name);
    return shape;
  };
  const connect = (a, b) => modeling.connect(a, b, { type: 'ptn:Arc' });

  // Work and Rest go round between P and Q. From Q, Leave goes to Z, where Spin goes round for ever:
  // after Leave, Work and Rest can never fire again, and nothing is stuck.
  const p = place(150, 200, 'P', 1);
  const q = place(400, 200, 'Q');
  const z = place(650, 200, 'Z');
  const work = transition(275, 150, 'Work');
  const rest = transition(275, 260, 'Rest');
  const leave = transition(525, 200, 'Leave');
  const spin = transition(650, 320, 'Spin');
  connect(p, work); connect(work, q); connect(q, rest); connect(rest, p);
  connect(q, leave); connect(leave, z); connect(z, spin); connect(spin, z);

  m.get('findingsPanel').open();
  await m.get('findingsPanel').analyse();
  await m.get('netSearch').idle();
  await new Promise((resolve) => setTimeout(resolve, 50));

  const rows = [...document.querySelectorAll('.ptn-finding')].map((row) => ({
    rule: row.querySelector('.ptn-finding-rule')?.textContent,
    message: row.querySelector('.ptn-finding-message')?.textContent ?? '',
    actions: [...row.querySelectorAll('.ptn-finding-action')].map((b) => ({ text: b.textContent, label: b.getAttribute('aria-label'), title: b.title })),
    row,
  }));
  const forWork = rows.find((row) => row.rule === 'PT16' && /^Work /.test(row.message));
  const forSpin = rows.find((row) => row.rule === 'PT16' && /^Spin /.test(row.message));
  const why = forWork?.actions.find((a) => /Why/.test(a.text));

  const button = [...forWork.row.querySelectorAll('.ptn-finding-action')].find((b) => /Why/.test(b.textContent));
  button.click();
  const note = document.querySelector('.ptn-findings-note')?.textContent ?? '';
  const loaded = { active: simulation.active, undone: simulation.undone.length };
  simulation.stepForward();
  simulation.stepForward();
  const end = {
    marking: [...simulation.marking.entries()].filter(([, held]) => held > 0).map(([id]) => registry.get(id).businessObject.name),
    enabled: simulation.enabled.map((id) => registry.get(id).businessObject.name),
  };

  return {
    workWhy: why, hasMarkingRows: rows.filter((row) => row.rule === 'PT16').length,
    spinHasWhy: forSpin?.actions.some((a) => /Why/.test(a.text)) ?? null,
    spinPresent: Boolean(forSpin),
    note, loaded, end,
    noteLive: document.querySelector('.ptn-findings-note')?.getAttribute('aria-live'),
    symbolHidden: Boolean(document.querySelector('.ptn-finding-action [aria-hidden="true"]')),
  };
});

await browser.close();
server.close();

const problems = [];
const check = (condition, message) => { if (!condition) problems.push(message); };

check(result.hasMarkingRows >= 2, `only ${result.hasMarkingRows} findings say that a transition is not live`);
check(result.workWhy && result.workWhy.text === '▶ Why', `Work offers ${JSON.stringify(result.workWhy)}`);
check(/2 firings into a marking from which Work can never fire again/.test(result.workWhy?.title ?? ''), `the title reads '${result.workWhy?.title}'`);
check(result.workWhy?.label === result.workWhy?.title, 'the button has no accessible name');
check(result.spinPresent === false || result.spinHasWhy === false, 'a transition that can always fire again is offered a Why');
check(result.loaded.active === true && result.loaded.undone === 2, `the way was loaded as ${JSON.stringify(result.loaded)}`);
check(/2 firings lead into a marking from which Work can never fire again/.test(result.note), `the note reads '${result.note}'`);
check(JSON.stringify(result.end.marking) === JSON.stringify(['Z']), `the way ends in ${JSON.stringify(result.end.marking)}`);
check(!result.end.enabled.includes('Work') && !result.end.enabled.includes('Rest'), `Work or Rest is still enabled at the end of the way: ${JSON.stringify(result.end.enabled)}`);
check(result.noteLive === 'polite', 'the note is not a live region');
check(result.symbolHidden === true, 'the symbol of an action is read out');
if (pageErrors.length) problems.push('page errors: ' + pageErrors.join('; '));

if (problems.length) {
  console.log('FAIL: ' + problems.join('; '));
  process.exitCode = 1;
} else {
  console.log('OK: Why loads the way into the marking from which a transition can never fire again');
}
