# Changelog

## 0.1.0

The first version of the fork, on top of ptn-js 1.0.2 and its two fixes that
were merged into the original in November 2026.

- Its own PNML reader and writer, which keeps node sizes, bend points, pages,
  reference nodes and the tool-specific sections of other tools.
- An analysis core without a canvas: the firing rule, the state space within
  limits, boundedness, deadlocks, dead transitions, liveness, place and
  transition invariants, siphons and traps.
- A simulation that keeps the marking beside the model, steps both ways, fires
  whole steps and shows the tokens moving.
- A findings list, a state space view with a query line, the way into any
  marking, invariants and siphons marked in the drawing.
- The answers as files: the state space as DOT, the markings and the findings
  as CSV.
- Tidying up: a layered layout of the whole net, aligning and spreading a
  selection.
