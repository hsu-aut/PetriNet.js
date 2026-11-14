/**
 * What the structure of a net says, as the list on the canvas shows it.
 *
 * The theorems and the verdicts are tested without a browser. What needs one is
 * the list: whether the class is a row of its own, whether a statement that was
 * proven carries the tag that tells it from one the search found, and whether a
 * workflow net is told it is sound or not.
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
  const panel = modeler.get('findingsPanel');
  const root = modeler.get('canvas').getRootElement();

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

  const rows = () => [...document.querySelectorAll('.ptn-finding')].map((row) => ({
    rule: row.querySelector('.ptn-finding-rule')?.textContent,
    severity: [...row.classList].find((name) => /ptn-finding-(error|warning|information)/.test(name))?.replace('ptn-finding-', ''),
    message: row.querySelector('.ptn-finding-message')?.textContent ?? '',
    proof: row.querySelector('.ptn-finding-proof')?.textContent ?? null,
    proofTitle: row.querySelector('.ptn-finding-proof')?.title ?? null,
    ruleTitle: row.querySelector('.ptn-finding-rule')?.title ?? null,
  }));

  // 1. One cycle: a state machine, live, bounded.
  const a = place(150, 150, 'Idle', 1);
  const b = place(350, 150, 'Busy');
  const t = transition(250, 100, 'Start');
  const u = transition(250, 220, 'Stop');
  connect(a, t); connect(t, b); connect(b, u); connect(u, a);
  await panel.analyse();
  const cycle = rows();
  const classes = modeler.get('findings').all.length;

  // 2. A sequence from a start place to an end place: a sound workflow net.
  modeler.get('commandStack').undo();
  while (modeler.get('commandStack').canUndo()) modeler.get('commandStack').undo();
  const i = place(100, 150, 'In', 1);
  const m = place(300, 150, 'Mid');
  const o = place(500, 150, 'Out');
  const first = transition(200, 150, 'First');
  const second = transition(400, 150, 'Second');
  connect(i, first); connect(first, m); connect(m, second); connect(second, o);
  await panel.analyse();
  const sound = rows();

  // 3. The same net, started with no token drawn: still checked from one token in In.
  modeling.updateProperty(i, 'initialMarking', 0, { rerender: true });
  await panel.analyse();
  const undrawn = rows();

  return { cycle, classes, sound, undrawn };
});

await browser.close();
server.close();

const problems = [];
const check = (condition, message) => { if (!condition) problems.push(message); };
const of = (rows, rule) => rows.filter((row) => row.rule === rule);

const klass = of(result.cycle, 'PT22');
check(klass.length === 1 && /^Net class: state machine and marked graph/.test(klass[0].message),
  `the class row reads '${klass[0]?.message}'`);
check(klass[0]?.ruleTitle === 'Net class', `the rule has the tooltip '${klass[0]?.ruleTitle}'`);
check(klass[0]?.proof === null, 'the class is marked as a proof');

const live = of(result.cycle, 'PT23');
check(live.length === 1 && /the net is live/.test(live[0].message), `the liveness row reads '${live[0]?.message}'`);
check(live[0]?.proof === '∎ proof', `the proven statement carries '${live[0]?.proof}'`);
check(/however large the state space is/.test(live[0]?.proofTitle ?? ''), 'the tag does not explain itself');
check(result.cycle.filter((row) => row.proof).every((row) => /^Proven from the structure/.test(row.message)),
  'a row carries the tag without saying that it is proven');
check(result.cycle.filter((row) => /^Proven from the structure/.test(row.message)).every((row) => row.proof),
  'a proven statement carries no tag');

const verdict = of(result.sound, 'PT25');
check(verdict.length === 1 && verdict[0].severity === 'information' && /^Sound workflow net/.test(verdict[0].message),
  `a sound workflow net is told '${verdict[0]?.message}'`);
const end = of(result.sound, 'PT15');
check(end.length === 1 && end[0].severity === 'information' && /ends here, as it should/.test(end[0].message),
  `the proper end is read as '${end[0]?.message}'`);
check(of(result.sound, 'PT23').length === 0, 'a net that ends is told it is not live');

const undrawn = of(result.undrawn, 'PT25');
check(undrawn.length === 1 && /Started with one token in In, not as the net is drawn/.test(undrawn[0].message),
  `a net drawn without its token is told '${undrawn[0]?.message}'`);

if (pageErrors.length) problems.push('page errors: ' + pageErrors.join('; '));

if (problems.length) {
  console.log('FAIL: ' + problems.join('; '));
  process.exitCode = 1;
} else {
  console.log('OK: the class, the proofs and the verdict on a workflow net show up in the list');
}
