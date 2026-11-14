import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import * as fixtures from '../net/fixtures.js';
import { readNet } from '../net/model.js';
import { runSearch } from './run.js';
import Search from './Search.js';

/** The two methods of the event bus the service uses. */
function bus() {
  const handlers = new Map();
  return {
    on(names, handler) {
      for (const name of [].concat(names)) handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    fire(name, event) {
      for (const handler of handlers.get(name) ?? []) handler(event);
    },
  };
}

const net = readNet(fixtures.deadlock);
const limits = { milliseconds: Infinity };

let fakes = [];

/**
 * A worker that answers on the next tick with what runSearch gives, or as the
 * test says: `FakeWorker.mode` is 'normal', 'silent' (never answers), 'throws'
 * (the constructor throws), 'fails' (an error before ready) or 'broken' (a
 * message of type error for every request).
 */
class FakeWorker {
  static mode = 'normal';

  constructor() {
    if (FakeWorker.mode === 'throws') throw new Error('workers are not allowed here');
    this.terminated = false;
    fakes.push(this);
    setTimeout(() => {
      if (this.terminated) return;
      if (FakeWorker.mode === 'fails') this.onerror?.({ message: 'blocked by policy', preventDefault() {} });
      else this.onmessage?.({ data: { type: 'ready' } });
    }, 0);
  }

  postMessage({ type, id, net: n, limits: l }) {
    if (FakeWorker.mode === 'silent') return;
    setTimeout(() => {
      if (this.terminated) return;
      if (FakeWorker.mode === 'broken') {
        this.onmessage?.({ data: { type: 'error', id, message: 'a defect in the core' } });
        return;
      }
      this.onmessage?.({ data: { type: 'progress', id, markings: 3, edges: 2 } });
      this.onmessage?.({ data: { type: 'result', id, answer: JSON.parse(JSON.stringify(runSearch(type, n, l))) } });
    }, 0);
  }

  terminate() {
    this.terminated = true;
  }
}

const withWorkers = () => {
  FakeWorker.mode = 'normal';
  fakes = [];
  globalThis.Worker = FakeWorker;
};

afterEach(() => {
  delete globalThis.Worker;
  FakeWorker.mode = 'normal';
});

test('without Worker the searches run on the page and give the answer of runSearch', async () => {
  const search = new Search(bus(), undefined);
  assert.equal(search.mode, 'inline');
  assert.deepEqual(await search.run('analyse', net, limits), runSearch('analyse', net, limits));
});

test('config { worker: false } keeps the search on the page although a worker is there', async () => {
  withWorkers();
  const search = new Search(bus(), { worker: false });
  assert.equal(search.mode, 'inline');
  await search.run('explore', net, limits);
  assert.equal(fakes.length, 0);
});

test('with a worker the answer comes from it, and progress is passed on', async () => {
  withWorkers();
  const events = bus();
  const search = new Search(events, undefined);
  assert.equal(search.mode, 'worker');

  const progress = [];
  events.on('search.progress', (state) => progress.push(state));
  const answer = await search.run('analyse', net, limits);

  assert.deepEqual(answer, JSON.parse(JSON.stringify(runSearch('analyse', net, limits))));
  assert.deepEqual(progress, [{ kind: 'analyse', markings: 3, edges: 2 }]);
  assert.equal(fakes.length, 1);
});

test('one worker per kind of search, kept between requests', async () => {
  withWorkers();
  const search = new Search(bus(), undefined);
  await search.run('analyse', net, limits);
  await search.run('analyse', net, limits);
  await search.run('explore', net, limits);
  assert.equal(fakes.length, 2);
});

test('a change of the net stops the search, ends its worker and resolves to null', async () => {
  withWorkers();
  FakeWorker.mode = 'silent';
  const events = bus();
  const search = new Search(events, undefined);

  const running = search.run('analyse', net, limits);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(search.busy('analyse'), true);

  events.fire('commandStack.changed', {});
  assert.equal(await running, null);
  assert.equal(search.busy(), false);
  assert.equal(fakes[0].terminated, true);

  // The next request starts a fresh worker and is answered.
  FakeWorker.mode = 'normal';
  assert.ok(await search.run('analyse', net, limits));
  assert.equal(fakes.length, 2);
});

test('an import and a cleared diagram stop a search as well', async () => {
  withWorkers();
  FakeWorker.mode = 'silent';
  for (const name of ['import.done', 'diagram.clear']) {
    const events = bus();
    const search = new Search(events, undefined);
    const running = search.run('explore', net, limits);
    events.fire(name, {});
    assert.equal(await running, null, name);
  }
});

test('the same question while it is answered gets the same promise, and another one replaces it', async () => {
  withWorkers();
  FakeWorker.mode = 'silent';
  const search = new Search(bus(), undefined);

  const first = search.run('analyse', net, limits);
  assert.equal(search.run('analyse', net, limits), first);

  const other = search.run('analyse', net, { ...limits, markings: 5 });
  assert.notEqual(other, first);
  assert.equal(await first, null, 'the question it replaced was not stopped');
  search.cancel();
  assert.equal(await other, null);
});

test('a request with its own clock runs on the page, because a clock cannot be sent', async () => {
  withWorkers();
  const search = new Search(bus(), undefined);
  let ticks = 0;
  const answer = await search.run('explore', net, { milliseconds: 1e9, now: () => (ticks += 1) });
  assert.ok(answer);
  assert.equal(fakes.length, 0);
});

test('a worker that cannot be created: the search falls back to the page and warns once', async (t) => {
  withWorkers();
  FakeWorker.mode = 'throws';
  const warnings = [];
  t.mock.method(console, 'warn', (message) => warnings.push(message));

  const search = new Search(bus(), undefined);
  assert.ok(await search.run('analyse', net, limits));
  assert.ok(await search.run('explore', net, limits));
  assert.equal(search.mode, 'inline');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /not in a worker/);
});

test('an error before the worker is ready falls back to the page, and the request is still answered', async (t) => {
  withWorkers();
  FakeWorker.mode = 'fails';
  const warnings = [];
  t.mock.method(console, 'warn', (message) => warnings.push(message));

  const search = new Search(bus(), undefined);
  const answer = await search.run('analyse', net, limits);
  assert.deepEqual(answer, runSearch('analyse', net, limits));
  assert.equal(search.mode, 'inline');
  assert.equal(warnings.length, 1);
});

test('an error of the core is a rejection, not a hang', async () => {
  withWorkers();
  FakeWorker.mode = 'broken';
  const search = new Search(bus(), undefined);
  await assert.rejects(search.run('analyse', net, limits), /a defect in the core/);
  assert.equal(search.busy(), false);
});

test('idle resolves when the last search has ended', async () => {
  withWorkers();
  const search = new Search(bus(), undefined);
  assert.equal(await search.idle(), undefined);

  const running = search.run('analyse', net, limits);
  let idle = false;
  search.idle().then(() => { idle = true; });
  assert.equal(idle, false);
  await running;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(idle, true);
});

test('the end of the modeler stops the searches and ends the workers', async () => {
  withWorkers();
  FakeWorker.mode = 'silent';
  const events = bus();
  const search = new Search(events, undefined);
  const running = search.run('analyse', net, limits);
  await new Promise((resolve) => setTimeout(resolve, 10));
  events.fire('diagram.destroy', {});
  assert.equal(await running, null);
  assert.ok(fakes.every((fake) => fake.terminated));
});

test('workerSource.js is what the worker builds to now', async () => {
  const { built } = await import('../../scripts/build-worker.mjs');
  const { readFile } = await import('node:fs/promises');
  const current = (await readFile(new URL('./workerSource.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  assert.equal(current, await built(), 'run `npm run build:worker`');
});
