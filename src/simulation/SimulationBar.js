/**
 * The controls of the simulation, drawn on the canvas.
 *
 * Plain DOM rather than a framework: the whole bar is a handful of buttons, a
 * menu and a line of text, and the package this is forked from brings no
 * framework a host would have to load.
 *
 * The bar is also the player: it owns the clock of an automatic run, which is
 * why the speed lives here and is announced rather than asked for. The
 * animation listens to that announcement and gets out of the way when a run
 * leaves it no time.
 */
const BUTTONS = [
  { name: 'toggle', text: 'Simulate', title: 'Run the net (Escape leaves)' },
  { name: 'back', text: '◀', title: 'One firing back' },
  { name: 'step', text: '▶', title: 'Fire one transition, or do the one taken back again' },
  { name: 'together', text: '⇉', title: 'Fire everything that can fire at once, as one step' },
  { name: 'play', text: '▶▶', title: 'Fire until nothing is enabled' },
  { name: 'reset', text: '↺', title: 'Back to the initial marking' },
  {
    name: 'adopt',
    text: 'Set as initial marking',
    title: "Make the marking shown the net's initial marking. This edits the net and ends the run; Ctrl+Z takes it back.",
  },
];

const SPEEDS = [
  { label: 'Slow', milliseconds: 1400 },
  { label: 'Normal', milliseconds: 700 },
  { label: 'Fast', milliseconds: 250 },
  { label: 'Flat out', milliseconds: 60 },
];

const DEFAULT_SPEED = 700;

export default class SimulationBar {
  static $inject = ['eventBus', 'canvas', 'simulation', 'tokenFlow'];

  constructor(eventBus, canvas, simulation, tokenFlow) {
    this._eventBus = eventBus;
    this._simulation = simulation;
    this._tokenFlow = tokenFlow;
    this._playing = null;
    this._speed = DEFAULT_SPEED;

    this._container = document.createElement('div');
    this._container.className = 'ptn-simulation';

    this._buttons = {};
    for (const { name, text, title } of BUTTONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `ptn-simulation-${name}`;
      button.textContent = text;
      button.title = title;
      // The button that edits the net is there only while a run is on.
      if (name === 'adopt') button.hidden = true;
      button.addEventListener('click', () => this._click(name));
      this._container.appendChild(button);
      this._buttons[name] = button;
    }

    this._container.append(this._buildSpeed(), this._buildAnimate());

    this._status = document.createElement('span');
    this._status.className = 'ptn-simulation-status';
    this._status.setAttribute('role', 'status');
    this._container.appendChild(this._status);

    eventBus.on('canvas.init', () => {
      canvas.getContainer().appendChild(this._container);
      this._update({ active: false });
    });

    eventBus.on('simulation.changed', (event) => this._update(event));

    // Something the simulation refused to do, said once, until the next step.
    eventBus.on('simulation.said', (event) => {
      this._status.textContent = event.message;
    });

    // Escape leaves the simulation, as it leaves every other mode.
    eventBus.on('keyboard.keydown', (event) => {
      if (event.keyEvent?.key === 'Escape' && this._simulation.active) {
        this._stop();
        return true;
      }
      return undefined;
    });
  }

  _buildSpeed() {
    const select = document.createElement('select');
    select.className = 'ptn-simulation-speed';
    select.title = 'How fast an automatic run fires';

    for (const { label, milliseconds } of SPEEDS) {
      const option = document.createElement('option');
      option.value = String(milliseconds);
      option.textContent = label;
      option.selected = milliseconds === DEFAULT_SPEED;
      select.appendChild(option);
    }

    select.addEventListener('change', () => {
      this._speed = Number(select.value) || DEFAULT_SPEED;
      // A speed picked while the run is going takes effect at once.
      if (this._playing) this._play();
    });

    this._speedSelect = select;
    return select;
  }

  _buildAnimate() {
    const label = document.createElement('label');
    label.className = 'ptn-simulation-animate';
    label.title = 'Show the tokens moving along the arcs a firing uses';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this._tokenFlow.wanted;
    box.addEventListener('change', () => { this._tokenFlow.wanted = box.checked; });

    const text = document.createElement('span');
    text.textContent = 'Animate';

    label.append(box, text);
    return label;
  }

  _click(name) {
    const simulation = this._simulation;

    if (name === 'toggle') {
      if (simulation.active) this._stop();
      else simulation.start();
      return;
    }
    if (!simulation.active) return;

    this._pause();
    if (name === 'back') simulation.stepBack();
    if (name === 'step') simulation.fireOne();
    if (name === 'together') simulation.fireStep();
    if (name === 'reset') simulation.reset();
    if (name === 'adopt') simulation.setAsInitial();
    if (name === 'play') this._play();
  }

  _play() {
    if (this._playing) clearInterval(this._playing);

    // The animation is told how much time a firing gets, so that it can leave
    // the picture alone when the answer is "not enough".
    this._eventBus.fire('simulation.speed', { milliseconds: this._speed });

    this._playing = setInterval(() => {
      if (!this._simulation.fireOne()) this._pause();
    }, this._speed);
    this._update({
      active: true,
      enabled: this._simulation.enabled,
      steps: this._simulation.steps,
      undone: this._simulation.undone,
    });
  }

  _pause() {
    if (this._playing) clearInterval(this._playing);
    this._playing = null;
    // Outside a run a firing has all the time it needs.
    this._eventBus.fire('simulation.speed', { milliseconds: Infinity });
  }

  _stop() {
    this._pause();
    this._simulation.stop();
  }

  _update(event) {
    const { active, enabled = [], steps = [], undone = [], deadlocked, problem } = event;

    // A run can end without the bar's own Stop: a host stops it, an import or an
    // undo does. The clock must not outlive it, or it fires into the next run.
    if (!active && this._playing) this._pause();

    this._container.classList.toggle('ptn-simulation-active', Boolean(active));
    this._buttons.toggle.textContent = active ? 'Stop' : 'Simulate';
    for (const name of ['back', 'step', 'together', 'play', 'reset']) {
      this._buttons[name].disabled = !active;
    }
    // Shown only while a run is on, and offered only where it would change something.
    this._buttons.adopt.hidden = !active;
    this._buttons.adopt.disabled = !this._simulation.canSetAsInitial;
    this._buttons.back.disabled = !active || steps.length === 0;
    this._buttons.step.disabled = !active || (enabled.length === 0 && undone.length === 0);
    this._buttons.play.disabled = this._buttons.step.disabled;
    // A step fires what is enabled now; it does not replay what was taken back.
    this._buttons.together.disabled = !active || enabled.length === 0;

    if (problem) this._status.textContent = problem;
    else if (!active) this._status.textContent = '';
    else if (deadlocked && undone.length === 0) this._status.textContent = `${count(steps)}, nothing is enabled`;
    else this._status.textContent = `${count(steps)}, ${enabled.length} enabled`;
  }
}

const count = (steps) => (steps.length === 1 ? '1 firing' : `${steps.length} firings`);
