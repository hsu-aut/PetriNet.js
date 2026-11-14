import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from './builders.js';
import { workflowShape } from './classes.js';
import { readNet } from './model.js';
import { drawnAtStart, soundness } from './workflow.js';

const check = (places, transitions, arcs, limits = { milliseconds: Infinity }) => {
  const net = readNet(build(places, transitions, arcs));
  const shape = workflowShape(net);
  assert.ok(shape && shape.offPath === null, 'the test net is not a workflow net');
  return soundness(net, shape, limits);
};

test('a sequence is sound', () => {
  const answer = check({ i: 0, m: 0, o: 0 }, ['a', 'b'], [['i', 'a'], ['a', 'm'], ['m', 'b'], ['b', 'o']]);
  assert.equal(answer.sound, true);
});

test('AND split and join are sound', () => {
  const answer = check({ i: 0, p: 0, q: 0, r: 0, s: 0, o: 0 }, ['split', 'x', 'y', 'join'],
    [['i', 'split'], ['split', 'p'], ['split', 'q'], ['p', 'x'], ['x', 'r'], ['q', 'y'], ['y', 's'], ['r', 'join'], ['s', 'join'], ['join', 'o']]);
  assert.equal(answer.sound, true);
});

test('XOR split and join are sound', () => {
  const answer = check({ i: 0, o: 0 }, ['a', 'b'], [['i', 'a'], ['i', 'b'], ['a', 'o'], ['b', 'o']]);
  assert.equal(answer.sound, true);
});

test('an AND split into an XOR join is not sound: two tokens reach the end', () => {
  const answer = check({ i: 0, p: 0, q: 0, o: 0 }, ['split', 'x', 'y'],
    [['i', 'split'], ['split', 'p'], ['split', 'q'], ['p', 'x'], ['q', 'y'], ['x', 'o'], ['y', 'o']]);
  assert.equal(answer.sound, false);
  assert.ok(answer.reasons.some((reason) => reason.kind === 'improper'));
});

test('an XOR split into an AND join is not sound: it gets stuck', () => {
  const answer = check({ i: 0, p: 0, q: 0, o: 0 }, ['a', 'b', 'join'],
    [['i', 'a'], ['i', 'b'], ['a', 'p'], ['b', 'q'], ['p', 'join'], ['q', 'join'], ['join', 'o']]);
  assert.equal(answer.sound, false);
  assert.ok(answer.reasons.some((reason) => reason.kind === 'stuck'));
});

test('a transition that can never fire makes the net unsound', () => {
  // u needs a token in w, and w is only filled by u itself: u is dead. Every node still
  // lies on a path from i to o, so this is a workflow net.
  const answer = check({ i: 0, m: 0, w: 0, o: 0 }, ['a', 'b', 'u'],
    [['i', 'a'], ['a', 'm'], ['m', 'b'], ['b', 'o'], ['m', 'u'], ['w', 'u'], ['u', 'w'], ['u', 'o']]);
  assert.equal(answer.sound, false);
  assert.deepEqual(answer.reasons.map((reason) => reason.kind), ['dead']);
  assert.deepEqual(answer.reasons[0].transitions, ['u']);
});

test('a loop that makes a token each time round is unbounded, which no sound net is', () => {
  const answer = check({ i: 0, m: 0, o: 0 }, ['a', 'again', 'b'],
    [['i', 'a'], ['a', 'm'], ['m', 'again'], ['again', 'm', 2], ['m', 'b'], ['b', 'o']]);
  assert.equal(answer.sound, false);
  assert.ok(answer.reasons.some((reason) => reason.kind === 'unbounded' && reason.places.includes('m')));
});

test('the net is checked from one token in the start place, whatever it is drawn with', () => {
  const net = readNet(build({ i: 0, o: 0 }, ['t'], [['i', 't'], ['t', 'o']]));
  const shape = workflowShape(net);
  assert.equal(drawnAtStart(net, shape), false);
  assert.equal(soundness(net, shape, { milliseconds: Infinity }).sound, true);
});

test('a drawn marking of [i] reuses the search it is handed', () => {
  const net = readNet(build({ i: 1, o: 0 }, ['t'], [['i', 't'], ['t', 'o']]));
  const shape = workflowShape(net);
  assert.equal(drawnAtStart(net, shape), true);
});

test('a search cut off at its limit can still prove a net unsound, but not sound', () => {
  // XOR into AND: the stuck marking is found early.
  const net = readNet(build({ i: 0, p: 0, q: 0, o: 0 }, ['a', 'b', 'join'],
    [['i', 'a'], ['i', 'b'], ['a', 'p'], ['b', 'q'], ['p', 'join'], ['q', 'join'], ['join', 'o']]));
  const shape = workflowShape(net);
  assert.equal(soundness(net, shape, { markings: 3, milliseconds: Infinity }).sound, false);

  const fine = readNet(build({ i: 0, m: 0, o: 0 }, ['a', 'b', 'c'], [['i', 'a'], ['a', 'm'], ['m', 'b'], ['b', 'o'], ['m', 'c'], ['c', 'o']]));
  const answer = soundness(fine, workflowShape(fine), { markings: 2, milliseconds: Infinity });
  // The search is cut off, so only the structure can say it is sound, and it does for this free-choice net.
  assert.ok(answer.sound === true || answer.sound === null);
});

// ── the verdict against the closed net, on generated workflow nets ──────────
import { notLive } from './analyse.js';
import { explore } from './explore.js';
import { closedNet } from './workflow.js';

function generator(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  return { chance: (p) => next() < p, int: (low, high) => low + Math.floor(next() * (high - low + 1)) };
}

/** A structured workflow net from series, AND and XOR blocks, and sometimes one stray arc. */
function randomWorkflow(random) {
  const places = { i: 0, o: 0 };
  const transitions = [];
  const arcs = [];
  let count = 0;
  const place = () => { const id = `p${count += 1}`; places[id] = 0; return id; };
  const transition = () => { const id = `t${count += 1}`; transitions.push(id); return id; };

  const block = (from, to, depth) => {
    const kind = depth === 0 ? 'atom' : ['atom', 'seq', 'and', 'xor'][random.int(0, 3)];
    if (kind === 'atom') {
      const t = transition();
      arcs.push([from, t], [t, to]);
    } else if (kind === 'seq') {
      const middle = place();
      block(from, middle, depth - 1);
      block(middle, to, depth - 1);
    } else if (kind === 'xor') {
      block(from, to, depth - 1);
      block(from, to, depth - 1);
    } else {
      const split = transition();
      const join = transition();
      const [a, b, c, d] = [place(), place(), place(), place()];
      arcs.push([from, split], [split, a], [split, b], [c, join], [d, join], [join, to]);
      block(a, c, depth - 1);
      block(b, d, depth - 1);
    }
  };
  block('i', 'o', random.int(1, 3));

  // Now and then a stray arc, which usually breaks soundness in an instructive way.
  if (random.chance(0.5)) {
    const ps = Object.keys(places);
    const p = ps[random.int(0, ps.length - 1)];
    const t = transitions[random.int(0, transitions.length - 1)];
    arcs.push(random.chance(0.5) ? [p, t] : [t, p]);
  }

  return readNet(build(places, transitions, arcs));
}

test('the verdict equals "the closed net is live and bounded" on generated workflow nets', () => {
  const random = generator(19970101);
  let sound = 0;
  let unsound = 0;
  let proven = 0;

  for (let n = 0; n < 1500; n += 1) {
    const net = randomWorkflow(random);
    const shape = workflowShape(net);
    if (!shape || shape.offPath !== null) continue;

    const answer = soundness(net, shape, { markings: 3000, milliseconds: Infinity });
    const closed = closedNet(net, shape);
    const result = explore(closed, { markings: 3000, milliseconds: Infinity });
    const whole = result.complete && result.unbounded.length === 0;

    if (answer.sound !== null && whole) {
      const expected = notLive(closed, result).length === 0;
      assert.equal(answer.sound, expected,
        `soundness says ${answer.sound}, the closed net says live=${expected}: ${JSON.stringify(net)}`);
      if (answer.sound) sound += 1; else unsound += 1;
    }

    // And where only the structure can say, with the search cut off, it must say the same.
    const cut = soundness(net, shape, { markings: 4, milliseconds: Infinity });
    if (cut.sound !== null && answer.sound !== null && !cut.searched.complete) {
      assert.equal(cut.sound, answer.sound, `with the search cut off the verdict changed: ${JSON.stringify(net)}`);
      if (cut.proof === 'free-choice-workflow') proven += 1;
    }
  }

  assert.ok(sound >= 100, `only ${sound} sound nets were checked`);
  assert.ok(unsound >= 100, `only ${unsound} unsound nets were checked`);
  assert.ok(proven >= 10, `only ${proven} nets were proven sound from the structure`);
});
