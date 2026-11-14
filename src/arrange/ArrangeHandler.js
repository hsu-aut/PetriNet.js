/**
 * One command that holds many moves.
 *
 * Everything happens in preExecute: the single moves are commands of their own,
 * and a command another handler starts there belongs to the step that started
 * it. So one press of undo puts the whole layout back, and the handler itself
 * has nothing left to do.
 */
export default class ArrangeHandler {
  static $inject = ['modeling'];

  constructor(modeling) {
    this._modeling = modeling;
  }

  preExecute(context) {
    for (const { shape, delta } of context.moves) {
      // moveElements, not moveShape: it takes the label of the shape along,
      // which moveShape on its own leaves where the shape used to be.
      this._modeling.moveElements([shape], delta);
    }
  }

  execute() {}

  revert() {}
}
