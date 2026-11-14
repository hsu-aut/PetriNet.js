/**
 * What the properties panel decides without touching the DOM or the model: how
 * what a person types is read, and how a selection is described. Pure, so that
 * the rules can be tested without a browser.
 */

const MOST_DIGITS = 9;

function wholeNumber(text, least, empty, what) {
  const trimmed = String(text ?? '').trim();
  if (trimmed === '') return { ok: true, value: empty };

  const message = `${what} is a whole number of ${least} or more.`;
  if (!/^\d+$/.test(trimmed) || trimmed.replace(/^0+/, '').length > MOST_DIGITS) return { ok: false, message };

  const value = Number(trimmed);
  return value >= least ? { ok: true, value } : { ok: false, message };
}

/** The marking of a place: a whole number, 0 or more. Nothing means 0. */
export const parseMarking = (text) => wholeNumber(text, 0, 0, 'A marking');

/** The weight of an arc: a whole number, 1 or more. Nothing means 1. */
export const parseWeight = (text) => wholeNumber(text, 1, 1, 'A weight');

const KINDS = {
  'ptn:Place': 'place',
  'ptn:Transition': 'transition',
  'ptn:Arc': 'arc',
};

/** The kind of an element: place, transition or arc, or null for anything else. */
export function kindOf(element) {
  return KINDS[element?.type] ?? null;
}

/** A label stands for the element it belongs to. */
const targetOf = (element) => element?.labelTarget ?? element;

/** The elements of a selection with labels replaced by their elements, once each. */
export function elementsOf(selection) {
  const seen = new Set();
  const found = [];
  for (const element of selection ?? []) {
    const target = targetOf(element);
    if (kindOf(target) && !seen.has(target.id)) {
      seen.add(target.id);
      found.push(target);
    }
  }
  return found;
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * What the panel shows for a selection.
 * @returns {{ kind: 'none' } | { kind: 'many', text: string } | { kind: 'place' | 'transition' | 'arc', element }}
 */
export function describe(selection) {
  const elements = elementsOf(selection);
  if (elements.length === 0) return { kind: 'none' };
  if (elements.length === 1) return { kind: kindOf(elements[0]), element: elements[0] };

  const counts = { place: 0, transition: 0, arc: 0 };
  for (const element of elements) counts[kindOf(element)] += 1;
  const parts = [
    counts.place && plural(counts.place, 'place'),
    counts.transition && plural(counts.transition, 'transition'),
    counts.arc && plural(counts.arc, 'arc'),
  ].filter(Boolean);

  return { kind: 'many', text: `${elements.length} elements selected: ${parts.join(', ')}. Select one to edit it.` };
}

/** How many places, transitions and arcs the net holds, labels left out. */
export function netCounts(elements) {
  const counts = { places: 0, transitions: 0, arcs: 0 };
  for (const element of elements) {
    if (element.labelTarget) continue;
    const kind = kindOf(element);
    if (kind === 'place') counts.places += 1;
    if (kind === 'transition') counts.transitions += 1;
    if (kind === 'arc') counts.arcs += 1;
  }
  return counts;
}
