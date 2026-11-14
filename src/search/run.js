/**
 * The searches, as plain functions of data: what a worker runs, and what the page
 * runs itself where it has no worker. Nothing here knows about the canvas or the
 * DOM, and everything it returns is JSON.
 *
 * `analyse` answers what Findings reads: the findings, with the way into the
 * marking a deadlock finding is about and the order that fires a transition
 * invariant already worked out, so that the panel needs no state space. `explore`
 * answers what the state space view draws, in the compact form of wire.js.
 */
import { analyse } from '../net/analyse.js';
import { explore } from '../net/explore.js';
import { initialMarking } from '../net/model.js';
import { sequenceFor } from '../net/invariants.js';
import { pathTo } from '../net/paths.js';
import { toWire } from './wire.js';

/** The limits that can travel: a clock or a callback cannot. */
export function plainLimits(limits = {}) {
  const { now, progress, ...plain } = limits;
  return plain;
}

export function runSearch(kind, net, limits = {}) {
  if (kind === 'explore') return toWire(explore(net, limits), net);
  if (kind !== 'analyse') throw new Error(`unknown search '${kind}'`);

  const { findings, complete, result, classes, workflow } = analyse(net, limits);
  const start = initialMarking(net);

  return {
    complete,
    stopped: result.stopped,
    markings: result.markings.length,
    unbounded: [...result.unbounded],
    classes,
    workflow,
    findings: findings.map((finding) => ({
      ...finding,
      // What a reader can act on, worked out here, where the state space is.
      way: finding.marking ? (pathTo(result, finding.marking)?.transitions ?? null) : null,
      run: finding.firings ? sequenceFor(net, new Map(finding.firings), start) : null,
    })),
  };
}
