import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notLive } from './analyse.js';
import { build } from './builders.js';
import { netClasses } from './classes.js';
import { explore } from './explore.js';
import { readNet } from './model.js';
import { boundednessFromStructure, livenessFromStructure, sComponents } from './theorems.js';

const prepared = (...args) => {
  const net = readNet(build(...args));
  return { net, classes: netClasses(net) };
};
const liveness = (...args) => {
  const { net, classes } = prepared(...args);
  return livenessFromStructure(net, classes);
};

// ── answers known from the literature ───────────────────────────────────────

test('a state machine is live iff it is strongly connected and holds a token', () => {
  const cycle = [['a', 't'], ['t', 'b'], ['b', 'u'], ['u', 'a']];
  assert.equal(liveness({ a: 1, b: 0 }, ['t', 'u'], cycle).live, true);
  assert.equal(liveness({ a: 1, b: 0 }, ['t', 'u'], cycle).proof, 'state-machine');
  assert.equal(liveness({ a: 0, b: 0 }, ['t', 'u'], cycle).live, false);
  assert.equal(liveness({ a: 0, b: 0 }, ['t', 'u'], cycle).reason, 'unmarked');
});

test('a state machine that is not strongly connected is not live, and the part that loses tokens is named', () => {
  // p -> t -> q and p -> u -> r: nothing leads back.
  const found = liveness({ p: 1, q: 0, r: 0 }, ['t', 'u'], [['p', 't'], ['t', 'q'], ['p', 'u'], ['u', 'r']]);
  assert.equal(found.live, false);
  assert.equal(found.reason, 'not-strongly-connected');
  assert.ok(found.cover.length > 0);
});

test('a marked graph is live iff every circuit holds a token', () => {
  const ring = [['a', 't'], ['t', 'b'], ['b', 'u'], ['u', 'a']];
  assert.equal(liveness({ a: 1, b: 0 }, ['t', 'u'], ring).live, true);

  // A fork and a join, drawn as two circuits through p; one of them without a token.
  const fork = [
    ['p', 'fork'], ['fork', 'a'], ['fork', 'b'], ['a', 'x'], ['x', 'c'], ['b', 'y'], ['y', 'd'], ['c', 'join'], ['d', 'join'], ['join', 'p'],
  ];
  assert.equal(liveness({ p: 1, a: 0, b: 0, c: 0, d: 0 }, ['fork', 'x', 'y', 'join'], fork).live, true);
  assert.equal(liveness({ p: 0, a: 0, b: 0, c: 0, d: 0 }, ['fork', 'x', 'y', 'join'], fork).live, false);
});

test('Commoner: an extended free-choice net with an unmarked siphon is not live, and the siphon is named', () => {
  // t needs a token from p and one from s. p and q are filled only by transitions that take
  // from them, and both start empty, so {p, q} is a siphon that never holds a token. Place q
  // has two output transitions, so the net is neither a state machine nor a marked graph.
  const found = liveness({ p: 0, q: 0, s: 1, z: 0 }, ['t', 'u', 'w'],
    [['p', 't'], ['s', 't'], ['t', 'q'], ['q', 'u'], ['q', 'w'], ['w', 'z'], ['u', 'p'], ['u', 's']]);
  assert.equal(found.live, false);
  assert.equal(found.proof, 'commoner');
  assert.deepEqual([...found.cover].sort(), ['p', 'q']);
});

test('Commoner: a marked trap inside every siphon makes a net live, as the search confirms', () => {
  // Found by looking, not by hand: some random net that Commoner calls live, and that the search
  // agrees is live. The generator is seeded, so this is the same net on every run.
  const random = generator(7);
  let proven = null;
  for (let i = 0; i < 3000 && !proven; i += 1) {
    const net = randomRings(random);
    const found = livenessFromStructure(net, netClasses(net));
    const searched = search(net);
    if (found?.proof === 'commoner' && found.live === true && searched.whole) proven = { found, searched };
  }
  assert.ok(proven, 'no net was found that Commoner calls live');
  assert.equal(proven.searched.live, true);
});

test('Commoner is not applied to a net with a source transition', () => {
  // t has no input place: the theorem is stated for nets where every transition has one.
  assert.equal(liveness({ p: 1, q: 0 }, ['t', 'u'], [['t', 'p'], ['p', 'u'], ['u', 'q']]), null);
});

test('a net with a heavy arc gets no answer from the structure', () => {
  assert.equal(liveness({ p: 1, q: 0 }, ['t'], [['p', 't', 2], ['t', 'q']]), null);
});

test('a net that is not connected gets no answer', () => {
  assert.equal(liveness({ a: 1, b: 1 }, ['t', 'u'], [['a', 't'], ['t', 'a'], ['b', 'u'], ['u', 'b']]), null);
});

test('boundedness: places covered by an invariant are bounded', () => {
  const { net, classes } = prepared({ a: 1, b: 0 }, ['t', 'u'], [['a', 't'], ['t', 'b'], ['b', 'u'], ['u', 'a']]);
  const found = boundednessFromStructure(net, classes, null);
  assert.equal(found.bounded, true);
  assert.equal(found.proof, 'place-invariants');
});

test('boundedness: a producer is not covered, and with no theorem for it nothing is claimed', () => {
  const { net, classes } = prepared({ s: 0 }, ['make'], [['make', 's']]);
  assert.equal(boundednessFromStructure(net, classes, null), null);
});

test('Hack: a live extended free-choice net with a place outside every S-component is unbounded', () => {
  // t takes a token from p and puts one back, and one into q, which nothing takes out.
  const { net, classes } = prepared({ p: 1, q: 0 }, ['t'], [['p', 't'], ['t', 'p'], ['t', 'q']]);
  const live = livenessFromStructure(net, classes);
  assert.equal(live.live, true);

  const found = boundednessFromStructure(net, classes, live);
  assert.equal(found.bounded, false);
  assert.equal(found.proof, 'hack');
  assert.deepEqual(found.cover, ['q']);
});

test('S-components are found as sets of places', () => {
  const { net } = prepared({ a: 1, b: 0 }, ['t', 'u'], [['a', 't'], ['t', 'b'], ['b', 'u'], ['u', 'a']]);
  assert.deepEqual(sComponents(net).map((set) => [...set].sort()), [['a', 'b']]);
});

// ── the theorems against the search ─────────────────────────────────────────
// Where both are complete they must agree. A disagreement means a theorem was
// applied outside its conditions, which is the worst thing this module can do.

/** A small seeded generator: the same nets on every run. */
function generator(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  return {
    chance: (p) => next() < p,
    int: (low, high) => low + Math.floor(next() * (high - low + 1)),
  };
}

function randomNet(random, least = 0, most = 2) {
  const placeCount = random.int(2, 5);
  const transitionCount = random.int(1, 5);
  const places = {};
  for (let i = 0; i < placeCount; i += 1) places[`p${i}`] = random.int(least, most);
  const transitions = Array.from({ length: transitionCount }, (_, i) => `t${i}`);
  const arcs = [];
  for (const place of Object.keys(places)) {
    for (const transition of transitions) {
      if (random.chance(0.3)) arcs.push([place, transition]);
      if (random.chance(0.3)) arcs.push([transition, place]);
    }
  }
  return readNet(build(places, transitions, arcs));
}

/**
 * Rings of places that synchronise over shared transitions, with alternative
 * transitions where a step is not shared. Such nets are free-choice, bounded, and
 * live or not depending on how the rings are tied, which is the case where a
 * proof of liveness has to be right and the search can check it.
 */
function randomRings(random) {
  const rings = random.int(2, 3);
  const places = {};
  const transitions = [];
  const arcs = [];
  const steps = []; // steps[r][i] = { id, shared, alternatives }
  let counter = 0;

  for (let r = 0; r < rings; r += 1) {
    const length = random.int(2, 3);
    const ids = Array.from({ length }, (_, i) => `r${r}p${i}`);
    const start = random.int(0, length - 1);
    ids.forEach((id, i) => { places[id] = i === start ? random.int(1, 2) : 0; });
    steps.push(ids.map((id, i) => ({ from: id, to: ids[(i + 1) % length], id: `x${counter += 1}`, shared: false })));
  }

  // Tie some steps of later rings to steps of the first.
  for (let r = 1; r < rings; r += 1) {
    if (!random.chance(0.7)) continue;
    const mine = steps[r][random.int(0, steps[r].length - 1)];
    const theirs = steps[0][random.int(0, steps[0].length - 1)];
    if (mine.shared || theirs.shared) continue;
    mine.shared = true;
    theirs.shared = true;
    mine.id = theirs.id;
    mine.partner = theirs;
    theirs.partner = mine;
  }

  const placed = new Set();
  for (const ring of steps) {
    for (const step of ring) {
      if (!placed.has(step.id)) {
        placed.add(step.id);
        transitions.push(step.id);
      }
      arcs.push([step.from, step.id], [step.id, step.to]);
      // An alternative route for a step that is not shared: a choice at its place.
      if (!step.shared && random.chance(0.4)) {
        const alternative = `y${counter += 1}`;
        transitions.push(alternative);
        arcs.push([step.from, alternative], [alternative, step.to]);
      }
    }
  }

  return readNet(build(places, transitions, arcs));
}

/**
 * Places that all feed the same transitions, which all give back to them: extended
 * free-choice, and not free-choice once there are two places and two transitions.
 * This is where the two meanings of "free-choice" part, and random nets almost never
 * land here.
 */
function randomSharedChoice(random) {
  const placeCount = random.int(2, 3);
  const transitionCount = random.int(2, 3);
  const places = {};
  for (let i = 0; i < placeCount; i += 1) places[`p${i}`] = random.int(0, 2);
  const transitions = Array.from({ length: transitionCount }, (_, i) => `t${i}`);
  const arcs = [];
  for (const place of Object.keys(places)) {
    for (const transition of transitions) {
      arcs.push([place, transition]);
      // Most give the token back; some put it in the next place instead, or take it away.
      const roll = random.int(0, 9);
      if (roll < 6) arcs.push([transition, place]);
      else if (roll < 8) arcs.push([transition, `p${(Number(place.slice(1)) + 1) % placeCount}`]);
    }
  }
  return readNet(build(places, transitions, arcs));
}

/** State machines and marked graphs, which random nets rarely are. */
function randomMachine(random, kind) {
  const count = random.int(2, 5);
  const places = {};
  for (let i = 0; i < count; i += 1) places[`p${i}`] = random.int(0, 2);
  const ids = Object.keys(places);
  const transitions = [];
  const arcs = [];

  if (kind === 'sm') {
    const total = random.int(2, 5);
    for (let i = 0; i < total; i += 1) {
      transitions.push(`t${i}`);
      arcs.push([ids[random.int(0, count - 1)], `t${i}`], [`t${i}`, ids[random.int(0, count - 1)]]);
    }
  } else {
    // Every place gets one transition before it and one after it.
    const total = random.int(2, 5);
    for (let i = 0; i < total; i += 1) transitions.push(`t${i}`);
    for (const id of ids) arcs.push([transitions[random.int(0, total - 1)], id], [id, transitions[random.int(0, total - 1)]]);
  }

  return readNet(build(places, transitions, arcs));
}

const search = (net) => {
  const result = explore(net, { markings: 4000, milliseconds: Infinity });
  const whole = result.complete && result.unbounded.length === 0;
  return { result, whole, live: whole ? notLive(net, result).length === 0 : null };
};

test('the theorems agree with the search on random nets', () => {
  const counts = { efc: 0, efcLive: 0, sm: 0, mg: 0, commoner: 0, commonerLive: 0, smLive: 0, mgLive: 0, invariants: 0, hackNo: 0, hackYes: 0 };
  const random = generator(20261114);
  const nets = [];
  for (let i = 0; i < 4000; i += 1) nets.push(randomNet(random));
  // With more tokens, more nets are live, and a wrong proof of liveness is the dangerous one.
  for (let i = 0; i < 4000; i += 1) nets.push(randomNet(random, 1, 3));
  for (let i = 0; i < 600; i += 1) nets.push(randomMachine(random, 'sm'), randomMachine(random, 'mg'));
  for (let i = 0; i < 1500; i += 1) nets.push(randomRings(random));
  for (let i = 0; i < 1500; i += 1) nets.push(randomSharedChoice(random));

  for (const net of nets) {
    const classes = netClasses(net);
    const found = livenessFromStructure(net, classes);
    const searched = search(net);

    if (found && found.live !== null && searched.whole) {
      assert.equal(found.live, searched.live,
        `${found.proof} says live=${found.live}, the search says ${searched.live}: ${JSON.stringify(net)}`);
      if (found.proof === 'state-machine') counts.sm += 1;
      if (found.proof === 'marked-graph') counts.mg += 1;
      if (found.proof === 'commoner') counts.commoner += 1;
      if (found.proof === 'commoner' && classes.extendedFreeChoice && !classes.freeChoice) {
        counts.efc += 1;
        if (found.live) counts.efcLive += 1;
      }
      if (found.live && found.proof === 'commoner') counts.commonerLive += 1;
      if (found.live && found.proof === 'state-machine') counts.smLive += 1;
      if (found.live && found.proof === 'marked-graph') counts.mgLive += 1;
    }

    const bounded = boundednessFromStructure(net, classes, found);
    if (bounded && searched.result.complete) {
      assert.equal(bounded.bounded, searched.result.unbounded.length === 0,
        `${bounded.proof} says bounded=${bounded.bounded}, the search found ${searched.result.unbounded.length} unbounded places: ${JSON.stringify(net)}`);
      if (bounded.proof === 'place-invariants') counts.invariants += 1;
      if (bounded.proof === 'hack') counts[bounded.bounded ? 'hackYes' : 'hackNo'] += 1;
    }
  }

  if (process.env.SHOW_COUNTS) console.log(JSON.stringify(counts));
  // The test must have looked at something, or it proves nothing.
  assert.ok(counts.sm >= 30, `only ${counts.sm} state machines were decided`);
  assert.ok(counts.mg >= 30, `only ${counts.mg} marked graphs were decided`);
  assert.ok(counts.commoner >= 20, `only ${counts.commoner} nets were decided by Commoner's theorem`);
  assert.ok(counts.commonerLive >= 10, `only ${counts.commonerLive} nets were proven live by Commoner's theorem`);
  assert.ok(counts.smLive >= 10, `only ${counts.smLive} state machines were proven live`);
  assert.ok(counts.mgLive >= 10, `only ${counts.mgLive} marked graphs were proven live`);
  assert.ok(counts.efc >= 100, `only ${counts.efc} extended free-choice nets that are not free-choice were decided`);
  assert.ok(counts.efcLive >= 20, `only ${counts.efcLive} of them were proven live`);
  assert.ok(counts.hackNo >= 20, `only ${counts.hackNo} nets were proven unbounded by Hack's theorem`);
  assert.ok(counts.invariants >= 50, `only ${counts.invariants} nets were bounded by invariants`);
});
