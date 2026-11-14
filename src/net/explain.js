/**
 * The sentences for the findings that rest on the structure of the net (PT22 to
 * PT25). They are written for people who know automation and not Petri net
 * theory: what holds, in plain words, and the theorem in parentheses for those
 * who want to look it up. A statement that is proven says so at the start, so
 * that a reader can tell it from one the search found.
 *
 * Every function takes `ctx`: `{ name, listed, describe }`, the helpers of
 * analyse.js that turn ids and markings into words.
 */

const THEOREM = {
  'state-machine': 'a state machine is live exactly when it is strongly connected and holds a token',
  'marked-graph': 'a marked graph is live exactly when every circuit holds a token',
  commoner: "Commoner's theorem",
  'place-invariants': 'place invariants',
  hack: "Hack's theorem",
  'free-choice-workflow': 'the net closed from its end back to its start is live and bounded',
};

const WHOLE = 'This holds however large the state space is.';

export function classSentence(classes, names, ctx, shape) {
  let text;

  if (!classes.ordinary) {
    text = classes.witness
      ? `not determined. An arc carries more than one token (${classes.witnessText}); the classes and their `
        + 'theorems are about nets in which every arc carries one. The search answers instead.'
      : 'not determined.';
  } else if (names.includes('state-machine') && names.includes('marked-graph')) {
    text = 'state machine and marked graph. The net is one cycle: every transition has one input and one output place, '
      + 'and every place has one transition before it and one after it. Where its theorem applies, liveness follows from the structure (PT23).';
  } else if (names.includes('state-machine')) {
    text = 'state machine. Every transition takes one token from one place and puts one into one place, so tokens '
      + 'only move around and are never made or used up. Where its theorem applies, liveness follows from the structure (PT23).';
  } else if (names.includes('marked-graph')) {
    text = 'marked graph. Every place has exactly one transition before it and one after it, so there are no '
      + 'choices: the net only runs things in sequence and in parallel. Where its theorem applies, liveness follows from the structure (PT23).';
  } else if (names.includes('free-choice')) {
    text = 'free-choice. Where two transitions compete for a token, each needs only that token, so a decision is '
      + 'never held up by tokens elsewhere. Where its theorem applies, liveness follows from the structure (PT23).';
  } else if (names.includes('extended-free-choice')) {
    text = 'extended free-choice. Places that compete for a transition compete for exactly the same ones, so a '
      + 'decision is never held up by tokens elsewhere. Where its theorem applies, liveness follows from the structure (PT23).';
  } else if (names.includes('asymmetric-choice')) {
    text = 'asymmetric choice. Two places that share a transition either share all of them or the transitions of '
      + 'one are among those of the other. Only part of what is true of such nets follows from the structure; '
      + 'the search answers the rest.';
  } else {
    text = 'none of the classes the theorems cover. Places share transitions in a way that makes a decision depend '
      + 'on tokens elsewhere, so the search answers instead.';
  }

  const hint = shape && shape.offPath
    ? ` The net has one start place and one end place, but ${ctx.name.get(shape.offPath) ?? shape.offPath} lies on `
      + 'no path between them, so it is not a workflow net.'
    : '';
  return `Net class: ${text}${hint}`;
}

export function livenessSentence(found, ctx) {
  if (found.live === null) {
    return 'Liveness from the structure was not decided: the search for siphons stopped at its limit '
      + `(${found.limit === 'places' ? 'the number of places' : found.limit}), so the theorem cannot be applied.`;
  }

  const lead = `Proven from the structure (${THEOREM[found.proof]}): `;
  if (found.live) return `${lead}the net is live, so every transition can always fire again later. ${WHOLE}`;

  const why = {
    unmarked: 'No place holds a token, so nothing can ever fire.',
    'not-strongly-connected': `${ctx.listed(found.cover, ctx.name)} cannot be reached from, or cannot lead back to, the rest of the net, so tokens are lost or never arrive.`,
    'unmarked-circuit': `The circuit through ${ctx.listed(found.cover, ctx.name)} holds no token, so its transitions wait for each other for ever.`,
    'siphon-without-marked-trap': `${ctx.listed(found.cover, ctx.name)} can run empty and then stay empty, and nothing inside them keeps a token, so the transitions that need them stop for good.`,
  }[found.reason];
  return `${lead}the net is not live. ${why} ${WHOLE}`;
}

export function boundednessSentence(found, ctx) {
  const lead = `Proven from the structure (${THEOREM[found.proof]}): `;
  if (found.bounded && found.proof === 'place-invariants') {
    return `${lead}every place is bounded. Each lies in a weighted token count that never changes, so none can grow without bound. ${WHOLE}`;
  }
  if (found.bounded) return `${lead}the net is live and bounded. ${WHOLE}`;
  return `${lead}the net is live but not bounded. ${ctx.listed(found.cover, ctx.name)} lie in no part of the net that only `
    + `passes tokens on, so tokens pile up there. ${WHOLE}`;
}

function reasonText(reason, ctx, shape) {
  const end = ctx.name.get(shape.end) ?? shape.end;
  switch (reason.kind) {
    case 'unbounded':
      return `${ctx.listed(reason.places, ctx.name)} grow without bound, which a sound net never does`;
    case 'improper':
      return `${end} can be reached while other places still hold tokens, in the marking ${ctx.describe(reason.key, ctx.name)}`;
    case 'stuck':
      return `it can get stuck in the marking ${ctx.describe(reason.key, ctx.name)} before ${end} is reached`;
    case 'cannot-end':
      return `from the marking ${ctx.describe(reason.key, ctx.name)} ${end} can no longer be reached`;
    case 'never-ends':
      return `${end} can never be reached`;
    case 'dead':
      return `${ctx.listed(reason.transitions, ctx.name)} can never fire`;
    case 'closed-not-live':
      return `the net closed from ${end} back to the start is not live (${ctx.listed(reason.cover, ctx.name)} can run empty and stay empty)`;
    default:
      return reason.kind;
  }
}

export function soundnessSentence(verdict, ctx, shape, searchedCount) {
  const start = ctx.name.get(shape.start) ?? shape.start;
  const end = ctx.name.get(shape.end) ?? shape.end;
  const basis = verdict.fromDrawn
    ? `Checked on the ${searchedCount} reachable markings.`
    : `Started with one token in ${start}, not as the net is drawn, and checked on the ${searchedCount} reachable markings.`;

  if (verdict.sound === true && verdict.proof) {
    return `Sound workflow net, proven from the structure (${THEOREM[verdict.proof]}; ${THEOREM[verdict.theorem] ?? verdict.theorem}). ${WHOLE}`;
  }
  if (verdict.sound === true) {
    return `Sound workflow net: from one token in ${start}, every reachable marking can still reach ${end}, `
      + `${end} is only reached with all other places empty, and every transition can fire. ${basis}`;
  }
  if (verdict.sound === false) {
    const reasons = verdict.reasons.map((reason) => reasonText(reason, ctx, shape));
    const cut = verdict.searched.complete ? '' : ' The search stopped at its limit, so there may be more.';
    return `Not a sound workflow net: ${reasons.join('; ')}. ${basis}${cut}`;
  }
  return `Workflow net: soundness was not decided. The search stopped at its limit without finding a fault, and `
    + `the structure does not decide it for this net. ${basis}`;
}
