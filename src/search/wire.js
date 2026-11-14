/**
 * An exploration as something that travels between a worker and the page.
 *
 * The search result holds Maps and uses Infinity for a place that grows without
 * bound; neither goes through JSON, and a message that is only JSON can be
 * tested in Node and logged. Markings travel as their keys, which write omega as
 * 'omega', and edges as indices into the list of keys, so that a long key is
 * written once and not once per edge.
 */
import { readKey } from './../net/model.js';

/**
 * @returns {{
 *   places: string[], keys: string[], initial: number,
 *   transitions: string[], edges: number[],     flat triples: from, to, transition
 *   deadlocks: number[], fired: string[], unbounded: string[],
 *   complete: boolean, stopped: string | null,
 * }}
 */
export function toWire(result, net) {
  const index = new Map(result.markings.map(({ key }, i) => [key, i]));
  const transitions = net.transitions.map((transition) => transition.id);
  const position = new Map(transitions.map((id, i) => [id, i]));

  const edges = [];
  for (const edge of result.edges) edges.push(index.get(edge.from), index.get(edge.to), position.get(edge.transition));

  return {
    places: net.places.map((place) => place.id),
    keys: result.markings.map(({ key }) => key),
    initial: index.get(result.initial),
    transitions,
    edges,
    deadlocks: result.deadlocks.map((key) => index.get(key)),
    fired: [...result.fired],
    unbounded: [...result.unbounded],
    complete: result.complete,
    stopped: result.stopped,
  };
}

/** The result a wire message was made from, in the shape the readers of a result expect. */
export function fromWire(wire) {
  const markings = wire.keys.map((key) => {
    // Every place has an entry, as in a marking the search made itself.
    const marking = new Map(wire.places.map((id) => [id, 0]));
    for (const [place, tokens] of readKey(key)) marking.set(place, tokens);
    return { key, marking };
  });

  const edges = [];
  for (let i = 0; i < wire.edges.length; i += 3) {
    edges.push({
      from: wire.keys[wire.edges[i]],
      to: wire.keys[wire.edges[i + 1]],
      transition: wire.transitions[wire.edges[i + 2]],
    });
  }

  return {
    markings,
    edges,
    initial: wire.keys[wire.initial],
    deadlocks: wire.deadlocks.map((i) => wire.keys[i]),
    fired: [...wire.fired],
    unbounded: [...wire.unbounded],
    complete: wire.complete,
    stopped: wire.stopped,
  };
}
