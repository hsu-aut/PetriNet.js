import assert from 'node:assert/strict';
import { test } from 'node:test';

import Findings from './Findings.js';

/** The two things of diagram-js the service touches, as far as it touches them. */
function fixture(elements = [], search = null) {
  const listeners = new Map();
  const fired = [];
  const registry = new Map(elements.map((element) => [element.id, element]));

  const eventBus = {
    on(names, callback) {
      for (const name of [].concat(names)) {
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push(callback);
      }
    },
    fire(name, payload) {
      fired.push([name, payload]);
      for (const callback of listeners.get(name) ?? []) callback(payload);
    },
  };
  const elementRegistry = {
    getAll: () => [...registry.values()],
    get: (id) => registry.get(id),
  };

  const injector = { get: (name) => (name === 'netSearch' ? search ?? undefined : undefined) };
  const findings = new Findings(eventBus, elementRegistry, injector);
  return {
    findings,
    registry,
    fired,
    eventBus,
    edit: () => eventBus.fire('commandStack.changed', {}),
    imported: () => eventBus.fire('import.done', {}),
    last: () => fired.filter(([name]) => name === 'findings.changed').at(-1)?.[1],
  };
}

const shape = (id, type, bo = {}) => ({ id, type, businessObject: { id, $type: type, ...bo } });
const place = (id, marking) => shape(id, 'ptn:Place', { name: id, initialMarking: marking });
const transition = (id) => shape(id, 'ptn:Transition', { name: id });
const arc = (id, source, target) => ({ ...shape(id, 'ptn:Arc'), source, target });

/** A net that gets stuck: Idle -> Go -> Done, where Done has no way on. */
function stuck() {
  const idle = place('idle', 1);
  const go = transition('go');
  const done = place('done');
  return [idle, go, done, arc('a1', idle, go), arc('a2', go, done)];
}

const hostFinding = (over = {}) => ({
  rule: 'PT05',
  severity: 'error',
  element: 'idle',
  message: 'Something the host found.',
  ...over,
});

test('findings of the host come out beside the computed ones, errors first', async () => {
  const { findings } = fixture(stuck());
  await findings.analyse();
  findings.setHostFindings([hostFinding()]);

  const all = findings.all;
  assert.equal(all[0].rule, 'PT05', 'an error comes before the warnings of the analysis');
  assert.ok(all.length > 1);
  assert.ok(all.some((finding) => finding.rule.startsWith('PT1')), 'the computed findings are still there');
});

test('an edit drops the computed findings and keeps the host\'s', async () => {
  const { findings, edit } = fixture(stuck());
  await findings.analyse();
  findings.setHostFindings([hostFinding()]);

  edit();

  assert.deepEqual(findings.all.map((finding) => finding.rule), ['PT05']);
  assert.equal(findings.stale, true, 'the panel has to be able to say that the analysis is gone');
  assert.equal(findings.net, null);
});

test('an import drops the computed findings and keeps the host\'s', async () => {
  const { findings, imported } = fixture(stuck());
  await findings.analyse();
  findings.setHostFindings([hostFinding()]);

  imported();

  assert.deepEqual(findings.all.map((finding) => finding.rule), ['PT05']);
  assert.equal(findings.stale, true);
});

test('host findings alone are not stale after an edit: nothing was dropped', () => {
  const { findings, edit } = fixture(stuck());
  findings.setHostFindings([hostFinding()]);

  edit();

  assert.equal(findings.stale, false);
  assert.equal(findings.all.length, 1);
});

test('an edit tells the panel to draw the list again, so a link can go', () => {
  const { findings, edit, last } = fixture(stuck());
  findings.setHostFindings([hostFinding()]);
  const before = last();

  edit();

  assert.notEqual(last(), before, 'findings.changed was fired for the edit');
});

test('with nothing to drop an edit stays quiet', () => {
  const { edit, fired } = fixture(stuck());
  const before = fired.length;

  edit();

  assert.equal(fired.length, before + 1, 'only the edit itself, no findings.changed');
});

test('a finding about an element that is gone is not a link', () => {
  const { findings, registry } = fixture(stuck());
  findings.setHostFindings([hostFinding({ element: 'idle' }), hostFinding({ element: null })]);

  assert.equal(findings.canShow(findings.all[0]), true);
  assert.equal(findings.canShow(findings.all[1]), false, 'a finding about the whole net leads nowhere');

  registry.delete('idle');
  assert.equal(findings.canShow(findings.all[0]), false);
  assert.equal(findings.show(findings.all[0]), false);
});

test('analysing again does not drop the host\'s findings', async () => {
  const { findings } = fixture(stuck());
  findings.setHostFindings([hostFinding()]);

  await findings.analyse();
  await findings.analyse();

  assert.equal(findings.all.filter((finding) => finding.rule === 'PT05').length, 1);
});

test('the host replaces its findings with a new list, or empties them', () => {
  const { findings } = fixture(stuck());
  findings.setHostFindings([hostFinding(), hostFinding({ rule: 'PT06' })]);
  assert.equal(findings.host.length, 2);

  findings.setHostFindings([hostFinding({ rule: 'PT07' })]);
  assert.deepEqual(findings.host.map((finding) => finding.rule), ['PT07']);

  findings.setHostFindings([]);
  assert.equal(findings.host.length, 0);

  findings.setHostFindings(null);
  assert.equal(findings.host.length, 0);
});

test('the counts are the host\'s own, not those of the analysis', async () => {
  const { findings } = fixture(stuck());
  await findings.analyse();
  findings.setHostFindings([
    hostFinding(),
    hostFinding({ severity: 'warning' }),
    hostFinding({ severity: 'warning' }),
    hostFinding({ severity: 'information' }),
  ]);

  assert.deepEqual(findings.hostCounts, { errors: 1, warnings: 2 });
});

test('a severity the list does not know is shown as information', () => {
  const { findings } = fixture(stuck());
  findings.setHostFindings([
    hostFinding({ severity: 'fatal' }),
    hostFinding({ severity: 'toString' }),
    hostFinding({ severity: undefined }),
  ]);

  assert.deepEqual(findings.host.map((finding) => finding.severity), ['information', 'information', 'information']);
});

test('clear() still drops everything, the host\'s findings included', async () => {
  const { findings } = fixture(stuck());
  await findings.analyse();
  findings.setHostFindings([hostFinding()]);

  findings.clear();

  assert.deepEqual(findings.all, []);
  assert.equal(findings.stale, false);
});

/** A net that cannot be analysed: an arc with the weight 0. */
function unreadable() {
  const p = place('p', 1);
  const t = transition('t');
  return [p, t, { ...arc('a', p, t), businessObject: { id: 'a', $type: 'ptn:Arc', inscription: '0' } }];
}

test('a net that could not be analysed has its reason dropped by an edit', async () => {
  const { findings, edit } = fixture(unreadable());
  await findings.analyse();
  assert.match(findings.problem, /weight of arc a is 0/);

  edit();

  assert.equal(findings.problem, null, 'the reason described the net as it was');
  assert.equal(findings.stale, true, 'an empty list after an edit must not read as a clean net');
});

test('the findings of the host are still there while the net cannot be analysed', async () => {
  const { findings, last } = fixture(unreadable());
  findings.setHostFindings([hostFinding({ rule: 'PT07', element: 'a' })]);

  await findings.analyse();

  assert.ok(findings.problem);
  assert.deepEqual(findings.all.map((finding) => finding.rule), ['PT07']);
  assert.equal(last().findings.length, 1, 'the panel is given them');
});

test('an import drops the reason a net could not be analysed as well', async () => {
  const { findings, imported } = fixture(unreadable());
  await findings.analyse();

  imported();

  assert.equal(findings.problem, null);
});

// ── while the search runs ───────────────────────────────────────────────────

/** A search service that answers when the test says so. */
function slowSearch() {
  const calls = [];
  return {
    calls,
    cancelled: [],
    run(kind, net, limits) {
      return new Promise((resolve) => calls.push({ kind, net, limits, resolve }));
    },
    cancel(kind) {
      // As the real service does: a search that is stopped resolves to null.
      this.cancelled.push(kind);
      for (const call of this.calls) call.resolve(null);
    },
  };
}

test('an analysis that is running says so, and the answer replaces it', async () => {
  const search = slowSearch();
  const { findings, last } = fixture(stuck(), search);

  const running = findings.analyse({ markings: 50 });
  assert.equal(findings.busy, true);
  assert.equal(last().busy, true);
  assert.deepEqual(findings.progress, { markings: 0, edges: 0, limit: 50 });
  assert.equal(search.calls.length, 1);
  assert.equal(search.calls[0].kind, 'analyse');

  // The core's answer, as a worker gives it.
  const { runSearch } = await import('../search/run.js');
  search.calls[0].resolve(runSearch('analyse', search.calls[0].net, { milliseconds: Infinity }));
  const answer = await running;

  assert.ok(answer.length > 0);
  assert.equal(findings.busy, false);
  assert.equal(last().busy, false);
  assert.ok(findings.all.some((finding) => finding.rule === 'PT15'));
});

test('progress is passed on while it runs', async () => {
  const search = slowSearch();
  const { findings, eventBus, fired } = fixture(stuck(), search);
  findings.analyse({ markings: 100 });

  const progress = () => fired.filter(([name]) => name === 'findings.progress').map(([, event]) => event.progress);
  eventBus.fire('search.progress', { kind: 'analyse', markings: 40, edges: 60 });
  assert.deepEqual(progress(), [{ markings: 40, edges: 60, limit: 100 }]);

  // The progress of another kind of search is not ours.
  eventBus.fire('search.progress', { kind: 'explore', markings: 7, edges: 7 });
  assert.equal(progress().length, 1);
});

test('stopping resolves to null, says the analysis was stopped and drops the answer when it comes', async () => {
  const search = slowSearch();
  const { findings, last } = fixture(stuck(), search);

  const running = findings.analyse();
  findings.cancel();

  assert.equal(findings.busy, false);
  assert.equal(findings.stopped, true);
  assert.equal(last().stopped, true);
  assert.deepEqual(search.cancelled, ['analyse']);

  // A worker that answers anyway is not listened to.
  search.calls[0].resolve({ findings: [{ rule: 'PT99', severity: 'error', message: 'late.' }], complete: true });
  assert.equal(await running, null);
  assert.deepEqual(findings.all, []);
});

test('an edit while it runs ends it, and the list says the net changed', async () => {
  const search = slowSearch();
  const { findings, edit, last } = fixture(stuck(), search);

  const running = findings.analyse();
  edit();

  assert.equal(findings.busy, false);
  assert.equal(findings.stale, true);
  assert.equal(last().stale, true);
  search.calls[0].resolve(null);
  assert.equal(await running, null);
  assert.deepEqual(findings.all, []);
});

test('a new analysis replaces the one that is running, and only its answer counts', async () => {
  const search = slowSearch();
  const { findings } = fixture(stuck(), search);

  const first = findings.analyse();
  const second = findings.analyse();
  const { runSearch } = await import('../search/run.js');

  search.calls[1].resolve(runSearch('analyse', search.calls[1].net, { milliseconds: Infinity }));
  search.calls[0].resolve({ findings: [{ rule: 'PT99', severity: 'error', message: 'old.' }], complete: true });

  assert.equal(await first, null);
  assert.ok((await second).length > 0);
  assert.ok(!findings.all.some((finding) => finding.rule === 'PT99'));
});

test('a net the core cannot read is answered at once, without a search', async () => {
  const search = slowSearch();
  const { findings } = fixture([place('p', 1), transition('t'), arc('a1', place('p', 1), place('q', 0))], search);
  await findings.analyse();
  assert.equal(search.calls.length, 0);
  assert.ok(findings.problem);
});

test('the way into a deadlock and the run of an invariant come with the findings', async () => {
  // Two end places, so that it is not a workflow net and its end is a deadlock.
  const a = place('a', 1);
  const go = transition('go');
  const b = place('b');
  const c = place('c');
  const { findings } = fixture([a, go, b, c, arc('x1', a, go), arc('x2', go, b), arc('x3', go, c)]);
  await findings.analyse();
  const deadlock = findings.all.find((finding) => finding.rule === 'PT15');
  assert.deepEqual(findings.wayTo(deadlock)?.transitions, ['go']);
  assert.equal(findings.wayTo({ rule: 'PT13' }), null);
  assert.equal(findings.runFor({ rule: 'PT13' }), null);
});

test('the findings of a host that arrive while the search runs are listed at once, not at the end', async () => {
  const search = slowSearch();
  const { findings, last } = fixture(stuck(), search);
  findings.analyse();
  findings.setHostFindings([hostFinding({ message: 'Arrived meanwhile.' })]);
  assert.equal(last().busy, true);
  assert.deepEqual(last().findings.map((finding) => finding.message), ['Arrived meanwhile.']);
});

test('a search that is ended from outside does not leave the list saying it is working', async () => {
  const search = slowSearch();
  const { findings, last } = fixture(stuck(), search);
  const running = findings.analyse();
  search.calls[0].resolve(null); // netSearch.cancel(), say
  assert.equal(await running, null);
  assert.equal(findings.busy, false);
  assert.equal(last().busy, false);
  assert.equal(last().stopped, true);
});

test('the way into a marking is only offered for a finding that is in the list now', async () => {
  const a = place('a', 1);
  const go = transition('go');
  const b = place('b');
  const c = place('c');
  const { findings, edit } = fixture([a, go, b, c, arc('x1', a, go), arc('x2', go, b), arc('x3', go, c)]);
  await findings.analyse();
  const deadlock = findings.all.find((finding) => finding.rule === 'PT15');
  assert.ok(findings.wayTo(deadlock));
  edit();
  assert.equal(findings.wayTo(deadlock), null, 'a way into a marking of a net that has changed');
});

// ── searching further ───────────────────────────────────────────────────────

const stoppedAnswer = (rule = 'PT99') => ({
  complete: false, stopped: 'markings', markings: 5, unbounded: [], classes: [], workflow: null,
  findings: [{ rule, severity: 'information', message: 'Partial.' }],
});

function furtherFixture() {
  const search = slowSearch();
  search.mode = 'worker';
  return { search, ...fixture(stuck(), search) };
}

test('a further search is offered after a search that stopped at its limit, and only then', async () => {
  const { findings, search } = furtherFixture();
  assert.equal(findings.canSearchFurther, false, 'before any analysis');

  const first = findings.analyse({ markings: 50, milliseconds: 100 });
  assert.equal(findings.canSearchFurther, false, 'while it runs');
  search.calls[0].resolve(stoppedAnswer());
  await first;
  assert.equal(findings.canSearchFurther, true);
  assert.deepEqual(findings.furtherPreview, { markings: 500, seconds: 1 });

  // A search that finished says nothing about a further one.
  const second = findings.analyse();
  search.calls[1].resolve({ ...stoppedAnswer(), complete: true, stopped: null });
  await second;
  assert.equal(findings.canSearchFurther, false);
});

test('without a worker there is no further search', async () => {
  const search = slowSearch();
  search.mode = 'inline';
  const { findings } = fixture(stuck(), search);
  const running = findings.analyse();
  search.calls[0].resolve(stoppedAnswer());
  await running;
  assert.equal(findings.canSearchFurther, false);
  assert.equal(await findings.searchFurther(), null);
});

test('a further search runs with ten times the limits, once, and says when that was not enough', async () => {
  const { findings, search, last } = furtherFixture();
  const first = findings.analyse({ markings: 50, milliseconds: 100 });
  search.calls[0].resolve(stoppedAnswer());
  await first;

  const further = findings.searchFurther();
  assert.equal(search.calls.length, 2);
  assert.deepEqual(search.calls[1].limits, { markings: 500, milliseconds: 1000 });
  assert.equal(findings.further, true);
  assert.deepEqual(findings.progress.limit, 500);

  search.calls[1].resolve(stoppedAnswer('PT98'));
  await further;
  assert.equal(findings.canSearchFurther, false, 'a second further search was offered');
  assert.equal(last().further, true);
  assert.equal(last().cutOff, 'markings');
  assert.deepEqual(findings.all.map((finding) => finding.rule), ['PT98']);
});

test('stopping a further search brings back the earlier answer', async () => {
  const { findings, search, last } = furtherFixture();
  const first = findings.analyse({ markings: 50 });
  search.calls[0].resolve(stoppedAnswer('PT97'));
  await first;

  const further = findings.searchFurther();
  assert.deepEqual(findings.all, [], 'the earlier list stays while the search runs');
  findings.cancel();

  assert.equal(await further, null);
  assert.deepEqual(findings.all.map((finding) => finding.rule), ['PT97']);
  assert.equal(last().furtherStopped, true);
  assert.equal(last().stopped, false);
  assert.equal(findings.canSearchFurther, true, 'the earlier answer was cut off and may be searched further again');
});

test('an edit during a further search drops everything', async () => {
  const { findings, search, edit, last } = furtherFixture();
  const first = findings.analyse({ markings: 50 });
  search.calls[0].resolve(stoppedAnswer());
  await first;

  const further = findings.searchFurther();
  edit();
  search.calls[1].resolve(null);
  assert.equal(await further, null);
  assert.deepEqual(findings.all, []);
  assert.equal(last().stale, true);
  assert.equal(findings.further, false);
});

test('an analysis asked for again with nothing said joins a further search that is running', async () => {
  const { findings, search } = furtherFixture();
  const first = findings.analyse({ markings: 50 });
  search.calls[0].resolve(stoppedAnswer());
  await first;

  const further = findings.searchFurther();
  const joined = findings.analyse();
  assert.equal(joined, further, 'the menu threw the long search away');
  assert.equal(search.calls.length, 2, 'a second search was started');
  search.calls[1].resolve(stoppedAnswer());
  await further;
});
