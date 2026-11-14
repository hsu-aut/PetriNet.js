import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describe, elementsOf, netCounts, parseMarking, parseWeight } from './values.js';

const place = (id) => ({ id, type: 'ptn:Place' });
const transition = (id) => ({ id, type: 'ptn:Transition' });
const arc = (id) => ({ id, type: 'ptn:Arc' });
const label = (target) => ({ id: `${target.id}_label`, type: 'label', labelTarget: target });

test('a marking is a whole number of 0 or more, and nothing means 0', () => {
  assert.deepEqual(parseMarking(''), { ok: true, value: 0 });
  assert.deepEqual(parseMarking('   '), { ok: true, value: 0 });
  assert.deepEqual(parseMarking(' 2 '), { ok: true, value: 2 });
  assert.deepEqual(parseMarking('007'), { ok: true, value: 7 });
  assert.deepEqual(parseMarking('0'), { ok: true, value: 0 });
});

test('a marking that is not a whole number is refused with a reason', () => {
  for (const text of ['-1', '1.5', '1e3', 'two', '1 2', '+3']) {
    const answer = parseMarking(text);
    assert.equal(answer.ok, false, text);
    assert.match(answer.message, /whole number of 0 or more/);
  }
});

test('a weight is a whole number of 1 or more, and nothing means 1', () => {
  assert.deepEqual(parseWeight(''), { ok: true, value: 1 });
  assert.deepEqual(parseWeight('3'), { ok: true, value: 3 });
  assert.deepEqual(parseWeight('0003'), { ok: true, value: 3 });
});

test('a weight of 0 and the other wrong ones are refused', () => {
  for (const text of ['0', '000', '-2', '1.0', 'x']) assert.equal(parseWeight(text).ok, false, text);
  assert.match(parseWeight('0').message, /whole number of 1 or more/);
});

test('a number with too many digits is refused rather than rounded', () => {
  assert.equal(parseMarking('1234567890').ok, false);
  assert.equal(parseMarking('999999999').ok, true);
});

test('a label stands for its element, which is counted once', () => {
  const p = place('p');
  assert.deepEqual(elementsOf([p, label(p)]).map((e) => e.id), ['p']);
  assert.deepEqual(elementsOf([label(p)]).map((e) => e.id), ['p']);
});

test('nothing selected, one element, and several are described', () => {
  assert.deepEqual(describe([]), { kind: 'none' });
  assert.equal(describe([place('p')]).kind, 'place');
  assert.equal(describe([transition('t')]).kind, 'transition');
  assert.equal(describe([arc('a')]).kind, 'arc');
  assert.equal(describe([label(place('p'))]).element.id, 'p');

  const many = describe([place('p'), place('q'), arc('a')]);
  assert.equal(many.kind, 'many');
  assert.equal(many.text, '3 elements selected: 2 places, 1 arc. Select one to edit it.');
});

test('something that is not part of a net is left out of the description', () => {
  assert.deepEqual(describe([{ id: 'x', type: 'other' }]), { kind: 'none' });
});

test('the net is counted without its labels', () => {
  const p = place('p');
  const all = [p, label(p), place('q'), transition('t'), arc('a'), arc('b')];
  assert.deepEqual(netCounts(all), { places: 2, transitions: 1, arcs: 2 });
});
