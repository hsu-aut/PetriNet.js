# Changelog

## 0.6.1

- **A picture of the net during a simulation shows the document, not the run.**
  `saveSVG()` carried the tokens of the run and the green of the enabled
  transitions, which are not part of the document. It now draws the marking that was
  typed and marks nothing as enabled, and the run goes on undisturbed.
  `simulation.asDocument(fn)` does this for a host that draws pictures of its own.

## 0.6.0

**Breaking.** The methods that search the markings of a net return promises.

- **Analyse and the state space run in a Web Worker.** The canvas stays usable while
  they run. The list shows how far the search is and has a Stop button; an edit or an
  import ends it and the list says the net changed. Where no worker can be started (a
  `worker-src` policy without `blob:`, Node, no worker support, or `netSearch: { worker:
  false }`) the searches run on the page as before, with the same limits, and the
  console says so once. The worker is built into the package as a string, so hosts
  need no build step.
- **`findings.analyse()`, `findingsPanel.analyse()`, `reachabilityView.show()` and
  `reachabilityView.ask()` return promises.** A host that called them and read the
  result at once must `await` them. They resolve to `null` where the search was
  stopped or the net changed. New: `findings.cancel()`, `findings.busy`,
  `findings.progress`, `reachabilityView.cancel()`, `reachabilityView.busy`, the
  service `netSearch` (`run`, `cancel`, `idle`, `mode`, `busy`) and the event
  `search.progress`. The event `findings.changed` carries `busy`, `stopped` and
  `progress`.
- `Findings.wayTo(finding)` and `runFor(finding)` read what the search worked out
  (`finding.way`, `finding.run`) and stay synchronous.
- **All shortest ways come from one walk over the edges** instead of one walk per
  marking, which made the query line and "Way there" slow on large state spaces.
  The answers are the same.
- **The service is called `netSearch`**, and the option too, because diagram-js has a
  service `search` of its own that the search of elements (Ctrl+F) depends on.
- `null` for a limit means none, as in `analyseData`. A worker that does not say it is
  ready within ten seconds (`netSearch: { readyTimeout }`) is given up on, and the page
  searches. `Findings.wayTo` and `runFor` answer only for a finding that is in the list
  now, and `wayTo` gives `{ transitions }` without the list of markings.
- The panel for the findings says "Analysing" while it works, and the Analyse button
  is disabled meanwhile.

## 0.5.0

- **A properties panel** for the selected element, opened by a button at the top
  right or by P. Name and marking of a place, name and "silent" of a transition,
  weight and name of an arc, name and counts of the net, and the id (shown, not
  editable). One command per change, checked before anything is written, read only
  while a simulation runs. Option `propertiesPanel` (`false` leaves it out, or
  `{ open: true | false }`), service `propertiesPanel` with `open()`, `close()`,
  `toggle()`, `isOpen` and the event `propertiesPanel.changed`.
- **The buttons and cards on the right of the canvas are laid out together**: a row
  of buttons at the top, a column of cards under it. "Analyse (1 error, 2
  warnings)" used to run under "State space". The cards stack and keep clear of the
  palette. A host that styled the old absolute positions needs to look at this.
- **The name of an arc and of the net can be edited** (in the panel). They were in
  the model and in PNML but nowhere to type them.
- **A weight of 0 typed on the canvas is refused**, as in the panel. It used to be
  accepted and refused only later by the analysis. A weight with leading zeros is
  written without them.
- **The label editor does not open while a simulation runs.** A name typed there
  would have ended the run.

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
