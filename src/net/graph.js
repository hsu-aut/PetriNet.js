/**
 * Small graph helpers for the structural theorems. A graph is a list of node ids
 * and a list of [from, to] edges; nothing here knows about nets.
 */

function adjacencyOf(nodes, edges) {
  const out = new Map(nodes.map((node) => [node, []]));
  for (const [from, to] of edges) {
    if (out.has(from) && out.has(to)) out.get(from).push(to);
  }
  return out;
}

/**
 * The strongly connected components, Tarjan's algorithm without recursion so
 * that a long chain of places cannot overflow the stack.
 *
 * @returns {string[][]} components, each a list of node ids, in discovery order
 */
export function stronglyConnected(nodes, edges) {
  const out = adjacencyOf(nodes, edges);
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];
  let counter = 0;

  for (const root of nodes) {
    if (index.has(root)) continue;

    const work = [{ node: root, next: 0 }];
    index.set(root, counter);
    low.set(root, counter);
    counter += 1;
    stack.push(root);
    onStack.add(root);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const successors = out.get(frame.node);

      if (frame.next < successors.length) {
        const successor = successors[frame.next];
        frame.next += 1;

        if (!index.has(successor)) {
          index.set(successor, counter);
          low.set(successor, counter);
          counter += 1;
          stack.push(successor);
          onStack.add(successor);
          work.push({ node: successor, next: 0 });
        } else if (onStack.has(successor)) {
          low.set(frame.node, Math.min(low.get(frame.node), index.get(successor)));
        }
        continue;
      }

      if (low.get(frame.node) === index.get(frame.node)) {
        const component = [];
        let member;
        do {
          member = stack.pop();
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.node);
        components.push(component);
      }

      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].node;
        low.set(parent, Math.min(low.get(parent), low.get(frame.node)));
      }
    }
  }

  return components;
}

/**
 * Whether the graph holds a directed cycle, and the nodes of one. A node with an
 * edge to itself is a cycle.
 *
 * @returns {string[] | null}
 */
export function findCycle(nodes, edges) {
  const selfLoop = edges.find(([from, to]) => from === to && nodes.includes(from));
  if (selfLoop) return [selfLoop[0]];

  const cyclic = stronglyConnected(nodes, edges).find((component) => component.length > 1);
  return cyclic ?? null;
}

/** The nodes reachable from `start` along the edges, `start` included. */
export function reachable(start, nodes, edges) {
  const out = adjacencyOf(nodes, edges);
  const seen = new Set([start]);
  const queue = [start];

  while (queue.length > 0) {
    for (const next of out.get(queue.shift()) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }

  return seen;
}

/** Whether every node can be reached from every other, ignoring the direction of the edges. */
export function weaklyConnected(nodes, edges) {
  if (nodes.length === 0) return false;
  const both = edges.flatMap(([from, to]) => [[from, to], [to, from]]);
  return reachable(nodes[0], nodes, both).size === nodes.length;
}
