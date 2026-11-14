/**
 * Runs the searches off the page, in a worker, and on the page where there is
 * none.
 *
 * The search over the markings of a net can take seconds, and on the page that is
 * a frozen canvas, or in a host that watches for a page that does not answer, a
 * page that gets reloaded. In a worker the canvas stays alive.
 *
 * A worker cannot be interrupted while it searches, so stopping means ending it;
 * the next request starts a fresh one. There is one per kind of search, so
 * Analyse and the state space can run at the same time. A search is stopped by
 * anything that changes the net, by `cancel`, and by the end of the modeler, and
 * what it would have answered is dropped: `run` then resolves to null.
 *
 * Where there is no worker (Node, a host whose policy forbids blob workers, a
 * browser without them) the same functions run on the page, after one timer tick
 * so that whatever shows "searching" has been drawn first. The page then freezes
 * as it always did, and the limits keep it short. The service says which it is in
 * `mode`, and warns once on the console when it had to fall back.
 */
import { plainLimits, runSearch } from './run.js';
import workerSource from './workerSource.js';

export default class Search {
  static $inject = ['eventBus', 'config.netSearch'];

  constructor(eventBus, config) {
    this._eventBus = eventBus;
    this._wanted = !(config && config.worker === false);
    this._inline = !this._wanted || !Search.workersAvailable();
    this._workers = new Map();
    this._jobs = new Map();
    this._byKind = new Map();
    this._next = 1;
    this._url = null;
    this._idle = [];
    this._replacing = false;
    // A worker that neither answers nor fails, which a host could cause with a policy
    // of its own, would leave every analysis waiting for ever. The fall back has the page
    // do it instead.
    this._readyAfter = config?.readyTimeout ?? 10000;

    // Anything that changes the net makes an answer about it wrong.
    eventBus.on(['commandStack.changed', 'import.done', 'diagram.clear'], () => this.cancel());
    eventBus.on('diagram.destroy', () => this._destroy());
  }

  /** Whether this environment can start a worker from a Blob. */
  static workersAvailable() {
    return typeof Worker === 'function' && typeof Blob === 'function'
      && typeof URL === 'function' && typeof URL.createObjectURL === 'function';
  }

  /** 'worker', or 'inline' where the searches run on the page. */
  get mode() {
    return this._inline ? 'inline' : 'worker';
  }

  /** Whether a search of this kind is running; without a kind, whether any is. */
  busy(kind) {
    return kind ? this._byKind.has(kind) : this._byKind.size > 0;
  }

  /** Resolves when no search is running. */
  idle() {
    return this.busy() ? new Promise((resolve) => this._idle.push(resolve)) : Promise.resolve();
  }

  /**
   * @param kind   'analyse' or 'explore'
   * @param net    a net read by readNet
   * @param limits as for explore(); `now` and `progress` stay on the page
   * @returns {Promise<object | null>} the answer of runSearch, or null where the
   *   search was stopped. A net the core cannot search is refused by the caller
   *   before it gets here.
   */
  run(kind, net, limits = {}) {
    const plain = plainLimits(limits);
    // Infinity and null are different limits and must not look alike: JSON writes both as null.
    const key = `${kind}\u0000${JSON.stringify([net, plain, Object.keys(limits).some((name) => name === 'now')],
      (name, value) => (value === Infinity ? 'Infinity' : value))}`;

    // The same question asked again while it is being answered is the same answer.
    const running = this._byKind.get(kind);
    if (running && running.key === key && !running.cancelled) return running.promise;
    if (running) {
      // The one that replaces it starts at once; whoever waits for idle must not be woken in between.
      this._replacing = true;
      this.cancel(kind);
      this._replacing = false;
    }

    const job = { id: this._next, kind, key, cancelled: false, net, limits: plain, clock: limits.now ?? null };
    this._next += 1;
    job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
    this._jobs.set(job.id, job);
    this._byKind.set(kind, job);

    // A clock cannot be sent to a worker, so a request that brings its own runs here.
    if (this._inline || job.clock) this._runHere(job, limits);
    else this._runInWorker(job);

    return job.promise;
  }

  /** Stops the search of a kind, or all of them. Their promises resolve to null. */
  cancel(kind) {
    for (const job of [...this._jobs.values()]) {
      if (kind && job.kind !== kind) continue;
      job.cancelled = true;
      this._finish(job, null);
      // Ending the worker is the only way to stop it mid search.
      this._endWorker(job.kind);
    }
  }

  // ── where the work happens ─────────────────────────────────────────────

  async _runHere(job, limits) {
    // One tick, so that the row that says "searching" is on the screen first.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (job.cancelled) return;

    try {
      const answer = runSearch(job.kind, job.net, {
        ...limits,
        progress: (state) => this._eventBus.fire('search.progress', { kind: job.kind, ...state }),
      });
      this._finish(job, job.cancelled ? null : answer);
    } catch (error) {
      this._fail(job, error);
    }
  }

  _runInWorker(job) {
    let entry;
    try {
      entry = this._workerFor(job.kind);
    } catch (error) {
      this._fallBack(error);
      this._runHere(job, job.limits);
      return;
    }

    entry.pending.add(job.id);
    const send = () => {
      try {
        entry.worker.postMessage({ type: job.kind, id: job.id, net: job.net, limits: job.limits });
      } catch (error) {
        // What cannot be sent (a limit that is a function, say) is searched for here instead.
        entry.pending.delete(job.id);
        this._runHere(job, job.limits);
      }
    };
    if (entry.ready) send();
    else entry.queue.push(send);
  }

  _workerFor(kind) {
    const known = this._workers.get(kind);
    if (known) return known;

    if (!this._url) this._url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    const worker = new Worker(this._url);
    const entry = { worker, ready: false, queue: [], pending: new Set(), timer: null };
    this._workers.set(kind, entry);

    const giveUp = (reason) => {
      if (entry.ready) return;
      this._fallBack(reason);
      this._endWorker(kind);
      for (const id of entry.pending) {
        const job = this._jobs.get(id);
        if (job && !job.cancelled) this._runHere(job, job.limits);
      }
    };
    entry.timer = setTimeout(() => giveUp(new Error('the worker did not say it was ready')), this._readyAfter);

    worker.onmessage = (event) => {
      const message = event.data;
      if (message.type === 'ready') {
        clearTimeout(entry.timer);
        entry.ready = true;
        for (const send of entry.queue.splice(0)) send();
        return;
      }

      const job = this._jobs.get(message.id);
      if (!job || job.cancelled) return;
      if (message.type === 'progress') {
        this._eventBus.fire('search.progress', { kind: job.kind, markings: message.markings, edges: message.edges });
      } else if (message.type === 'result') {
        this._finish(job, message.answer);
      } else if (message.type === 'error') {
        this._fail(job, new Error(message.message));
      }
    };

    // An error before the worker said it was ready means it cannot run here, a
    // policy that forbids blob workers for instance: the searches run on the page.
    worker.onerror = (event) => {
      if (entry.ready) {
        for (const id of entry.pending) {
          const job = this._jobs.get(id);
          if (job) this._fail(job, new Error(event.message || 'the search worker failed'));
        }
        return;
      }

      event.preventDefault?.();
      giveUp(new Error(event.message || 'the worker did not start'));
    };

    return entry;
  }

  _endWorker(kind) {
    const entry = this._workers.get(kind);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.worker.terminate();
    this._workers.delete(kind);
  }

  _fallBack(reason) {
    if (this._inline) return;
    this._inline = true;
    // Once, so that a host log carries it and a console is not flooded.
    console.warn(`PetriNet.js: the search runs on the page, not in a worker (${reason?.message ?? reason}).`);
  }

  // ── ending a job ───────────────────────────────────────────────────────

  _finish(job, answer) {
    if (!this._jobs.delete(job.id)) return;
    if (this._byKind.get(job.kind) === job) this._byKind.delete(job.kind);
    this._workers.get(job.kind)?.pending.delete(job.id);
    job.resolve(answer);
    this._wake();
  }

  _fail(job, error) {
    if (!this._jobs.delete(job.id)) return;
    if (this._byKind.get(job.kind) === job) this._byKind.delete(job.kind);
    this._workers.get(job.kind)?.pending.delete(job.id);
    job.reject(error);
    this._wake();
  }

  _wake() {
    if (this._replacing || this.busy()) return;
    for (const resolve of this._idle.splice(0)) resolve();
  }

  _destroy() {
    this.cancel();
    for (const kind of [...this._workers.keys()]) this._endWorker(kind);
    if (this._url) URL.revokeObjectURL(this._url);
    this._url = null;
  }
}
