import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyse } from './analyse.js';
import * as fixtures from './fixtures.js';
import { readNet } from './model.js';
import { analyseData } from './plain.js';

const nets = Object.entries(fixtures).filter(([, value]) => value && Array.isArray(value.places));

test('there are nets to test with', () => {
  assert.ok(nets.length >= 5, `only ${nets.length} fixtures`);
});

for (const [name, data] of nets) {
  test(`${name}: the answer survives JSON and equals the core's`, () => {
    const answer = analyseData(data);
    const again = JSON.parse(JSON.stringify(answer));
    assert.deepEqual(again, answer, 'something in the answer does not survive JSON');

    const direct = analyse(readNet(data));
    assert.deepEqual(again.findings, JSON.parse(JSON.stringify(direct.findings)));
    assert.equal(answer.problem, null);
    assert.equal(answer.complete, direct.complete);
    assert.equal(answer.markings, direct.result.markings.length);
  });
}

test('a net that grows without bound names the place and holds no Infinity', () => {
  const answer = analyseData(fixtures.producer);
  assert.ok(answer.unbounded.length > 0);
  assert.ok(answer.findings.some((finding) => finding.rule === 'PT12'));
  assert.equal(JSON.stringify(answer).includes('Infinity'), false);
});

test('a net that cannot be read gives a reason and no findings, and does not throw', () => {
  const answer = analyseData({
    places: [{ id: 'a' }, { id: 'a' }],
    transitions: [],
    arcs: [],
  });
  assert.match(answer.problem, /used by two elements/);
  assert.deepEqual(answer.findings, []);
  assert.equal(answer.complete, false);
});

test('an arc between two places is a reason, not an exception', () => {
  const answer = analyseData({ places: [{ id: 'a' }, { id: 'b' }], transitions: [], arcs: [{ id: 'x', source: 'a', target: 'b' }] });
  assert.match(answer.problem, /not between a place and a transition/);
});

test('no time limit means the clock is not asked to stop the search', () => {
  let time = 0;
  const jumping = () => { time += 1e9; return time; };

  const limited = analyseData(fixtures.qualityCheck, { milliseconds: 1, now: jumping });
  assert.equal(limited.stopped, 'time', 'the test clock does not make the limit bite');

  time = 0;
  const free = analyseData(fixtures.qualityCheck, { milliseconds: null, now: jumping });
  assert.equal(free.complete, true);
  assert.equal(free.stopped, null);
});

test('the limit on markings still stops a search', () => {
  const answer = analyseData(fixtures.qualityCheck, { markings: 3, milliseconds: null });
  assert.equal(answer.complete, false);
  assert.equal(answer.stopped, 'markings');
  assert.ok(answer.findings.some((finding) => finding.rule === 'PT17'));
});

test('null for the limit on markings keeps the default rather than none', () => {
  const answer = analyseData(fixtures.qualityCheck, { markings: null, milliseconds: null });
  assert.equal(answer.complete, true);
  assert.equal(answer.stopped, null);
});

test('an empty net can be analysed', () => {
  const answer = analyseData({});
  assert.equal(answer.problem, null);
  assert.equal(typeof answer.complete, 'boolean');
});

test('a net that grows without bound is not complete, although the search finished', () => {
  const answer = analyseData(fixtures.producer, { milliseconds: null });
  assert.equal(answer.stopped, null);
  assert.equal(answer.complete, false);
  assert.ok(answer.findings.some((finding) => finding.rule === 'PT17'));
});

test('a net without a transition reports no deadlock', () => {
  const answer = analyseData({ places: [{ id: 'p', name: 'P', marking: 1 }] });
  assert.equal(answer.findings.some((finding) => finding.rule === 'PT15'), false);
});
