/**
 * The play clock must end with the run, however the run ends.
 *
 * A host stops a run through the simulation service, not through the bar's Stop
 * button. If the clock kept ticking, it would fire into the next run.
 */
import { chromium } from 'playwright';
import { serve } from './serve.mjs';

const { server, port } = await serve();
const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

await page.goto(`http://127.0.0.1:${port}/index.html`);
await page.waitForFunction(() => window.ptnReady === true, null, { timeout: 15000 });

const result = await page.evaluate(async () => {
  const modeler = window.ptn;
  const factory = modeler.get('elementFactory');
  const modeling = modeler.get('modeling');
  const simulation = modeler.get('simulation');
  const root = modeler.get('canvas').getRootElement();

  // A loop that can fire for ever: Idle -> Go -> Idle, one token.
  const idle = modeling.createShape(factory.createShape({ type: 'ptn:Place' }), { x: 120, y: 160 }, root);
  const go = modeling.createShape(factory.createShape({ type: 'ptn:Transition' }), { x: 260, y: 160 }, root);
  modeling.updateLabel(idle, 'Idle');
  modeling.updateLabel(go, 'Go');
  modeling.updateProperty(idle, 'initialMarking', 1, { rerender: true });
  modeling.connect(idle, go, { type: 'ptn:Arc' });
  modeling.connect(go, idle, { type: 'ptn:Arc' });

  const pick = document.querySelector('.ptn-simulation-speed');
  pick.value = [...pick.options].reduce((a, o) => (Number(o.value) > Number(a.value) ? o : a)).value;
  pick.dispatchEvent(new Event('change'));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  document.querySelector('.ptn-simulation-toggle').click();
  document.querySelector('.ptn-simulation-play').click();
  simulation.stop('a host stopped it');
  simulation.start();
  const startedWith = simulation.steps.length;
  await wait(Number(pick.value) * 1.2 + 200);
  const after = simulation.steps.length;
  simulation.stop();
  return { startedWith, after };
});

await browser.close();
server.close();

const problems = [];
if (result.startedWith !== 0) problems.push(`the new run started with ${result.startedWith} firings`);
if (result.after !== 0) problems.push(`the old clock fired ${result.after} time(s) into the new run`);
if (pageErrors.length) problems.push('page errors: ' + pageErrors.join('; '));

if (problems.length) {
  console.log('FAIL: ' + problems.join('; '));
  process.exitCode = 1;
} else {
  console.log('OK: a run stopped from outside takes its play clock with it');
}
