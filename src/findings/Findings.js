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
import { analyse } from '../net/analyse.js';
import { netFromElements } from '../net/fromDiagram.js';
import { sequenceFor } from '../net/invariants.js';
import { initialMarking, readNet } from '../net/model.js';
import { pathTo } from '../net/paths.js';

const ORDER = { error: 0, warning: 1, information: 2 };

export default class Findings {
  static $inject = ['eventBus', 'elementRegistry'];

  constructor(eventBus, elementRegistry) {
    this._eventBus = eventBus;
    this._elementRegistry = elementRegistry;

    this._own = [];
    this._fromHost = [];
    this._problem = null;
    this._stale = false;
    // The exploration the findings came from, kept so that a finding about a
    // marking can be turned into the way to that marking.
    this._analysis = null;
    this._net = null;

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
      if (!this._own.length && !this._fromHost.length && !this._problem) return;

      if (this._own.length || this._problem) {
        this._dropOwn();
        this._stale = true;
      }
      this._changed();
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

  /**
   * Reads the net from the canvas and analyses it.
   * @param limits passed to the analysis core; see explore().
   */
  analyse(limits = {}) {
    try {
      const net = readNet(netFromElements(this._elementRegistry.getAll()));
      this._analysis = analyse(net, limits);
      this._net = net;
      this._own = this._analysis.findings;
      this._problem = null;
      this._stale = false;
    } catch (error) {
      this._analysis = null;
      this._net = null;
      this._own = [];
      this._problem = error.message;
      this._stale = false;
    }

    this._changed();
    return this._own;
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
    this._dropOwn();
    this._fromHost = [];
    this._stale = false;
    this._changed();
  }

  /** The computed findings and what they were computed from. */
  _dropOwn() {
    this._own = [];
    this._problem = null;
    this._analysis = null;
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
    if (!finding?.marking || !this._analysis) return null;
    return pathTo(this._analysis.result, finding.marking);
  }

  /**
   * The firings a finding stands for, in an order that fires from the initial
   * marking, or null where the finding stands for no firings or no order of
   * them is fireable.
   */
  runFor(finding) {
    if (!finding?.firings || !this._net) return null;
    return sequenceFor(this._net, new Map(finding.firings), initialMarking(this._net));
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
    });
  }
}
