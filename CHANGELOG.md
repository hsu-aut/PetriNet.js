# Changelog

## 0.2.0

A change of behaviour in the findings list, hence a new minor version.

- **The findings of a host survive an edit.** Until now any edit to the net
  dropped every finding, the host's included. Now an edit drops only what the
  analysis computed, and the findings set with `setHostFindings` stay until the
  host sends a list again, because only the host can say whether the edit cured
  them. The list says that what Analyse found was dropped, so a list that holds
  only the host's findings is not read as an analysis that found nothing more.
- **The reason a net could not be analysed goes with an edit or an import,** as
  the findings do, and the host's findings are listed under it. Before, the
  reason stayed on screen after the net was fixed and hid the host's list.
- **A finding about an element that is gone is no longer a link**, now that it
  can outlive the edit that deleted the element.
- **The Analyse button carries the host's count** of errors and warnings while
  the list is closed, so a net that fails the host's check can be seen without
  opening anything.
- `Findings.host` and `Findings.hostCounts` read what the host handed in.
  `Findings.clear()` still drops everything.
- A severity other than `error`, `warning` or `information` in a host finding is
  shown as information instead of producing a class name that exists nowhere.
- **The palette is no longer covered by the simulation bar.** The bar sat over
  its first entry; the palette now starts below it.
- The findings service has node tests of its own now (`src/findings/`).
- **The browser checks of the modeler live here now** (`test/browser/`, run with
  `npm run test:browser` and in CI): the PNML round trip, labels, tokens as
  dots, numbers, pages, the simulation, the findings, the state space, the ways
  into markings, invariants, steps, the exports and the layout.

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
