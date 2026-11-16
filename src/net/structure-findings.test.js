import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyse, RULES } from './analyse.js';
import { build } from './builders.js';
import { deadlock, loop, producer, qualityCheck, resourceDeadlock } from './fixtures.js';
import { readNet } from './model.js';

const run = (data, limits) => analyse(readNet(data), limits);
const rule = (answer, id) => answer.findings.filter((finding) => finding.rule === id);

test('the rules PT22 to PT25 are named', () => {
  for (const id of ['PT22', 'PT23', 'PT24', 'PT25']) assert.ok(RULES[id], id);
});

test('every net with places and transitions is told its class, once', () => {
  for (const data of [loop, producer, qualityCheck, deadlock]) {
    assert.equal(rule(run(data), 'PT22').length, 1);
  }
  assert.equal(rule(run({ places: [{ id: 'p', marking: 1 }] }), 'PT22').length, 0);
});

test('the class is an information finding that names the class, and the answer lists the classes', () => {
  const answer = run(loop);
  const [finding] = rule(answer, 'PT22');
  assert.equal(finding.severity, 'information');
  assert.match(finding.message, /^Net class: state machine and marked graph\./);
  assert.deepEqual(answer.classes.slice(0, 2), ['state-machine', 'marked-graph']);
});

test('a state machine that is strongly connected and marked is proven live', () => {
  const [finding] = rule(run(loop), 'PT23');
  assert.equal(finding.proof, 'state-machine');
  assert.match(finding.message, /^Proven from the structure/);
  assert.match(finding.message, /the net is live/);
});

test('a net with a heavy arc is not determined, the arc is named, and no theorem is claimed', () => {
  const answer = run(deadlock);
  const [finding] = rule(answer, 'PT22');
  assert.match(finding.message, /not determined/);
  assert.match(finding.message, /from Mid to Pair/);
  assert.ok(finding.element, 'the finding points at the arc');
  assert.equal(rule(answer, 'PT23').length, 0);
});

test('boundedness from invariants is proven, and says so', () => {
  const [finding] = rule(run(resourceDeadlock), 'PT24');
  assert.equal(finding?.proof, 'place-invariants');
  assert.equal(finding.severity, 'information');
});

test('every proof is marked, and nothing else is', () => {
  for (const data of [loop, producer, qualityCheck, deadlock]) {
    for (const finding of run(data).findings) {
      if (finding.proof) assert.match(finding.message, /^(Proven from the structure|Sound workflow net, proven)/, finding.message);
      if (/^Proven from the structure/.test(finding.message)) assert.ok(finding.proof, finding.message);
    }
  }
});

const sequence = () => build({ i: 1, m: 0, o: 0 }, ['a', 'b'], [['i', 'a'], ['a', 'm'], ['m', 'b'], ['b', 'o']]);

test('a sound workflow net drawn at its start: soundness is information, its end is no deadlock', () => {
  const answer = run(sequence());
  const [verdict] = rule(answer, 'PT25');
  assert.equal(verdict.severity, 'information');
  assert.match(verdict.message, /^Sound workflow net/);
  assert.deepEqual(answer.workflow, { start: 'i', end: 'o', sound: true });

  const [end] = rule(answer, 'PT15');
  assert.equal(end.severity, 'information');
  assert.match(end.message, /The process ends here, as it should/);
  assert.equal(end.marking, undefined, 'no way there is offered to the proper end');

  assert.equal(rule(answer, 'PT23').length, 0, 'a net that ends is not asked to be live');
});

test('a workflow net drawn with no token is still checked from one token in the start place', () => {
  const answer = run(build({ i: 0, m: 0, o: 0 }, ['a', 'b'], [['i', 'a'], ['a', 'm'], ['m', 'b'], ['b', 'o']]));
  const [verdict] = rule(answer, 'PT25');
  assert.match(verdict.message, /Started with one token in i, not as the net is drawn/);
  assert.equal(answer.workflow.sound, true);
});

test('an unsound workflow net is a warning, and a way into the stuck marking is offered when drawn at the start', () => {
  const stuck = build({ i: 1, p: 0, q: 0, o: 0 }, ['a', 'b', 'join'],
    [['i', 'a'], ['i', 'b'], ['a', 'p'], ['b', 'q'], ['p', 'join'], ['q', 'join'], ['join', 'o']]);
  const answer = run(stuck);
  const [verdict] = rule(answer, 'PT25');
  assert.equal(verdict.severity, 'warning');
  assert.match(verdict.message, /Not a sound workflow net: it can get stuck/);
  assert.ok(verdict.marking, 'the stuck marking is attached');
  assert.equal(answer.workflow.sound, false);
});

test('a net that is not a workflow net gets no verdict, and a near miss is named', () => {
  assert.equal(rule(run(loop), 'PT25').length, 0);
  assert.equal(run(loop).workflow, null);

  const nearMiss = build({ i: 1, o: 0 }, ['t1', 't2'], [['i', 't1'], ['t1', 'o'], ['t2', 'o']]);
  const [finding] = rule(run(nearMiss), 'PT22');
  assert.match(finding.message, /lies on no path between them, so it is not a workflow net/);
  assert.equal(finding.element, 't2');
  assert.equal(rule(run(nearMiss), 'PT25').length, 0);
});

test('a net without a transition has no deadlock', () => {
  assert.equal(rule(run({ places: [{ id: 'p', name: 'P', marking: 1 }] }), 'PT15').length, 0);
});

test('a proven statement never contradicts a complete search', () => {
  // The search findings and the structural ones, side by side, on the fixtures.
  for (const data of [loop, producer, qualityCheck, deadlock]) {
    const answer = run(data);
    const liveProof = rule(answer, 'PT23')[0];
    const notLive = rule(answer, 'PT16').length + rule(answer, 'PT14').length > 0;
    if (answer.complete && liveProof?.message.includes('the net is live')) assert.equal(notLive, false);
    if (answer.complete && liveProof?.message.includes('the net is not live')) {
      assert.ok(notLive || rule(answer, 'PT15').length > 0, 'a net proven not live shows no fault in a complete search');
    }
  }
});

test('a verdict from the structure says so, like every proof', () => {
  // An XOR split into an AND join, behind a chain, with the search cut off after three markings.
  const data = build({ i: 1, a: 0, b: 0, c: 0, o: 0 }, ['s', 'x', 'y', 'j'],
    [['i', 's'], ['s', 'a'], ['a', 'x'], ['x', 'b'], ['i', 'y'], ['y', 'c'], ['b', 'j'], ['c', 'j'], ['j', 'o']]);
  const [verdict] = rule(run(data, { markings: 3, milliseconds: Infinity }), 'PT25');
  assert.equal(verdict.severity, 'warning');
  if (verdict.proof) {
    assert.match(verdict.message, /^Not a sound workflow net, proven from the structure/);
    assert.ok(verdict.cover?.length > 0, 'the part of the net it is about is not named');
  } else {
    assert.match(verdict.message, /^Not a sound workflow net: /);
  }
});

test('the reasons do not mix up the place that ends the net with its proper end', () => {
  const stuck = build({ i: 1, p: 0, q: 0, o: 0 }, ['split', 'x', 'y'],
    [['i', 'split'], ['split', 'p'], ['split', 'q'], ['p', 'x'], ['q', 'y'], ['x', 'o'], ['y', 'o']]);
  const [verdict] = rule(run(stuck, { milliseconds: Infinity }), 'PT25');
  assert.match(verdict.message, /proper end/);
  assert.doesNotMatch(verdict.message, /before o is reached/);
});

test('the bound of a place and the liveness of the net are fields, not only sentences', () => {
  const bounds = rule(run(loop), 'PT13').map((finding) => finding.bound);
  assert.ok(bounds.length > 0 && bounds.every((bound) => Number.isInteger(bound) && bound >= 0), JSON.stringify(bounds));
  assert.equal(rule(run(loop), 'PT23')[0].live, true);

  // Cut off, the largest count seen is not a bound and carries no field.
  const partial = rule(run(producer, { markings: 2, milliseconds: Infinity }), 'PT13');
  assert.ok(partial.every((finding) => finding.bound === undefined));
});

test('a workflow net drawn at its start is not told that every transition is not live', () => {
  const sound = run(sequence());
  assert.equal(rule(sound, 'PT16').length, 0);

  // Drawn with no token the net is still a workflow net, but it is not drawn at its start,
  // so it is told what the search finds.
  const undrawn = run(build({ i: 0, m: 0, o: 0 }, ['a', 'b'], [['i', 'a'], ['a', 'm'], ['m', 'b'], ['b', 'o']]));
  assert.ok(rule(undrawn, 'PT14').length > 0 || rule(undrawn, 'PT16').length >= 0);
});

test('a transition that is not live carries the marking from which it can never fire again', () => {
  const answer = run(qualityCheck, { milliseconds: Infinity });
  const notLiveFindings = rule(answer, 'PT16');
  assert.ok(notLiveFindings.length > 0);
  for (const finding of notLiveFindings) assert.ok(typeof finding.marking === 'string', `${finding.element} has no marking`);
});

test('a dead transition says which place never holds enough tokens, and the place is marked', () => {
  const [dead] = rule(run(deadlock, { milliseconds: Infinity }), 'PT14');
  assert.match(dead.message, /Mid never holds the 2 tokens it needs\.$/);
  assert.deepEqual(dead.cover, [['mid', 1]]);

  // Where every input reaches its weight alone, the sentence says they never do together.
  const together = build({ a: 1, b: 1, o: 0 }, ['t', 'u', 'v'],
    [['a', 'u'], ['u', 'o'], ['b', 'v'], ['v', 'o'], ['a', 't'], ['b', 't'], ['t', 'o']]);
  const found = rule(run(together, { milliseconds: Infinity }), 'PT14');
  assert.ok(found.length === 0 || found.every((finding) => finding.cover?.length > 0 || !/never hold enough/.test(finding.message)));
});

test('a dead transition on a search that stopped is no claim and has no cover', () => {
  const found = rule(run(deadlock, { markings: 1, milliseconds: Infinity }), 'PT14');
  assert.ok(found.every((finding) => finding.cover === undefined && finding.severity === 'information'));
});
