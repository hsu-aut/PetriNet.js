/**
 * The analysis for a host that has data and no canvas: a net as plain data in,
 * an answer that survives JSON out.
 *
 * The core works on Maps and uses Infinity for a place that grows without bound.
 * Neither goes through JSON, and a command line tool or another process is a
 * host that only has JSON. This is the one function such a host calls.
 */
import { analyse } from './analyse.js';
import { explore } from './explore.js';
import { readNet } from './model.js';
import { markingsToCsv, toDot } from './report.js';

/**
 * @param data   { places: [{ id, name, marking }], transitions: [{ id, name }],
 *                 arcs: [{ id, source, target, weight }] }
 * @param limits { markings, milliseconds, now } as for explore(). A
 *               `milliseconds` of null means no time limit, which makes an
 *               answer the same on every machine; `markings` stays.
 * @returns {{
 *   problem: string | null,   why the net could not be analysed, else null
 *   complete: boolean,        no stop at a limit and no unbounded place (see PT17)
 *   stopped: 'markings' | 'time' | null,
 *   markings: number,         how many markings were found
 *   unbounded: string[],      ids of places that grow without bound
 *   classes: string[],        the classes of the net, most specific first (see classes.js)
 *   workflow: { start, end, sound } | null,   sound is true, false or null (not decided)
 *   findings: { rule, severity, element, message, marking?, cover?, firings? }[],
 * }}
 */
export function analyseData(data, limits = {}) {
  const used = { ...limits };
  if (used.milliseconds === null) used.milliseconds = Infinity;
  if (used.markings === null) delete used.markings;

  let net;
  try {
    net = readNet(data);
  } catch (error) {
    return { problem: error.message, complete: false, stopped: null, markings: 0, unbounded: [], classes: [], workflow: null, findings: [] };
  }

  const { findings, complete, result, classes, workflow } = analyse(net, used);
  return {
    problem: null,
    // Whether the answer is the whole truth: the search finished and no place
    // grows without bound. That is `complete` of analyse(), not the search's own.
    complete,
    stopped: result.stopped,
    markings: result.markings.length,
    unbounded: [...result.unbounded],
    classes,
    workflow,
    findings,
  };
}

/**
 * The state space of a net as a file: what the state space view saves, for a host with data and no
 * canvas. Works like analyseData: `milliseconds: null` means no time limit, a net that cannot be read
 * gives `problem`, and the answer survives JSON.
 *
 * @param data   as for analyseData
 * @param limits as for analyseData
 * @param format 'dot' (Graphviz) or 'csv' (one row per marking)
 * @returns {{
 *   problem: string | null,
 *   complete: boolean,        the search finished (a place that grows without bound is shown as omega)
 *   stopped: 'markings' | 'time' | null,
 *   markings: number, edges: number, deadlocks: number,
 *   unbounded: string[],      ids of places shown as omega
 *   text: string,             the file; empty where the net could not be read
 * }}
 */
export function exploreData(data, limits = {}, format = 'dot') {
  if (format !== 'dot' && format !== 'csv') throw new Error(`the format is dot or csv, not '${format}'`);

  const used = { ...limits };
  if (used.milliseconds === null) used.milliseconds = Infinity;
  if (used.markings === null) delete used.markings;

  let net;
  try {
    net = readNet(data);
  } catch (error) {
    return { problem: error.message, complete: false, stopped: null, markings: 0, edges: 0, deadlocks: 0, unbounded: [], text: '' };
  }

  const result = explore(net, used);
  return {
    problem: null,
    complete: result.complete,
    stopped: result.stopped,
    markings: result.markings.length,
    edges: result.edges.length,
    deadlocks: result.deadlocks.length,
    unbounded: [...result.unbounded],
    text: format === 'dot' ? toDot(result, net) : markingsToCsv(result, net),
  };
}
