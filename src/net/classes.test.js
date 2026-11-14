import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from './builders.js';
import { classNames, netClasses, workflowShape } from './classes.js';
import { readNet } from './model.js';

const classesOf = (...args) => netClasses(readNet(build(...args)));
const namesOf = (...args) => classNames(classesOf(...args));

test('a cycle of places and transitions is a state machine and a marked graph', () => {
  const names = namesOf({ a: 1, b: 0 }, ['t', 'u'], [['a', 't'], ['t', 'b'], ['b', 'u'], ['u', 'a']]);
  assert.deepEqual(names, ['state-machine', 'marked-graph', 'free-choice', 'extended-free-choice', 'asymmetric-choice']);
});

test('a choice between two transitions is a state machine, not a marked graph', () => {
  const names = namesOf({ p: 1, q: 0, r: 0 }, ['t', 'u'], [['p', 't'], ['t', 'q'], ['p', 'u'], ['u', 'r']]);
  assert.ok(names.includes('state-machine'));
  assert.ok(!names.includes('marked-graph'));
  assert.ok(names.includes('free-choice'));
});

test('a fork and a join make a marked graph, not a state machine', () => {
  const names = namesOf(
    { p: 1, a: 0, b: 0, c: 0, d: 0 }, ['fork', 'x', 'y', 'join'],
    [['p', 'fork'], ['fork', 'a'], ['fork', 'b'], ['a', 'x'], ['x', 'c'], ['b', 'y'], ['y', 'd'], ['c', 'join'], ['d', 'join'], ['join', 'p']],
  );
  assert.ok(names.includes('marked-graph'));
  assert.ok(!names.includes('state-machine'));
  assert.ok(names.includes('free-choice'));
});

test('two places that share both their transitions are extended free-choice, not free-choice', () => {
  const classes = classesOf({ p1: 1, p2: 1, q: 0 }, ['t1', 't2'],
    [['p1', 't1'], ['p2', 't1'], ['p1', 't2'], ['p2', 't2'], ['t1', 'q'], ['t2', 'q']]);
  assert.equal(classes.freeChoice, false);
  assert.equal(classes.extendedFreeChoice, true);
  assert.equal(classes.asymmetricChoice, true);
});

test('places whose transitions are nested are asymmetric choice, not extended free-choice', () => {
  const classes = classesOf({ p1: 1, p2: 1, q: 0 }, ['t1', 't2'],
    [['p1', 't1'], ['p2', 't1'], ['p2', 't2'], ['t1', 'q'], ['t2', 'q']]);
  assert.equal(classes.extendedFreeChoice, false);
  assert.equal(classes.asymmetricChoice, true);
});

test('places that overlap without nesting are not even asymmetric choice', () => {
  // Two philosophers' forks: p1 feeds t1 and t2, p2 feeds t2 and t3.
  const classes = classesOf({ p1: 1, p2: 1, q: 0 }, ['t1', 't2', 't3'],
    [['p1', 't1'], ['p1', 't2'], ['p2', 't2'], ['p2', 't3'], ['t1', 'q'], ['t2', 'q'], ['t3', 'q']]);
  assert.equal(classes.asymmetricChoice, false);
  assert.equal(classes.extendedFreeChoice, false);
});

test('an arc heavier than one takes the net out of every class and names the arc', () => {
  const classes = classesOf({ p: 1, q: 0 }, ['t'], [['p', 't', 2], ['t', 'q']]);
  assert.equal(classes.ordinary, false);
  assert.equal(classes.witness, 'a0');
  assert.deepEqual(classNames(classes), []);
});

test('two parallel arcs of weight one add up to a heavy arc', () => {
  const classes = classesOf({ p: 2, q: 0 }, ['t'], [['p', 't'], ['p', 't'], ['t', 'q']]);
  assert.equal(classes.ordinary, false);
  assert.equal(classes.witness, 'a0');
});

test('a net without places or without transitions is in no class', () => {
  assert.deepEqual(namesOf({}, [], []), []);
  assert.deepEqual(namesOf({ p: 1 }, [], []), []);
});

test('the hierarchy holds: every class implies the next', () => {
  const rows = [
    namesOf({ a: 1, b: 0 }, ['t', 'u'], [['a', 't'], ['t', 'b'], ['b', 'u'], ['u', 'a']]),
    namesOf({ p1: 1, p2: 1, q: 0 }, ['t1', 't2'], [['p1', 't1'], ['p2', 't1'], ['p2', 't2'], ['t1', 'q'], ['t2', 'q']]),
  ];
  for (const names of rows) {
    if (names.includes('state-machine') || names.includes('marked-graph')) assert.ok(names.includes('free-choice'));
    if (names.includes('free-choice')) assert.ok(names.includes('extended-free-choice'));
    if (names.includes('extended-free-choice')) assert.ok(names.includes('asymmetric-choice'));
  }
});

const shape = (...args) => workflowShape(readNet(build(...args)));

test('a sequence from one place to another is a workflow net', () => {
  assert.deepEqual(shape({ i: 1, o: 0 }, ['t'], [['i', 't'], ['t', 'o']]), { start: 'i', end: 'o', offPath: null });
});

test('a net with a loop through the start has no single start place', () => {
  assert.equal(shape({ a: 1, b: 0 }, ['t', 'u'], [['a', 't'], ['t', 'b'], ['b', 'u'], ['u', 'a']]), null);
});

test('a node off every path between start and end is named', () => {
  // t2 has no input, so nothing leads to it from the start.
  const found = shape({ i: 1, o: 0 }, ['t1', 't2'], [['i', 't1'], ['t1', 'o'], ['t2', 'o']]);
  assert.equal(found.start, 'i');
  assert.equal(found.end, 'o');
  assert.equal(found.offPath, 't2');
});

test('two end places are no workflow net and give no hint', () => {
  assert.equal(shape({ i: 1, o: 0, x: 0 }, ['t'], [['i', 't'], ['t', 'o'], ['t', 'x']]), null);
});
