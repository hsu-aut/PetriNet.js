/**
 * The properties panel, in a real browser.
 *
 * The rules for what a person may type are tested without one. What needs a
 * browser is the behaviour around them: that the panel opens and closes and
 * says so, that a field commits one command, that a wrong value is refused and
 * writes nothing, that what was typed goes to the element it was typed for even
 * when the selection has moved, that the panel stays out of the way of a run,
 * and that a host can leave it out.
 */
import { chromium } from 'playwright';
import { serve } from './serve.mjs';

const { server, port } = await serve();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

const open = async (target) => {
  await target.goto(`http://127.0.0.1:${port}/index.html${target === page ? '' : '?properties=off'}`);
  await target.waitForFunction(() => window.ptnReady === true, null, { timeout: 15000 });
};
await open(page);

const problems = [];
const check = (condition, message) => { if (!condition) problems.push(message); };

const ev = (fn, arg) => page.evaluate(fn, arg);
// Undo steps, not stack entries: a name makes a label, sets it and resizes it, all under one id.
const steps = () => ev(() => {
  const stack = window.ptn.get('commandStack');
  return new Set(stack._stack.slice(0, stack._stackIdx + 1).map((entry) => entry.id)).size;
});

// A small net: Idle -> Work -> Busy, with a weight on the second arc.
const ids = await ev(() => {
  const m = window.ptn;
  const factory = m.get('elementFactory');
  const modeling = m.get('modeling');
  const root = m.get('canvas').getRootElement();
  const place = (x, y) => modeling.createShape(factory.createShape({ type: 'ptn:Place' }), { x, y }, root);
  const transition = (x, y) => modeling.createShape(factory.createShape({ type: 'ptn:Transition' }), { x, y }, root);
  const a = place(200, 250);
  const t = transition(380, 250);
  const b = place(560, 250);
  const first = modeling.connect(a, t, { type: 'ptn:Arc' });
  const second = modeling.connect(t, b, { type: 'ptn:Arc' });
  return { a: a.id, t: t.id, b: b.id, first: first.id, second: second.id };
});
const select = (id) => ev((x) => window.ptn.get('selection').select(window.ptn.get('elementRegistry').get(x)), id);
const bo = (id, name) => ev(([x, n]) => window.ptn.get('elementRegistry').get(x).businessObject[n], [id, name]);

// ── closed at first start, then opened by the button ───────────────────────
const card = page.locator('.ptn-properties');
const field = (name) => card.getByLabel(name, { exact: true });
const button = page.locator('.ptn-properties-button');
check(await card.isHidden(), 'the panel is open at first start');
check(await button.getAttribute('aria-expanded') === 'false', 'the button does not say the panel is closed');
await button.click();
check(await card.isVisible(), 'the button did not open the panel');
check(await button.getAttribute('aria-expanded') === 'true', 'the button does not say the panel is open');
check(/^Net: /.test(await page.locator('.ptn-properties-title').textContent()), 'with nothing selected the panel shows the net');
check(/2 place\(s\), 1 transition\(s\), 2 arc\(s\)/.test(await page.locator('.ptn-properties-text').first().textContent()),
  'the counts of the net are wrong');

// ── the name of the net ────────────────────────────────────────────────────
await field('Name').fill('Demo net');
await field('Name').press('Enter');
await page.waitForTimeout(100);
check((await ev(() => window.ptn.savePNML())).includes('Demo net'), 'the name of the net did not reach the PNML');

// ── a place: name and marking, one step each ───────────────────────────────
await select(ids.a);
await page.waitForTimeout(50);
check(/^Place: /.test(await page.locator('.ptn-properties-title').textContent()), 'a place is not shown as a place');

let before = await steps();
await field('Name').fill('Idle');
await field('Name').press('Enter');
await page.waitForTimeout(100);
check(await bo(ids.a, 'name') === 'Idle', 'the name was not written');
check(await steps() === before + 1, 'a name took more or less than one step');
check(await ev((x) => Boolean(window.ptn.get('elementRegistry').get(`${x}_label`)), ids.a), 'the name was not drawn as a label');
await ev(() => window.ptn.get('commandStack').undo());
check(!(await bo(ids.a, 'name')), 'one undo did not take the name back');
await ev(() => window.ptn.get('commandStack').redo());

before = await steps();
await field('Initial marking').fill('3');
await field('Initial marking').press('Enter');
await page.waitForTimeout(100);
check(await bo(ids.a, 'initialMarking') === 3, 'the marking was not written');
check(await steps() === before + 1, 'a marking took more or less than one step');

before = await steps();
for (const wrong of ['-1', '1.5', '1e3', 'two']) {
  await field('Initial marking').fill(wrong);
  await field('Initial marking').press('Enter');
  await page.waitForTimeout(50);
  check(await field('Initial marking').getAttribute('aria-invalid') === 'true', `'${wrong}' was not marked as wrong`);
  check(/whole number of 0 or more/.test(await page.locator('.ptn-prop-error:not([hidden])').first().textContent()), `'${wrong}' gave no reason`);
}
check(await steps() === before, 'a wrong marking wrote something');
check(await bo(ids.a, 'initialMarking') === 3, 'a wrong marking changed the marking');

// Left by blur, a wrong value goes back to the stored one.
await field('Initial marking').fill('-9');
await field('Name').focus();
await page.waitForTimeout(50);
check(await field('Initial marking').inputValue() === '3', 'a wrong value stayed in the field after the focus left it');

// The same value again writes no command.
before = await steps();
await field('Initial marking').fill('3');
await field('Initial marking').press('Enter');
await page.waitForTimeout(80);
check(await steps() === before, 'an unchanged value was written as a command');

// The id is shown and cannot be edited.
check(await field('ID').inputValue() === ids.a && await field('ID').getAttribute('readonly') !== null,
  'the id is not shown read only');

// ── a transition: silent ───────────────────────────────────────────────────
await select(ids.t);
await page.waitForTimeout(50);
before = await steps();
await field('Silent').check();
await page.waitForTimeout(100);
check(await bo(ids.t, 'isSilent') === true, 'silent was not written');
check(await steps() === before + 1, 'silent took more or less than one step');
check(await page.locator('.ptn-properties-hint').isVisible() && /name is not drawn/.test(await page.locator('.ptn-properties-hint').textContent()),
  'a silent transition is not told its name is not drawn');
await field('Silent').uncheck();
await page.waitForTimeout(100);
check(await page.locator('.ptn-properties-hint').isHidden(), 'a transition that is not silent is told its name is not drawn');
await field('Silent').check();
await page.waitForTimeout(100);

// The heading follows the name, whoever changes it.
await select(ids.a);
await page.waitForTimeout(50);
await ev((id) => window.ptn.get('modeling').updateLabel(window.ptn.get('elementRegistry').get(id), 'Renamed on the canvas'), ids.a);
await page.waitForTimeout(80);
check(/Place: Renamed on the canvas/.test(await page.locator('.ptn-properties-title').textContent()),
  `the heading reads '${await page.locator('.ptn-properties-title').textContent()}' after a rename on the canvas`);
await ev(() => window.ptn.get('commandStack').undo());
await page.waitForTimeout(80);
check(!/Renamed on the canvas/.test(await page.locator('.ptn-properties-title').textContent()), 'the heading kept the name after undo');

// Enter and then leaving the field at once is one command, not two.
await select(ids.t);
await page.waitForTimeout(50);
before = await steps();
await field('Name').fill('Quickly');
await field('Name').press('Enter');
await field('Name').press('Tab');
await page.waitForTimeout(150);
check(await steps() === before + 1, `Enter and Tab took ${await steps() - before} steps`);

// An import with the same ids while a name is being typed: the typed text must not reach the new elements,
// and the command stack must keep working.
await select(ids.a);
await page.waitForTimeout(50);
const exported = await ev(() => window.ptn.savePNML());
await field('Name').fill('Typed, not confirmed');
await ev((pnml) => window.ptn.importPNML(pnml), exported);
await page.waitForTimeout(200);
const afterImport = await ev(async (id) => {
  const registry = window.ptn.get('elementRegistry');
  const place = registry.get(id);
  window.ptn.get('modeling').updateLabel(place, 'Still works');
  return { name: place.businessObject.name, canUndo: window.ptn.get('commandStack').canUndo() };
}, ids.a);
check(afterImport.name === 'Still works', 'the command stack stopped working after an import during typing');

// ── an arc: weight and name ────────────────────────────────────────────────
await select(ids.second);
await page.waitForTimeout(50);
check(/^Arc: |^Arc/.test(await page.locator('.ptn-properties-title').textContent()), 'an arc is not shown as an arc');
await field('Weight').fill('2');
await field('Weight').press('Enter');
await page.waitForTimeout(100);
check(await bo(ids.second, 'inscription') === '2', `the weight reads '${await bo(ids.second, 'inscription')}'`);

before = await steps();
await field('Weight').fill('0');
await field('Weight').press('Enter');
await page.waitForTimeout(80);
check(await steps() === before && await bo(ids.second, 'inscription') === '2', 'a weight of 0 was written');
check(/whole number of 1 or more/.test(await page.locator('.ptn-prop-error:not([hidden])').first().textContent()), 'a weight of 0 gave no reason');

await field('Name').fill('feeds');
await field('Name').press('Enter');
await page.waitForTimeout(100);
check(await bo(ids.second, 'name') === 'feeds', 'the name of the arc was not written');
check((await ev(() => window.ptn.savePNML())).includes('feeds'), 'the name of the arc did not reach the PNML');

// ── several elements: a count, and nothing to edit ─────────────────────────
await ev(([a, b]) => {
  const registry = window.ptn.get('elementRegistry');
  window.ptn.get('selection').select([registry.get(a), registry.get(b)]);
}, [ids.a, ids.t]);
await page.waitForTimeout(50);
check(/2 elements selected: 1 place, 1 transition/.test(await page.locator('.ptn-properties-text').textContent()),
  'a selection of several is not described');
check(await page.locator('.ptn-prop-input').count() === 0, 'a selection of several offers fields');

// ── what is typed goes to the element it was typed for ─────────────────────
await select(ids.a);
await page.waitForTimeout(50);
await field('Name').fill('Zed');
await ev((id) => {
  const registry = window.ptn.get('elementRegistry');
  // The selection moves to another place while the text is still in the field.
  window.ptn.get('selection').select(registry.get(id));
}, ids.b);
await page.waitForTimeout(150);
check(await bo(ids.a, 'name') === 'Zed', 'a name typed for one place was lost when the selection moved');
check(!(await bo(ids.b, 'name')), 'a name typed for one place went to the one selected next');

// ── P opens the panel and focuses its first field ──────────────────────────
await button.click();
check(await card.isHidden(), 'the button did not close the panel');
await select(ids.a);
await ev(() => window.ptn.get('canvas').focus());
await page.keyboard.press('p');
await page.waitForTimeout(80);
check(await card.isVisible(), 'P did not open the panel');
check(await page.evaluate(() => document.activeElement?.id?.endsWith('-0')), 'P did not focus the first field');
check(!(await field('Name').inputValue()).toLowerCase().endsWith('p') || (await field('Name').inputValue()) === await bo(ids.a, 'name'), 'the key P was typed into the field');

// Escape puts the stored value back and leaves the field.
await field('Name').fill('nope');
await field('Name').press('Escape');
check(await field('Name').inputValue() === 'Zed', 'Escape did not put the stored value back');

// ── a run: read only, no editor, and the run goes on ───────────────────────
await ev(() => { window.ptn.get('simulation').start(); });
await page.waitForTimeout(100);
check(await field('Name').getAttribute('readonly') !== null, 'a field is editable during a run');
check(/Stop the simulation to edit it/.test(await page.locator('.ptn-properties-note').textContent()), 'the panel does not say why it is read only');
const editor = await ev((id) => {
  const registry = window.ptn.get('elementRegistry');
  window.ptn.get('directEditing').activate(registry.get(id));
  return { editing: window.ptn.get('directEditing').isActive(), running: window.ptn.get('simulation').active };
}, ids.a);
check(editor.editing === false, 'the label editor opened during a run');
check(editor.running === true, 'opening the label editor ended the run');
await ev(() => window.ptn.get('simulation').stop());
await page.waitForTimeout(80);
check(await field('Name').getAttribute('readonly') === null, 'the field is still read only after the run');

// ── a typed 0 on the canvas keeps the old weight ───────────────────────────
const weight = await ev((id) => {
  const registry = window.ptn.get('elementRegistry');
  window.ptn.get('modeling').updateLabel(registry.get(id), '0');
  return registry.get(id).businessObject.inscription;
}, ids.second);
check(weight === '2', `a weight of 0 typed on the canvas gave '${weight}'`);

// ── both cards open, on a narrow canvas ────────────────────────────────────
await page.setViewportSize({ width: 600, height: 700 });
await ev(() => window.ptn.get('findingsPanel').analyse());
await page.waitForTimeout(150);
const boxes = await ev(() => {
  const box = (selector) => {
    const element = document.querySelector(selector);
    if (!element || element.hidden) return null;
    const r = element.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  };
  return { properties: box('.ptn-properties'), findings: box('.ptn-findings'), palette: box('.djs-palette'), width: window.innerWidth };
});
check(boxes.properties && boxes.findings, 'both cards are not shown at once');
check(boxes.properties.left >= boxes.palette.right && boxes.findings.left >= boxes.palette.right,
  'a card lies over the palette on a narrow canvas');
check(boxes.properties.right <= boxes.width && boxes.findings.right <= boxes.width, 'a card runs off the canvas');
check(boxes.findings.top >= boxes.properties.bottom - 1, 'the cards overlap');

// Every button can be clicked on a narrow canvas: the simulation bar does not lie over them.
const reachable = await ev(() => [...document.querySelectorAll('.ptn-side-row > button')].map((button) => {
  const r = button.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { text: button.textContent, hit: hit === button || button.contains(hit) };
}));
check(reachable.length === 3 && reachable.every((entry) => entry.hit), `buttons under something else at 600 px: ${JSON.stringify(reachable.filter((entry) => !entry.hit))}`);
check(await ev(() => [...document.querySelectorAll('.ptn-side-row > button')].map((b) => b.textContent.split(' ')[0]).join()) === 'Properties,State,Analyse',
  'the buttons are not in the order they are shown in');

// A low canvas: the cards keep a readable height, and the column scrolls instead.
await page.setViewportSize({ width: 1280, height: 330 });
await page.waitForTimeout(150);
const low = await ev(() => {
  const h = (selector) => document.querySelector(selector).getBoundingClientRect().height;
  return { findings: h('.ptn-findings'), properties: h('.ptn-properties'), column: h('.ptn-side-column') };
});
check(low.findings >= 100 && low.properties >= 60, `on a low canvas the cards are ${JSON.stringify(low)}`);

// ── a host can leave it out ────────────────────────────────────────────────
const second = await browser.newPage();
second.on('pageerror', (error) => pageErrors.push(error.message));
await open(second);
check(await second.locator('.ptn-properties-button').count() === 0 && await second.locator('.ptn-properties').count() === 0,
  'propertiesPanel: false still builds the panel');
check(await second.evaluate(() => window.ptn.get('propertiesPanel').isOpen) === false, 'a disabled panel says it is open');
await second.evaluate(() => window.ptn.get('propertiesPanel').open());
check(await second.locator('.ptn-properties').count() === 0, 'open() built a disabled panel');

await browser.close();
server.close();

if (pageErrors.length) problems.push('page errors: ' + pageErrors.join('; '));

if (problems.length) {
  console.log('FAIL: ' + problems.join('; '));
  process.exitCode = 1;
} else {
  console.log('OK: the properties panel edits one command at a time, refuses wrong values, and stays out of a run');
}
