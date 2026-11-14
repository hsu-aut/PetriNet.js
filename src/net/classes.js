/**
 * The subclass of place/transition nets a net belongs to.
 *
 * The classes are those of Murata (1989, section VI) and Desel and Esparza
 * (1995), and they are defined for ordinary nets, where every arc carries one
 * token. A net with a heavier arc is not in any of them and the theorems about
 * them say nothing about it, so it is reported as "not ordinary" and the search
 * answers instead. Parallel arcs add up as in the firing rule, so two arcs of
 * weight one between the same place and transition are one arc of weight two.
 *
 * The hierarchy is state machine and marked graph inside free-choice, inside
 * extended free-choice, inside asymmetric choice.
 */
import { weaklyConnected } from './graph.js';

/** For every place and transition: what feeds it and what it feeds. */
export function neighbourhoods(net) {
  const placePre = new Map(net.places.map((place) => [place.id, new Set()]));
  const placePost = new Map(net.places.map((place) => [place.id, new Set()]));
  const transitionPre = new Map(net.transitions.map((transition) => [transition.id, new Set()]));
  const transitionPost = new Map(net.transitions.map((transition) => [transition.id, new Set()]));

  for (const arc of net.arcs) {
    if (transitionPre.has(arc.target) && placePost.has(arc.source)) {
      transitionPre.get(arc.target).add(arc.source);
      placePost.get(arc.source).add(arc.target);
    } else if (placePre.has(arc.target) && transitionPost.has(arc.source)) {
      placePre.get(arc.target).add(arc.source);
      transitionPost.get(arc.source).add(arc.target);
    }
  }

  return { placePre, placePost, transitionPre, transitionPost };
}

/**
 * The first arc whose connection carries more than one token once the parallel
 * arcs are added up, or null when the net is ordinary.
 */
export function firstHeavyArc(net) {
  const total = new Map();
  for (const arc of net.arcs) {
    const key = `${arc.source}\u0000${arc.target}`;
    total.set(key, (total.get(key) ?? 0) + arc.weight);
  }

  return net.arcs.find((arc) => total.get(`${arc.source}\u0000${arc.target}`) > 1) ?? null;
}

const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const meet = (a, b) => [...a].some((x) => b.has(x));
const within = (a, b) => [...a].every((x) => b.has(x));

/**
 * @returns {{
 *   ordinary: boolean,
 *   witness: string | null,        the arc that makes the net not ordinary
 *   stateMachine: boolean,
 *   markedGraph: boolean,
 *   freeChoice: boolean,
 *   extendedFreeChoice: boolean,
 *   asymmetricChoice: boolean,
 * }}
 */
export function netClasses(net) {
  const heavy = firstHeavyArc(net);
  const none = {
    ordinary: heavy === null && net.places.length > 0 && net.transitions.length > 0,
    witness: heavy?.id ?? null,
    stateMachine: false,
    markedGraph: false,
    freeChoice: false,
    extendedFreeChoice: false,
    asymmetricChoice: false,
  };
  if (!none.ordinary) return none;

  const { placePre, placePost, transitionPre, transitionPost } = neighbourhoods(net);
  const places = net.places.map((place) => place.id);
  const transitions = net.transitions.map((transition) => transition.id);

  const stateMachine = transitions.every((t) => transitionPre.get(t).size === 1 && transitionPost.get(t).size === 1);
  const markedGraph = places.every((p) => placePre.get(p).size === 1 && placePost.get(p).size === 1);

  // Free choice: a place that feeds several transitions is the only input of each.
  const freeChoice = places.every((p) =>
    placePost.get(p).size <= 1 || [...placePost.get(p)].every((t) => transitionPre.get(t).size === 1));

  // Extended free choice and asymmetric choice compare the places that share an output.
  let extendedFreeChoice = true;
  let asymmetricChoice = true;
  for (let i = 0; i < places.length; i += 1) {
    for (let j = i + 1; j < places.length; j += 1) {
      const a = placePost.get(places[i]);
      const b = placePost.get(places[j]);
      if (!meet(a, b)) continue;
      if (!same(a, b)) extendedFreeChoice = false;
      if (!within(a, b) && !within(b, a)) asymmetricChoice = false;
    }
  }

  return { ...none, stateMachine, markedGraph, freeChoice, extendedFreeChoice, asymmetricChoice };
}

/** The classes a net is in, by name, most specific first. */
export function classNames(classes) {
  const names = [];
  if (classes.stateMachine) names.push('state-machine');
  if (classes.markedGraph) names.push('marked-graph');
  if (classes.freeChoice) names.push('free-choice');
  if (classes.extendedFreeChoice) names.push('extended-free-choice');
  if (classes.asymmetricChoice) names.push('asymmetric-choice');
  return names;
}

/** The nodes of the net as a graph: places and transitions, arcs as edges. */
export function netGraph(net) {
  return {
    nodes: [...net.places.map((place) => place.id), ...net.transitions.map((transition) => transition.id)],
    edges: net.arcs.map((arc) => [arc.source, arc.target]),
  };
}

/**
 * The start and the end of a workflow net (van der Aalst): exactly one place
 * without an input arc, exactly one without an output arc, and every node on a
 * path from the first to the second.
 *
 * @returns {{ start: string, end: string, offPath: string | null } | null}
 *   null when the net has no single start and end place; `offPath` is the first
 *   node that lies on no path between them, so that a near miss can be named.
 *   The net is a workflow net exactly when `offPath` is null.
 */
export function workflowShape(net) {
  if (net.places.length < 2 || net.transitions.length < 1) return null;

  const hasIn = new Set(net.arcs.map((arc) => arc.target));
  const hasOut = new Set(net.arcs.map((arc) => arc.source));
  const starts = net.places.filter((place) => !hasIn.has(place.id));
  const ends = net.places.filter((place) => !hasOut.has(place.id));
  if (starts.length !== 1 || ends.length !== 1 || starts[0].id === ends[0].id) return null;

  const { nodes, edges } = netGraph(net);
  const forward = reachableFrom(starts[0].id, nodes, edges);
  const backward = reachableFrom(ends[0].id, nodes, edges.map(([from, to]) => [to, from]));
  const off = nodes.find((node) => !forward.has(node) || !backward.has(node));

  return { start: starts[0].id, end: ends[0].id, offPath: off ?? null };
}

function reachableFrom(start, nodes, edges) {
  const out = new Map(nodes.map((node) => [node, []]));
  for (const [from, to] of edges) out.get(from)?.push(to);

  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    for (const next of out.get(queue.shift())) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** Whether the net is one piece, ignoring the direction of the arcs. */
export function isConnected(net) {
  const { nodes, edges } = netGraph(net);
  return weaklyConnected(nodes, edges);
}
