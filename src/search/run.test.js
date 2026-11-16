import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyse } from '../net/analyse.js';
import { build } from '../net/builders.js';
import { explore, OMEGA } from '../net/explore.js';
import * as fixtures from '../net/fixtures.js';
import { initialMarking, readNet } from '../net/model.js';
import { pathTo, pathToDeadlock, shortestWays, wayTo } from '../net/paths.js';
import { sequenceFor } from '../net/invariants.js';
import { plainLimits, runSearch } from './run.js';
import { fromWire, toWire } from './wire.js';

const nets = Object.entries(fixtures).filter(([, value]) => value && Array.isArray(value.places))
  .map(([name, data]) => [name, readNet(data)]);

test('there are nets to test with', () => assert.ok(nets.length >= 5));

for (const [name, net] of nets) {
  test(`${name}: the wire form survives JSON and gives the exploration back`, () => {
    const result = explore(net, { milliseconds: Infinity });
    const wire = toWire(result, net);
    const through = JSON.parse(JSON.stringify(wire));
    assert.deepEqual(through, wire, 'something in the wire form does not survive JSON');

    const back = fromWire(through);
    assert.deepEqual(back, result);
    // Every place has an entry in every marking, as in a marking the search made itself.
    for (const { marking } of back.markings) assert.deepEqual([...marking.keys()], net.places.map((place) => place.id));
  });

  test(`${name}: the answer of the analysis equals the analysis, and is JSON`, () => {
    const direct = analyse(net, { milliseconds: Infinity });
    const answer = runSearch('analyse', net, { milliseconds: Infinity });
    assert.deepEqual(JSON.parse(JSON.stringify(answer)), answer);
    assert.equal(answer.complete, direct.complete);
    assert.equal(answer.markings, direct.result.markings.length);
    assert.deepEqual(answer.classes, direct.classes);
    assert.deepEqual(answer.workflow, direct.workflow);

    answer.findings.forEach((finding, i) => {
      const { way, run, ...rest } = finding;
      assert.deepEqual(rest, direct.findings[i]);
      const original = direct.findings[i];
      assert.deepEqual(way, original.marking ? (pathTo(direct.result, original.marking)?.transitions ?? null) : null);
      assert.deepEqual(run, original.firings ? sequenceFor(net, new Map(original.firings), initialMarking(net)) : null);
    });
  });
}

test('omega survives the wire and comes back as Infinity', () => {
  const net = readNet(fixtures.producer);
  const result = explore(net, { milliseconds: Infinity });
  assert.ok(result.markings.some(({ marking }) => [...marking.values()].includes(OMEGA)), 'the test net has no omega');
  const wire = JSON.parse(JSON.stringify(toWire(result, net)));
  assert.ok(wire.keys.some((key) => key.includes('omega')));
  assert.deepEqual(fromWire(wire), result);
});

test('the answers of the analysis name a way into a deadlock and the run of a transition invariant', () => {
  const stuck = runSearch('analyse', readNet(fixtures.deadlock), { milliseconds: Infinity });
  const deadlock = stuck.findings.find((finding) => finding.rule === 'PT15');
  assert.ok(deadlock.way && deadlock.way.length > 0, 'no way into the deadlock');

  const loop = runSearch('analyse', readNet(fixtures.loop), { milliseconds: Infinity });
  const invariant = loop.findings.find((finding) => finding.rule === 'PT19');
  assert.ok(invariant.run && invariant.run.length > 0, 'no run of the transition invariant');
});

test('a clock and a callback are left out of the limits that travel', () => {
  assert.deepEqual(plainLimits({ markings: 5, milliseconds: null, now: () => 1, progress: () => {} }), { markings: 5, milliseconds: null });
});

test('an unknown search is refused', () => {
  assert.throws(() => runSearch('nothing', readNet(fixtures.loop)), /unknown search/);
});

// ── one walk instead of one per marking ─────────────────────────────────────

/** The way the paths used to be found: a walk over the edges for each marking asked for. */
function oldPathTo(result, key) {
  if (key === result.initial) return { transitions: [], markings: [result.initial] };
  const out = new Map();
  for (const edge of result.edges) {
    if (!out.has(edge.from)) out.set(edge.from, []);
    out.get(edge.from).push(edge);
  }
  const cameFrom = new Map();
  const queue = [result.initial];
  const seen = new Set([result.initial]);
  while (queue.length) {
    const from = queue.shift();
    for (const edge of out.get(from) ?? []) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      cameFrom.set(edge.to, edge);
      if (edge.to === key) {
        const transitions = [];
        const markings = [key];
        let at = key;
        while (at !== result.initial) {
          const e = cameFrom.get(at);
          transitions.unshift(e.transition);
          markings.unshift(e.from);
          at = e.from;
        }
        return { transitions, markings };
      }
      queue.push(edge.to);
    }
  }
  return null;
}

for (const [name, net] of nets) {
  for (const limits of [{ milliseconds: Infinity }, { markings: 4, milliseconds: Infinity }]) {
    test(`${name}: one walk gives the same ways as one walk per marking (limit ${limits.markings ?? 'none'})`, () => {
      const result = explore(net, limits);
      for (const { key } of result.markings) assert.deepEqual(pathTo(result, key), oldPathTo(result, key), key);
      assert.equal(shortestWays(result), shortestWays(result), 'the walk is not kept with its result');
    });
  }
}

test('a deadlock and a query get the same answers as before', () => {
  const result = explore(readNet(fixtures.deadlock), { milliseconds: Infinity });
  const found = pathToDeadlock(result);
  assert.deepEqual({ transitions: found.transitions, markings: found.markings }, oldPathTo(result, found.key));
  assert.ok(wayTo(result, new Map([['mid', 1]])));
});

test('the progress hook is called, ends with the final count and changes no result', () => {
  // 2^12 markings: twelve independent places that lose their token.
  const places = {};
  const transitions = [];
  const arcs = [];
  for (let i = 0; i < 12; i += 1) {
    places[`p${i}`] = 1;
    transitions.push(`t${i}`);
    arcs.push([`p${i}`, `t${i}`]);
  }
  const net = readNet(build(places, transitions, arcs));

  const calls = [];
  const watched = explore(net, { milliseconds: Infinity, progress: (state) => calls.push(state) });
  const plain = explore(net, { milliseconds: Infinity });

  assert.deepEqual(watched, plain);
  assert.ok(calls.length >= 4000 / 500, `only ${calls.length} reports for ${watched.markings.length} markings`);
  assert.deepEqual(calls[calls.length - 1], { markings: watched.markings.length, edges: watched.edges.length });
  assert.ok(calls.every((state, i) => i === 0 || state.markings >= calls[i - 1].markings), 'progress went backwards');
});

test('a further search has ten times the limits, and what is none stays none', async () => {
  const { furtherLimits } = await import('./run.js');
  assert.deepEqual(furtherLimits({}), { markings: 200000, milliseconds: 20000 });
  assert.deepEqual(furtherLimits({ markings: 500, milliseconds: 100 }), { markings: 5000, milliseconds: 1000 });
  assert.equal(furtherLimits({ milliseconds: null }).milliseconds, null);
  assert.deepEqual(furtherLimits({ structure: { places: 40 } }).structure, { places: 40 });
});
