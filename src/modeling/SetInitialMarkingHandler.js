/**
 * One command that gives the places of the net their initial markings.
 *
 * Everything happens in preExecute: the single changes are commands of their own, and a
 * command another handler starts there belongs to the step that started it. So one press of
 * undo puts the whole net back, as it does for a layout (ArrangeHandler). A place whose count
 * does not change is left alone, so a marking equal to the net's own writes nothing.
 */
export default class SetInitialMarkingHandler {
  static $inject = ['modeling'];

  constructor(modeling) {
    this._modeling = modeling;
  }

  preExecute(context) {
    for (const { place, tokens } of context.changes) {
      this._modeling.updateProperty(place, 'initialMarking', tokens, { rerender: true });
    }
  }

  execute() {}

  revert() {}
}
