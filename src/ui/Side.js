/**
 * The right-hand side of the canvas, shared by the cards that sit there.
 *
 * A row at the top holds the buttons that open them, and a column under it holds
 * the cards, so that they stack instead of lying on top of one another. The
 * Analyse button once ran under the State space button because both sat at
 * fixed offsets. A card is added to the column by whoever builds it, and the
 * column leaves the palette and the bar at the bottom free.
 */
export default class Side {
  static $inject = ['eventBus', 'canvas'];

  constructor(eventBus, canvas) {
    this.row = document.createElement('div');
    this.row.className = 'ptn-side-row';

    this.column = document.createElement('div');
    this.column.className = 'ptn-side-column';

    eventBus.on('canvas.init', () => canvas.getContainer().append(this.row, this.column));
  }

  /**
   * Puts a button into the row at its place. The order on the screen is the order of
   * `rank`, and it is the order in the document too, so that the Tab key goes the way
   * the eye does.
   */
  addButton(button, rank) {
    button.dataset.rank = String(rank);
    const after = [...this.row.children].find((other) => Number(other.dataset.rank) > rank);
    this.row.insertBefore(button, after ?? null);
  }
}
