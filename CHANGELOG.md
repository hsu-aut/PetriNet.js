# Changelog

## 0.4.0

New findings and a change of what Analyse says about workflow nets, hence a new minor
version.

- **PT22, the class of a net.** State machine, marked graph, free-choice, extended
  free-choice or asymmetric choice, in a finding of its own with a sentence for
  people who do not know the theory. A net with an arc that carries more than one
  token is "not determined", and the arc is named.
- **PT23, liveness from the structure.** Proven for state machines, marked graphs
  and extended free-choice nets (Commoner's theorem), whatever the size of the state
  space. Not applied where a transition has no input or output place, and not
  attempted above 40 places.
- **PT24, boundedness from the structure.** Proven where every place lies in a place
  invariant, and, for a live extended free-choice net, from the S-components (Hack's
  theorem), which can also prove a net is not bounded.
- **PT25, soundness of workflow nets.** From the search where it is whole, from a
  counter-example where it is cut off, and from the structure where the closed net
  is live and bounded. Checked from one token in the start place however the net is
  drawn, and the message says so.
- **A statement that was proven carries `proof`**, starts with "Proven from the
  structure" and shows a tag in the list. The tests compare every proof with a
  complete search on generated nets and fail on a contradiction.
- **Changed:** a workflow net drawn at its start no longer gets a deadlock warning
  at its end place (information, "the process ends here") and no liveness finding.
  A workflow net that is not sound is a warning. `analyse()` and `analyseData`
  also return `classes` and `workflow`. `net.js` exports `netClasses`,
  `classNames`, `workflowShape` and `soundness`.

## 0.3.0

- **The analysis core is a public entry of its own, `petrinetjs/net.js`.** It
  needs no canvas and no browser: `analyseData(net, limits)` takes a net as plain
  data and answers with something that survives JSON (no Map, no Infinity). A net
  that cannot be read gives a `problem` instead of throwing, and a time limit of
  `null` means none, so the answer is the same on every machine. For hosts such as
  a command line tool that only have data.
- **A net without a transition reports no deadlock.** Nothing is enabled in it
  because there is nothing to enable; before, the list called the initial marking
  a deadlock. This applies to the list on the canvas as well.
- `analyseData` reports `complete` as `analyse()` does: false also where a place
  grows without bound, not only where the search stopped at a limit.

## 0.2.2

- **Tidy up takes the labels of places along.** It moved the shapes and left their
  names where the shapes had been. Lining up and spreading were not affected.

## 0.2.1

- **A run ended from outside takes its play clock with it.** When a host, an
  import or an undo stopped a run while the bar was playing, the clock kept
  ticking and could fire into the next run. Now the clock stops with the run.
- The README names `findingsPanel.analyse()` and `open()` and the `problem` of
  `simulation.changed` for hosts.

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
