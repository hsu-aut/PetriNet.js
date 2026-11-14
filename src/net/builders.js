/**
 * A net in one line, for tests and fixtures:
 *   build({ p: 1, q: 0 }, ['t', 'u'], [['p', 't'], ['t', 'q', 2]])
 * places map an id to its marking, transitions are ids, arcs are [source, target, weight?].
 */
export function build(places, transitions, arcs) {
  return {
    places: Object.entries(places).map(([id, marking]) => ({ id, name: id, marking })),
    transitions: transitions.map((id) => ({ id, name: id })),
    arcs: arcs.map(([source, target, weight], index) => ({ id: `a${index}`, source, target, weight: weight ?? 1 })),
  };
}
