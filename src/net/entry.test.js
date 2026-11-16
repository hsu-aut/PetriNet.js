import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as entry from '../../net.js';
import { loop } from './fixtures.js';

test('the public entry for the core works in plain Node, without a browser', () => {
  assert.equal(typeof document, 'undefined');
  assert.equal(typeof entry.analyseData, 'function');
  assert.equal(typeof entry.analyse, 'function');
  assert.equal(typeof entry.exploreData, 'function');
  assert.equal(typeof entry.explore, 'function');
  assert.equal(typeof entry.toDot, 'function');
  assert.equal(typeof entry.markingsToCsv, 'function');
  assert.equal(typeof entry.readNet, 'function');
  assert.equal(typeof entry.findingsToCsv, 'function');
  assert.equal(entry.OMEGA, Infinity);
  assert.ok('PT15' in entry.RULES);

  const answer = entry.analyseData(loop);
  assert.equal(answer.problem, null);
  assert.ok(answer.findings.length > 0);
});
