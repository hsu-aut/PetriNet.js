/**
 * A picture of the net during a run, in a real browser.
 *
 * A picture of the net is a picture of the document: the marking that was typed,
 * and no transition marked as enabled. A run keeps its marking beside the model and
 * the drawing shows it, so without care an export during a run would carry the
 * tokens of the run. The run itself must not be disturbed by the export.
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
  const registry = modeler.get('elementRegistry');
  const simulation = modeler.get('simulation');
  const root = modeler.get('canvas').getRootElement();

  const idle = modeling.createShape(factory.createShape({ type: 'ptn:Place' }), { x: 150, y: 200 }, root);
  const go = modeling.createShape(factory.createShape({ type: 'ptn:Transition' }), { x: 300, y: 200 }, root);
  const busy = modeling.createShape(factory.createShape({ type: 'ptn:Place' }), { x: 450, y: 200 }, root);
  modeling.updateLabel(idle, 'Idle');
  modeling.updateLabel(busy, 'Busy');
  modeling.updateProperty(idle, 'initialMarking', 2, { rerender: true });
  modeling.connect(idle, go, { type: 'ptn:Arc' });
  modeling.connect(go, busy, { type: 'ptn:Arc' });

  const dots = (place) => registry.getGraphics(place).querySelectorAll('.ptn-tokens circle').length;
  const state = () => ({ idle: dots(idle), busy: dots(busy), ready: registry.getGraphics(go).classList.contains('ptn-enabled') });

  const before = (await modeler.saveSVG()).svg;

  simulation.start();
  simulation.fire(go.id);
  const running = state();
  const markingBefore = [...simulation.marking.entries()];

  const during = (await modeler.saveSVG()).svg;
  const afterExport = state();

  simulation.stop();
  const stopped = state();
  const after = (await modeler.saveSVG()).svg;

  return {
    before, during, after, running, afterExport, stopped,
    markingKept: JSON.stringify(markingBefore) === JSON.stringify([...(simulation.marking ?? new Map()).entries()]) || simulation.marking === null,
    runSteps: 1,
  };
});

await browser.close();
server.close();

const problems = [];
const check = (condition, message) => { if (!condition) problems.push(message); };

check(result.running.idle === 1 && result.running.busy === 1, `the run did not move a token: ${JSON.stringify(result.running)}`);
check(result.during === result.before, 'a picture during a run is not the picture of the document');
check(result.after === result.before, 'a picture after the run is not the picture of the document');
check(JSON.stringify(result.afterExport) === JSON.stringify(result.running),
  `the export disturbed the drawing of the run: ${JSON.stringify(result.running)} became ${JSON.stringify(result.afterExport)}`);
check(result.stopped.idle === 2 && result.stopped.busy === 0, `stopping did not put the document marking back: ${JSON.stringify(result.stopped)}`);
check(pageErrors.length === 0, 'page errors: ' + pageErrors.join('; '));

if (problems.length) {
  console.log('FAIL: ' + problems.join('; '));
  process.exitCode = 1;
} else {
  console.log('OK: a picture taken during a run shows the document, and the run goes on undisturbed');
}
