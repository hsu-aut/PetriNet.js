/**
 * The properties of the selected element, in a card at the right of the canvas.
 *
 * Plain DOM, like the findings and the state space: the panel has seven fields
 * and no tables, and a framework would add a dependency and a build step to a
 * package that ships its sources. It feels like the one in FPB.JS through its
 * behaviour: a heading with the kind and the name, a read-only id with a Copy
 * button, closed at first start and then as the user left it.
 *
 * Every committed change is one command of the modeler's own, the same ones the
 * canvas uses, so undo, redo and the host's `changed` work as for any edit. A
 * text field commits on Enter and on blur, never on a key. What was typed is
 * checked before anything is written, and a wrong value is never written.
 */
import { describe, parseMarking, parseWeight, netCounts } from './values.js';

const STORE_KEY = 'petrinetjs.properties.open';

let counter = 0;

const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function remembered() {
  try {
    return window.localStorage.getItem(STORE_KEY) === 'true';
  } catch (error) {
    return false;
  }
}

function remember(open) {
  try {
    window.localStorage.setItem(STORE_KEY, String(open));
  } catch (error) {
    /* storage can be blocked; the panel works without it */
  }
}

export default class PropertiesPanel {
  static $inject = [
    'eventBus', 'canvas', 'selection', 'modeling', 'elementRegistry', 'injector', 'config.propertiesPanel',
  ];

  constructor(eventBus, canvas, selection, modeling, elementRegistry, injector, config) {
    this._eventBus = eventBus;
    this._canvas = canvas;
    this._selection = selection;
    this._modeling = modeling;
    this._elementRegistry = elementRegistry;
    this._enabled = config !== false;
    this._simulation = injector.get('simulation', false);
    this._fields = [];
    this._shown = null;
    this._open = false;
    this._id = `ptn-properties-${(counter += 1)}`;

    if (!this._enabled) return;

    const options = config && typeof config === 'object' ? config : {};
    this._open = typeof options.open === 'boolean' ? options.open : remembered();

    this._build();

    const side = injector.get('side', false);
    eventBus.on('canvas.init', () => {
      if (side) {
        side.row.append(this._button);
        side.column.prepend(this._card);
      } else {
        canvas.getContainer().append(this._button, this._card);
      }
      this._apply();
      this._render();
    });

    eventBus.on('selection.changed', () => this._render());
    eventBus.on('commandStack.changed', () => this._sync());
    eventBus.on(['import.done', 'diagram.clear'], () => this._render(true));
    eventBus.on('simulation.changed', () => this._lock());

    // P opens the panel and puts the cursor in its first field.
    const keyboard = injector.get('keyboard', false);
    keyboard?.addListener(1100, (context) => {
      const event = context.keyEvent;
      if (keyboard.hasModifier(event) || !keyboard.isKey(['p', 'P'], event)) return undefined;
      this.open({ focus: true });
      return true;
    });
  }

  get isOpen() {
    return this._open;
  }

  open({ focus = false } = {}) {
    if (!this._enabled) return;
    this._setOpen(true);
    if (focus) this._fields.find((field) => !field.input.readOnly && !field.input.disabled)?.input.focus();
  }

  close() {
    if (this._enabled) this._setOpen(false);
  }

  toggle() {
    if (this._open) this.close();
    else this.open();
  }

  // ── building ────────────────────────────────────────────────────────────

  _build() {
    this._button = make('button', 'ptn-properties-button', 'Properties');
    this._button.type = 'button';
    this._button.title = 'The properties of the selected element (P)';
    this._button.setAttribute('aria-controls', this._id);
    this._button.addEventListener('click', () => this.toggle());

    this._card = make('section', 'ptn-properties');
    this._card.id = this._id;
    this._card.hidden = true;

    const head = make('div', 'ptn-properties-head');
    this._heading = make('h2', 'ptn-properties-title');
    this._heading.id = `${this._id}-title`;
    this._card.setAttribute('aria-labelledby', this._heading.id);
    const close = make('button', 'ptn-properties-close', '✕');
    close.type = 'button';
    close.title = 'Close the properties';
    close.setAttribute('aria-label', 'Close the properties');
    close.addEventListener('click', () => {
      this.close();
      this._canvas.focus?.();
    });
    head.append(this._heading, close);

    this._body = make('div', 'ptn-properties-body');
    this._note = make('p', 'ptn-properties-note');
    this._note.setAttribute('aria-live', 'polite');
    this._card.append(head, this._body, this._note);
  }

  _setOpen(open) {
    if (this._open === open) return;
    this._open = open;
    remember(open);
    this._apply();
    this._eventBus.fire('propertiesPanel.changed', { open });
  }

  _apply() {
    if (!this._card) return;
    this._card.hidden = !this._open;
    this._button.setAttribute('aria-expanded', String(this._open));
    this._button.classList.toggle('ptn-properties-button-open', this._open);
  }

  get _locked() {
    return Boolean(this._simulation?.active);
  }

  // ── what is shown ───────────────────────────────────────────────────────

  _target() {
    const what = describe(this._selection.get());
    if (what.kind === 'none') {
      const root = this._canvas.getRootElement();
      return { kind: 'net', element: root, key: `net:${root.id}` };
    }
    if (what.kind === 'many') return { kind: 'many', text: what.text, key: `many:${what.text}` };
    return { kind: what.kind, element: what.element, key: `${what.kind}:${what.element.id}` };
  }

  /** Rebuilds the card when it shows another element, and only then. */
  _render(force = false) {
    if (!this._card) return;
    const target = this._target();
    if (!force && this._shown?.key === target.key) {
      this._sync();
      return;
    }

    this._shown = target;
    this._fields = [];
    this._counts = null;
    this._body.replaceChildren();
    this._note.textContent = '';

    const bo = target.element?.businessObject;
    const name = bo?.name;
    const titles = { place: 'Place', transition: 'Transition', arc: 'Arc', net: 'Net', many: 'Selection' };
    this._heading.textContent = target.kind === 'many'
      ? titles.many
      : `${titles[target.kind]}: ${name || (target.kind === 'net' ? target.element.id : target.element.id)}`;

    if (target.kind === 'many') {
      this._body.append(make('p', 'ptn-properties-text', target.text));
      return;
    }

    if (target.kind === 'net') this._buildNet(target.element);
    if (target.kind === 'place') this._buildPlace(target.element);
    if (target.kind === 'transition') this._buildTransition(target.element);
    if (target.kind === 'arc') this._buildArc(target.element);
    this._lock();
  }

  _buildNet(root) {
    this._text('Name', () => root.businessObject?.name ?? '',
      (value) => this._modeling.updateProperty(root, 'name', value === '' ? undefined : value));
    const counts = netCounts(this._elementRegistry.getAll());
    this._counts = make('p', 'ptn-properties-text',
      `${counts.places} place(s), ${counts.transitions} transition(s), ${counts.arcs} arc(s).`);
    this._body.append(this._counts);
    this._identifier(root);
  }

  _buildPlace(element) {
    this._text('Name', () => element.businessObject.name ?? '',
      (value) => this._modeling.updateLabel(element, value));
    this._text('Initial marking', () => String(element.businessObject.initialMarking ?? 0),
      (value) => this._modeling.updateProperty(element, 'initialMarking', value, { rerender: true }),
      { parse: parseMarking, numeric: true });
    this._identifier(element);
  }

  _buildTransition(element) {
    this._text('Name', () => element.businessObject.name ?? '',
      (value) => this._modeling.updateLabel(element, value));
    this._check('Silent', () => Boolean(element.businessObject.isSilent),
      (value) => this._modeling.updateProperty(element, 'isSilent', value, { rerender: true }));
    this._body.append(make('p', 'ptn-properties-hint', "A silent transition's name is not drawn."));
    this._identifier(element);
  }

  _buildArc(element) {
    this._text('Weight', () => String(element.businessObject.inscription || 1),
      (value) => this._modeling.updateLabel(element, String(value)),
      { parse: parseWeight, numeric: true });
    this._text('Name', () => element.businessObject.name ?? '',
      (value) => this._modeling.updateProperty(element, 'name', value === '' ? undefined : value));
    this._body.append(make('p', 'ptn-properties-hint', "An arc's name is not drawn."));
    this._identifier(element);
  }

  // ── fields ──────────────────────────────────────────────────────────────

  _row(label, id) {
    const row = make('div', 'ptn-prop');
    const caption = make('label', 'ptn-prop-label', label);
    caption.htmlFor = id;
    row.append(caption);
    this._body.append(row);
    return row;
  }

  /**
   * A text field. `read` gives the stored value as text, `write` stores a parsed
   * one. Both close over the element the field was built for, so a commit that
   * happens after the selection moved still goes to the right element.
   */
  _text(label, read, write, { parse = (text) => ({ ok: true, value: text }), numeric = false } = {}) {
    const id = `${this._id}-${this._fields.length}`;
    const row = this._row(label, id);

    const input = make('input', 'ptn-prop-input');
    input.id = id;
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    if (numeric) input.inputMode = 'numeric';
    input.value = read();

    const error = make('p', 'ptn-prop-error');
    error.id = `${id}-error`;
    error.hidden = true;
    row.append(input, error);

    const field = { input, read, write, parse, error, element: this._shown.element };
    this._fields.push(field);

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this._commit(field, false);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        input.value = read();
        this._clear(field);
        this._canvas.focus?.();
      }
    });
    input.addEventListener('blur', () => this._commit(field, true));
    return field;
  }

  _check(label, read, write) {
    const id = `${this._id}-${this._fields.length}`;
    const row = this._row(label, id);
    row.classList.add('ptn-prop-check');

    const input = make('input', 'ptn-prop-input');
    input.id = id;
    input.type = 'checkbox';
    input.checked = read();
    row.append(input);

    const field = { input, read, write, check: true, error: make('p'), element: this._shown.element };
    this._fields.push(field);

    input.addEventListener('change', () => {
      if (this._locked || input.checked === read()) return;
      const { element } = field;
      setTimeout(() => {
        if (this._elementRegistry.get(element.id) || element === this._canvas.getRootElement()) write(input.checked);
      }, 0);
    });
    return field;
  }

  _identifier(element) {
    const id = `${this._id}-id`;
    const row = this._row('ID', id);
    const input = make('input', 'ptn-prop-input');
    input.id = id;
    input.type = 'text';
    input.readOnly = true;
    input.value = element.id;
    input.addEventListener('focus', () => input.select());

    const copy = make('button', 'ptn-prop-copy', 'Copy');
    copy.type = 'button';
    copy.title = 'Copy the id';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(element.id);
        this._say('Copied.');
      } catch (error) {
        input.focus();
        this._say('Select the id and copy it.');
      }
    });
    row.append(input, copy);
  }

  _say(text) {
    this._note.textContent = text;
  }

  _fail(field, message) {
    field.error.textContent = message;
    field.error.hidden = false;
    field.input.setAttribute('aria-invalid', 'true');
    field.input.setAttribute('aria-describedby', field.error.id);
  }

  _clear(field) {
    field.error.hidden = true;
    field.error.textContent = '';
    field.input.removeAttribute('aria-invalid');
    field.input.removeAttribute('aria-describedby');
  }

  // ── committing ──────────────────────────────────────────────────────────

  /**
   * Writes what was typed, if it is a change and a valid one. On blur a wrong
   * value is put back to the stored one; on Enter it stays so it can be mended.
   */
  _commit(field, blurred) {
    if (this._locked || field.input.readOnly) return;

    const stored = field.read();
    const typed = field.input.value;
    const parsed = field.parse(typed);

    if (!parsed.ok) {
      this._fail(field, parsed.message);
      if (blurred) field.input.value = stored;
      return;
    }
    this._clear(field);

    // Nothing changed: no command, so the host gets no empty `changed`.
    if (String(parsed.value) === stored && (field.parse(stored).value === parsed.value)) {
      field.input.value = stored;
      return;
    }

    const { element } = field;
    const root = this._canvas.getRootElement();
    // A commit never runs inside another command: it waits for the one that is
    // running, and is dropped if its element is gone by then.
    setTimeout(() => {
      if (element !== root && !this._elementRegistry.get(element.id)) return;
      if (this._locked) return;
      field.write(parsed.value);
      if (document.activeElement === field.input) field.input.value = field.read();
    }, 0);
  }

  /** Puts the stored values into the fields, leaving the one being typed in alone. */
  _sync() {
    if (!this._card || !this._shown) return;
    if (this._shown.kind === 'net' && this._counts) {
      const counts = netCounts(this._elementRegistry.getAll());
      this._counts.textContent = `${counts.places} place(s), ${counts.transitions} transition(s), ${counts.arcs} arc(s).`;
    }
    for (const field of this._fields) {
      if (document.activeElement === field.input) continue;
      if (field.check) field.input.checked = field.read();
      else {
        field.input.value = field.read();
        this._clear(field);
      }
    }
  }

  /** Read only while the net runs: the drawing shows the marking of the run, the panel the document's. */
  _lock() {
    if (!this._card) return;
    const locked = this._locked;
    for (const field of this._fields) {
      if (field.check) field.input.disabled = locked;
      else field.input.readOnly = locked;
    }
    this._note.textContent = locked ? 'The net is running. Stop the simulation to edit it.' : '';
  }
}
