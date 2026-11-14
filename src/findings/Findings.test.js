import assert from 'node:assert/strict';
import { test } from 'node:test';

import Findings from './Findings.js';

/** The two things of diagram-js the service touches, as far as it touches them. */
function fixture(elements = []) {
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

  const findings = new Findings(eventBus, elementRegistry);
  return {
    findings,
    registry,
    fired,
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

test('findings of the host come out beside the computed ones, errors first', () => {
  const { findings } = fixture(stuck());
  findings.analyse();
  findings.setHostFindings([hostFinding()]);

  const all = findings.all;
  assert.equal(all[0].rule, 'PT05', 'an error comes before the warnings of the analysis');
  assert.ok(all.length > 1);
  assert.ok(all.some((finding) => finding.rule.startsWith('PT1')), 'the computed findings are still there');
});

test('an edit drops the computed findings and keeps the host\'s', () => {
  const { findings, edit } = fixture(stuck());
  findings.analyse();
  findings.setHostFindings([hostFinding()]);

  edit();

  assert.deepEqual(findings.all.map((finding) => finding.rule), ['PT05']);
  assert.equal(findings.stale, true, 'the panel has to be able to say that the analysis is gone');
  assert.equal(findings.net, null);
});

test('an import drops the computed findings and keeps the host\'s', () => {
  const { findings, imported } = fixture(stuck());
  findings.analyse();
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

test('analysing again does not drop the host\'s findings', () => {
  const { findings } = fixture(stuck());
  findings.setHostFindings([hostFinding()]);

  findings.analyse();
  findings.analyse();

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

test('the counts are the host\'s own, not those of the analysis', () => {
  const { findings } = fixture(stuck());
  findings.analyse();
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

test('clear() still drops everything, the host\'s findings included', () => {
  const { findings } = fixture(stuck());
  findings.analyse();
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

test('a net that could not be analysed has its reason dropped by an edit', () => {
  const { findings, edit } = fixture(unreadable());
  findings.analyse();
  assert.match(findings.problem, /weight of arc a is 0/);

  edit();

  assert.equal(findings.problem, null, 'the reason described the net as it was');
  assert.equal(findings.stale, true, 'an empty list after an edit must not read as a clean net');
});

test('the findings of the host are still there while the net cannot be analysed', () => {
  const { findings, last } = fixture(unreadable());
  findings.setHostFindings([hostFinding({ rule: 'PT07', element: 'a' })]);

  findings.analyse();

  assert.ok(findings.problem);
  assert.deepEqual(findings.all.map((finding) => finding.rule), ['PT07']);
  assert.equal(last().findings.length, 1, 'the panel is given them');
});

test('an import drops the reason a net could not be analysed as well', () => {
  const { findings, imported } = fixture(unreadable());
  findings.analyse();

  imported();

  assert.equal(findings.problem, null);
});
