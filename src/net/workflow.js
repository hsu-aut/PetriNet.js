/**
 * Soundness of workflow nets (van der Aalst 1997).
 *
 * A workflow net has one place to start in and one to end in. It is sound when,
 * started with one token in the start place [i]:
 *  1. from every reachable marking the marking [o], one token in the end place
 *     and none elsewhere, can still be reached (the option to complete),
 *  2. [o] is the only reachable marking with a token in the end place (proper
 *     completion), and
 *  3. no transition is dead.
 * A sound net is bounded, so an unbounded place proves it is not sound.
 *
 * Soundness is decided from the search where the search is whole. Where it is
 * not, a counter-example it found still proves "not sound", and the structure
 * can prove "sound": a net is sound exactly when the net closed by a transition
 * from the end back to the start is live and bounded, and the theorems of
 * theorems.js decide that for the nets they cover.
 */
import { explore } from './explore.js';
import { markingKey, readKey } from './model.js';
import { netClasses } from './classes.js';
import { boundednessFromStructure, livenessFromStructure } from './theorems.js';

const CLOSE = '__close__';

const keyOf = (...places) => markingKey(new Map(places.map((id) => [id, 1])));

/** The net with a transition from the end place back to the start place. */
export function closedNet(net, shape) {
  return {
    places: net.places.map((place) => ({ ...place, marking: place.id === shape.start ? 1 : 0 })),
    transitions: [...net.transitions, { id: CLOSE, name: CLOSE }],
    arcs: [
      ...net.arcs,
      { id: `${CLOSE}-in`, source: shape.end, target: CLOSE, weight: 1 },
      { id: `${CLOSE}-out`, source: CLOSE, target: shape.start, weight: 1 },
    ],
  };
}

/** Whether the drawn marking is one token in the start place and none elsewhere. */
export function drawnAtStart(net, shape) {
  return markingKey(new Map(net.places.map((place) => [place.id, place.marking]))) === keyOf(shape.start);
}

const hasOmega = (key) => readKey(key).some(([, held]) => held === Infinity);

/**
 * @param net     a net read by readNet
 * @param shape   { start, end } of a workflow net
 * @param limits  as for explore()
 * @param drawn   the search of the net as drawn, reused when it starts at [i]
 * @returns {{
 *   sound: boolean | null,        null: not decided
 *   reasons: object[],            why not, each { kind, ... }
 *   proof: string | null,         the theorem, where the structure decided
 *   searched: object,             the search it is based on
 *   fromDrawn: boolean,           whether that is the search of the net as drawn
 * }}
 */
export function soundness(net, shape, limits = {}, drawn = null) {
  const start = keyOf(shape.start);
  const end = keyOf(shape.end);
  const fromDrawn = drawn !== null && drawnAtStart(net, shape);

  const searched = fromDrawn
    ? drawn
    : explore({ ...net, places: net.places.map((place) => ({ ...place, marking: place.id === shape.start ? 1 : 0 })) }, limits);

  const reasons = [];

  if (searched.unbounded.length > 0) reasons.push({ kind: 'unbounded', places: [...searched.unbounded] });

  // Proper completion: a token in the end place anywhere but in [o].
  const improper = searched.markings.find(({ key }) =>
    key !== end && readKey(key).some(([place, held]) => place === shape.end && held > 0));
  if (improper && !hasOmega(improper.key)) reasons.push({ kind: 'improper', key: improper.key });

  // Stuck before the end: a marking nothing is enabled in that is not [o].
  const stuck = searched.deadlocks.find((key) => key !== end && !hasOmega(key));
  if (stuck !== undefined) reasons.push({ kind: 'stuck', key: stuck });

  const whole = searched.complete && searched.unbounded.length === 0;
  if (whole) {
    // The option to complete: every marking has a path to [o].
    const canFinish = new Set([end]);
    const before = new Map();
    for (const edge of searched.edges) {
      if (!before.has(edge.to)) before.set(edge.to, []);
      before.get(edge.to).push(edge.from);
    }
    const queue = [end];
    while (queue.length > 0) {
      for (const from of before.get(queue.shift()) ?? []) {
        if (!canFinish.has(from)) {
          canFinish.add(from);
          queue.push(from);
        }
      }
    }

    const reached = new Set(searched.markings.map(({ key }) => key));
    if (!reached.has(end)) {
      reasons.push({ kind: 'never-ends' });
    } else {
      const lost = searched.markings.find(({ key }) => !canFinish.has(key));
      // A marking that is stuck is reported as stuck already.
      if (lost && !reasons.some((reason) => reason.kind === 'stuck' && reason.key === lost.key)) {
        reasons.push({ kind: 'cannot-end', key: lost.key });
      }
    }

    const dead = net.transitions.filter((transition) => !searched.fired.includes(transition.id)).map((t) => t.id);
    if (dead.length > 0) reasons.push({ kind: 'dead', transitions: dead });

    return { sound: reasons.length === 0, reasons, proof: null, searched, fromDrawn };
  }

  if (reasons.length > 0) return { sound: false, reasons, proof: null, searched, fromDrawn };

  // The search did not finish and found nothing wrong. The structure may decide.
  const closed = closedNet(net, shape);
  const classes = netClasses(closed);
  const live = livenessFromStructure(closed, classes);

  if (live?.live === false) {
    return { sound: false, reasons: [{ kind: 'closed-not-live', cover: live.cover }], proof: live.proof, searched, fromDrawn };
  }
  if (live?.live === true) {
    const bounded = boundednessFromStructure(closed, classes, live);
    if (bounded?.bounded === true) {
      return { sound: true, reasons: [], proof: 'free-choice-workflow', theorem: live.proof, searched, fromDrawn };
    }
  }

  return { sound: null, reasons: [], proof: null, searched, fromDrawn };
}
