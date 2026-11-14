/**
 * What the structure of a net proves about it, without running it.
 *
 * Each answer carries the theorem it rests on (`proof`) and the part of the net
 * it is about (`cover`), so that a reader can be told why and shown where. An
 * answer is true, false, or null, which means "the structure does not decide
 * this". The theorems are about ordinary nets; a net with a heavier arc gets no
 * answer here and the search answers instead.
 *
 * The statements, with their sources (Murata 1989, Desel and Esparza 1995):
 *  - state machine: live iff strongly connected and holding a token
 *  - marked graph: live iff every directed circuit holds a token
 *  - extended free-choice: live iff every minimal siphon contains a marked trap
 *    (Commoner)
 *  - any net: bounded if every place lies in a semi-positive place invariant
 *  - live extended free-choice: bounded iff covered by S-components (Hack)
 *
 * They hold for connected nets, and Commoner's theorem is applied only where
 * every transition has an input and an output place, which is the setting the
 * theorem is stated in.
 */
import { findCycle, stronglyConnected } from './graph.js';
import { isConnected, neighbourhoods, netGraph } from './classes.js';
import { placeInvariants } from './invariants.js';
import { holdsToken, maximalTrap, siphons } from './structure.js';

/** A net's own marking as a Map, from the places. */
const markingOf = (net) => new Map(net.places.map((place) => [place.id, place.marking]));

/**
 * @returns {{ live: boolean, proof: string, cover: string[], reason: string } | { live: null, limit: string } | null}
 *   null when no theorem applies; `live: null` when one applies but its search
 *   for siphons stopped at a limit, with the limit named.
 */
export function livenessFromStructure(net, classes, limits = {}) {
  if (!classes.ordinary || !isConnected(net)) return null;
  const marking = markingOf(net);
  const placeIds = net.places.map((place) => place.id);

  if (classes.stateMachine) {
    const { nodes, edges } = netGraph(net);
    const components = stronglyConnected(nodes, edges);
    if (components.length !== 1) {
      // A component the others only enter or only leave is where tokens are lost
      // or never arrive; name its places.
      const index = new Map(components.flatMap((component, i) => component.map((node) => [node, i])));
      const leaves = components.map(() => ({ in: false, out: false }));
      for (const [from, to] of edges) {
        if (index.get(from) !== index.get(to)) {
          leaves[index.get(from)].out = true;
          leaves[index.get(to)].in = true;
        }
      }
      const edge = components.findIndex((_, i) => !leaves[i].in || !leaves[i].out);
      const cover = components[edge].filter((node) => placeIds.includes(node));
      return { live: false, proof: 'state-machine', cover, reason: 'not-strongly-connected' };
    }
    if (![...marking.values()].some((tokens) => tokens > 0)) {
      return { live: false, proof: 'state-machine', cover: placeIds, reason: 'unmarked' };
    }
    return { live: true, proof: 'state-machine', cover: placeIds, reason: 'strongly-connected-and-marked' };
  }

  if (classes.markedGraph) {
    const { nodes, edges } = netGraph(net);
    const unmarked = new Set(net.places.filter((place) => place.marking === 0).map((place) => place.id));
    const keep = nodes.filter((node) => !placeIds.includes(node) || unmarked.has(node));
    const kept = new Set(keep);
    const cycle = findCycle(keep, edges.filter(([from, to]) => kept.has(from) && kept.has(to)));
    if (cycle) {
      return { live: false, proof: 'marked-graph', cover: cycle.filter((node) => placeIds.includes(node)), reason: 'unmarked-circuit' };
    }
    return { live: true, proof: 'marked-graph', cover: placeIds, reason: 'every-circuit-marked' };
  }

  if (classes.extendedFreeChoice) {
    const { transitionPre, transitionPost } = neighbourhoods(net);
    const closed = net.transitions.every((t) => transitionPre.get(t.id).size > 0 && transitionPost.get(t.id).size > 0);
    if (!closed) return null;

    // Commoner needs all minimal siphons, so the caps are generous. A cap that
    // still stops the walk leaves the question open and says which one.
    const found = siphons(net, { sets: 5000, steps: 200000, ...limits });
    if (!found.complete) return { live: null, limit: found.stopped };

    for (const set of found.sets) {
      if (!holdsToken(maximalTrap(net, set), marking)) {
        return { live: false, proof: 'commoner', cover: set, reason: 'siphon-without-marked-trap' };
      }
    }
    return { live: true, proof: 'commoner', cover: placeIds, reason: 'every-siphon-holds-a-marked-trap' };
  }

  return null;
}

/**
 * The strongly connected S-nets of an ordinary net, as sets of places: a set of
 * places such that every transition next to it has exactly one input and one
 * output place in it, and the subnet they make is strongly connected. Candidates
 * are the supports of the place invariants, which every S-component has.
 */
export function sComponents(net, invariants = placeInvariants(net)) {
  const { placePre, placePost, transitionPre, transitionPost } = neighbourhoods(net);
  const found = [];
  const seen = new Set();

  for (const invariant of invariants) {
    const support = [...invariant.keys()];
    const key = [...support].sort().join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);

    const inside = new Set(support);
    const transitions = new Set();
    for (const place of support) {
      for (const t of placePre.get(place)) transitions.add(t);
      for (const t of placePost.get(place)) transitions.add(t);
    }

    const shaped = [...transitions].every((t) =>
      [...transitionPre.get(t)].filter((p) => inside.has(p)).length === 1
      && [...transitionPost.get(t)].filter((p) => inside.has(p)).length === 1);
    if (!shaped) continue;

    const nodes = [...support, ...transitions];
    const edges = net.arcs
      .filter((arc) => (inside.has(arc.source) && transitions.has(arc.target)) || (transitions.has(arc.source) && inside.has(arc.target)))
      .map((arc) => [arc.source, arc.target]);
    if (stronglyConnected(nodes, edges).length === 1) found.push(support);
  }

  return found;
}

/**
 * @returns {{ bounded: boolean, proof: string, cover: string[] } | null}
 */
export function boundednessFromStructure(net, classes, liveness) {
  const placeIds = net.places.map((place) => place.id);
  if (placeIds.length === 0) return null;

  const invariants = placeInvariants(net);
  const covered = new Set(invariants.flatMap((invariant) => [...invariant.keys()]));
  if (placeIds.every((id) => covered.has(id))) {
    return { bounded: true, proof: 'place-invariants', cover: placeIds };
  }

  // Hack: a live extended free-choice net is bounded exactly when S-components
  // cover it. Only then does a place outside every one of them prove growth.
  if (liveness?.live === true && classes.extendedFreeChoice) {
    const inComponent = new Set(sComponents(net, invariants).flat());
    const outside = placeIds.filter((id) => !inComponent.has(id));
    return outside.length === 0
      ? { bounded: true, proof: 'hack', cover: placeIds }
      : { bounded: false, proof: 'hack', cover: outside };
  }

  return null;
}
