/**
 * What is wrong with the net, as a list.
 *
 * The findings come from two places. The behavioural ones are computed here
 * from the drawing through the analysis core, which needs nothing but the
 * canvas. The others come from whoever hosts the modeler, which may check the
 * net against rules of its own, or against the document the net sits in. Both
 * kinds end up in one list in the order a reader wants them, errors first,
 * because a reader does not care which half of a program found a problem.
 */
import { netFromElements } from '../net/fromDiagram.js';
import { readNet } from '../net/model.js';
import { SEARCH_LIMITS } from '../net/explore.js';
import { furtherLimits, runSearch } from '../search/run.js';

const ORDER = { error: 0, warning: 1, information: 2 };

export default class Findings {
  static $inject = ['eventBus', 'elementRegistry', 'injector'];

  constructor(eventBus, elementRegistry, injector) {
    this._eventBus = eventBus;
    this._elementRegistry = elementRegistry;
    // The search runs in a worker where the modeler has one; without the service it
    // runs here, one answer at a time.
    this._search = injector?.get('netSearch', false) ?? null;
    this._busy = false;
    this._stopped = false;
    this._run = 0;
    this._limit = null;
    this._progress = null;
    // The limits of the last analysis, the answer it replaced while a further search runs,
    // and whether the answer on show came from a further search.
    this._lastLimits = {};
    this._previous = null;
    this._further = false;
    this._furtherStopped = false;
    this._pending = null;

    this._own = [];
    this._fromHost = [];
    this._problem = null;
    this._stale = false;
    // The net the findings are about, as the core read it.
    this._net = null;
    this._answer = null;

    // An edited net makes the computed findings stale, which is worse than no
    // findings: a reader trusts a list that is on the screen. Saying so is not
    // the same as saying that the net is fine, hence the flag. The host's
    // findings stay where they are until the host sends new ones, because only
    // the host can say whether the edit cured them; the list is drawn again,
    // so that a finding about an element that is gone stops being a link.
    //
    // A net that could not be analysed is dropped the same way: the reason was
    // about the net as it was, and a reader who has fixed it must not be told
    // the old one.
    eventBus.on(['commandStack.changed', 'import.done'], () => {
      // A search still running is about the net as it was. It is ended, and the
      // list says why there is nothing in it.
      if (this._busy) {
        this._end();
        this._stale = true;
        this._previous = null;
        this._further = false;
        this._changed();
        return;
      }

      if (!this._own.length && !this._fromHost.length && !this._problem) return;

      if (this._own.length || this._problem) {
        this._dropOwn();
        this._stale = true;
      }
      this._changed();
    });

    eventBus.on('search.progress', (event) => {
      if (!this._busy || event.kind !== 'analyse') return;
      this._progress = { markings: event.markings, edges: event.edges };
      // Not `findings.changed`: the list has not changed, and a host's findings that arrive
      // meanwhile must still be drawn.
      this._eventBus.fire('findings.progress', { progress: this.progress });
    });
  }

  /** The findings as they are now, errors first. */
  get all() {
    return [...this._own, ...this._fromHost].sort(
      (a, b) => (ORDER[a.severity] ?? 3) - (ORDER[b.severity] ?? 3),
    );
  }

  /** The findings the host handed in, errors first. */
  get host() {
    return [...this._fromHost].sort(
      (a, b) => (ORDER[a.severity] ?? 3) - (ORDER[b.severity] ?? 3),
    );
  }

  /** How many errors and warnings the host found, for a button that says so. */
  get hostCounts() {
    return {
      errors: this._fromHost.filter((finding) => finding.severity === 'error').length,
      warnings: this._fromHost.filter((finding) => finding.severity === 'warning').length,
    };
  }

  /** Whether the computed findings were dropped because the net changed. */
  get stale() {
    return this._stale;
  }

  /** Why the net could not be analysed, as a sentence, or null. */
  get problem() {
    return this._problem;
  }

  /** Whether an analysis is running. */
  get busy() {
    return this._busy;
  }

  /** Whether the last analysis was stopped by the reader. */
  get stopped() {
    return this._stopped;
  }

  /** How far a running analysis is, `{ markings, edges }`, and the most markings it will look at. */
  get progress() {
    return this._busy ? { ...(this._progress ?? { markings: 0, edges: 0 }), limit: this._limit } : null;
  }

  /**
   * Reads the net from the canvas and analyses it, in a worker where there is
   * one, so that the canvas stays usable meanwhile.
   *
   * @param limits passed to the analysis core; see explore().
   * @returns {Promise<object[] | null>} the computed findings, or null where the
   *   analysis was stopped, or the net changed while it ran.
   */
  analyse(limits) {
    // Asked for again, with nothing said, while a further search runs: that is the answer.
    // The menu of the plugin does not throw a long search away.
    if (limits === undefined && this._busy && this._further && this._pending) return this._pending;
    this._lastLimits = limits ?? {};
    return this._analyse(limits ?? {}, false);
  }

  /**
   * Analyses again with ten times the limits, after a search that stopped at its limit. Once:
   * the answer of a further search offers no further one. Only where there is a worker; on the
   * page it would freeze the canvas for twenty seconds.
   *
   * @returns {Promise<object[] | null>} as analyse(); null where there was nothing to do
   */
  searchFurther() {
    if (!this.canSearchFurther) return Promise.resolve(null);
    const promise = this._analyse(furtherLimits(this._lastLimits), true);
    this._pending = promise;
    promise.finally(() => { if (this._pending === promise) this._pending = null; });
    return promise;
  }

  /** Whether the last analysis stopped at a limit and a further search is on offer. */
  get canSearchFurther() {
    return !this._busy && !this._further && this._search?.mode === 'worker'
      && (this._answer?.stopped === 'markings' || this._answer?.stopped === 'time');
  }

  /** Whether the answer on show, or the search that is running, is a further one. */
  get further() {
    return this._further;
  }

  /** What a further search would look at, for the button that offers it: markings and seconds. */
  get furtherPreview() {
    const limits = furtherLimits(this._lastLimits);
    return { markings: limits.markings, seconds: limits.milliseconds === null ? null : limits.milliseconds / 1000 };
  }

  async _analyse(limits, further) {
    let net;
    try {
      net = readNet(netFromElements(this._elementRegistry.getAll()));
    } catch (error) {
      this._end();
      this._dropOwn();
      this._problem = error.message;
      this._stale = false;
      this._stopped = false;
      this._changed();
      return [];
    }

    // A further search keeps the answer it replaces, to bring it back if it is stopped.
    if (further) this._previous = { own: this._own, answer: this._answer, net: this._net };
    else this._previous = null;
    this._further = further;
    this._furtherStopped = false;

    // The previous list is about the net as it was a moment ago. It goes, and the
    // reader sees that something is being done.
    this._end();
    const run = this._run;
    this._dropOwn();
    this._stale = false;
    this._stopped = false;
    this._busy = true;
    this._progress = null;
    this._limit = limits.markings ?? SEARCH_LIMITS.markings;
    this._changed();

    let answer;
    try {
      answer = await (this._search
        ? this._search.run('analyse', net, limits)
        : Promise.resolve(runSearch('analyse', net, limits)));
    } catch (error) {
      if (run !== this._run) return null;
      this._busy = false;
      this._problem = error.message;
      this._changed();
      return [];
    }

    // Stopped, or the net changed: what ended it has said so already. An answer of null that
    // nothing here ended is a search that was ended from outside (`netSearch.cancel()`, say):
    // the list must not go on saying it is working.
    if (run !== this._run) return null;
    if (answer === null) {
      this._busy = false;
      this._progress = null;
      this._stopped = true;
      this._changed();
      return null;
    }

    this._busy = false;
    this._net = net;
    this._own = answer.findings;
    this._answer = answer;
    this._problem = null;
    this._stale = false;
    this._changed();
    return this._own;
  }

  /** Stops a running analysis. The list says that it was stopped. */
  cancel() {
    if (!this._busy) return;
    this._end();
    this._search?.cancel('analyse');
    if (this._previous) {
      // A further search that is stopped brings back the answer it started from.
      this._own = this._previous.own;
      this._answer = this._previous.answer;
      this._net = this._previous.net;
      this._previous = null;
      this._further = false;
      this._furtherStopped = true;
      this._stopped = false;
    } else {
      this._stopped = true;
    }
    this._changed();
  }

  /** What a running analysis is no longer wanted for: its answer, when it comes, is dropped. */
  _end() {
    this._run += 1;
    this._busy = false;
    this._progress = null;
  }

  /**
   * Findings from the host, which knows about the document the net sits in.
   * They are kept apart from the computed ones: analysing again does not drop
   * them, and neither does an edit. They stay until the host sends the list
   * again, or an empty one.
   *
   * @param {{rule?: string, severity?: string, element?: string, message?: string}[]} findings
   *   `element` is the id of a shape on the canvas, which the row leads to for
   *   as long as that shape is there.
   */
  setHostFindings(findings) {
    this._fromHost = (findings ?? []).map((finding) => ({
      rule: finding.rule ?? '',
      severity: Object.hasOwn(ORDER, finding.severity) ? finding.severity : 'information',
      element: finding.element ?? null,
      message: finding.message ?? '',
    }));
    this._changed();
  }

  /** Drops everything: the computed findings, the host's, and the reason. */
  clear() {
    this._search?.cancel('analyse');
    this._end();
    this._previous = null;
    this._further = false;
    this._furtherStopped = false;
    this._stopped = false;
    this._dropOwn();
    this._fromHost = [];
    this._stale = false;
    this._changed();
  }

  /** The computed findings and what they were computed from. */
  _dropOwn() {
    this._own = [];
    this._problem = null;
    this._answer = null;
    this._net = null;
  }

  /** The net the findings are about, as the core read it, or null. */
  get net() {
    return this._net;
  }

  /**
   * The firings that lead to the marking a finding is about, or null where the
   * finding is about no marking, where nothing was analysed, or where the
   * search recorded no way into it.
   */
  wayTo(finding) {
    // The search worked it out where it still had the state space. Only for a finding that
    // is in the list now: after an edit the way it names is about a net that is gone.
    return Array.isArray(finding?.way) && this._own.includes(finding) ? { transitions: finding.way } : null;
  }

  /**
   * The firings a finding stands for, in an order that fires from the initial
   * marking, or null where the finding stands for no firings or no order of
   * them is fireable.
   */
  runFor(finding) {
    return Array.isArray(finding?.run) && this._own.includes(finding) ? finding.run : null;
  }

  /** Whether the element a finding is about is on the canvas. */
  canShow(finding) {
    return Boolean(finding?.element && this._elementRegistry.get(finding.element));
  }

  /** Selects what a finding is about, so a reader can see it on the canvas. */
  show(finding) {
    const element = finding?.element && this._elementRegistry.get(finding.element);
    if (!element) return false;

    this._eventBus.fire('findings.show', { element, finding });
    return true;
  }

  _changed() {
    this._eventBus.fire('findings.changed', {
      findings: this.all,
      problem: this._problem,
      stale: this._stale,
      busy: this._busy,
      stopped: this._stopped,
      progress: this.progress,
      further: this._further,
      furtherStopped: this._furtherStopped,
      canSearchFurther: this.canSearchFurther,
      cutOff: this._answer?.stopped ?? null,
    });
  }
}
