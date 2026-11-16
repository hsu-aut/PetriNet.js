import BaseModeling from "diagram-js/lib/features/modeling/Modeling";
import UpdateLabelHandler from "./UpdateLabelHandler";
import UpdatePropertyHandler from "./UpdatePropertyHandler";
import SetInitialMarkingHandler from "./SetInitialMarkingHandler";

export default class CustomModeling extends BaseModeling {
  constructor(eventBus, elementFactory, commandStack, elementRegistry) {
    super(eventBus, elementFactory, commandStack);
    this._elementRegistry = elementRegistry;
  }

  /**
   * Gives the places of the net these markings as their initial markings, as one step of undo.
   * Places the marking does not name get none. What cannot be a marking is refused before
   * anything is written: a place that is not in the net, a count that is not a whole number of
   * at least 0, a place that holds omega.
   *
   * @param marking a Map or an object, place id to tokens
   * @returns {number} how many places changed; 0 writes nothing and is no step of undo
   */
  setInitialMarking(marking) {
    const wanted = marking instanceof Map ? marking : new Map(Object.entries(marking ?? {}));
    const places = this._elementRegistry.filter((element) => element.type === "ptn:Place" && !element.labelTarget);
    const known = new Set(places.map((place) => place.id));

    for (const [id, tokens] of wanted) {
      if (!known.has(id)) throw new Error(`${id} is not a place of the net`);
      if (!Number.isInteger(tokens) || tokens < 0) {
        throw new Error(`the marking of ${id} is ${tokens}; it has to be a whole number of at least 0`);
      }
    }

    const changes = [];
    for (const place of places) {
      const tokens = wanted.get(place.id) ?? 0;
      if (tokens !== Number(place.businessObject.initialMarking ?? 0)) changes.push({ place, tokens });
    }
    if (changes.length === 0) return 0;

    this._commandStack.execute("ptn.setInitialMarking", { changes });
    return changes.length;
  }

  updateLabel(element, newLabel, newBounds, hints) {
    this._commandStack.execute("element.updateLabel", {
      element: element,
      newLabel: newLabel,
      newBounds: newBounds,
      hints: hints || {},
    });
  }

  updateProperty(element, propertyName, newValue, hints) {
    this._commandStack.execute("element.updateProperty", {
      element: element,
      propertyName: propertyName,
      newValue: newValue,
      hints: hints || {},
    });
  }

  getHandlers() {
    const handlers = super.getHandlers.call(this);
    handlers["element.updateLabel"] = UpdateLabelHandler;
    handlers["element.updateProperty"] = UpdatePropertyHandler;
    handlers["ptn.setInitialMarking"] = SetInitialMarkingHandler;
    return handlers;
  }
}

CustomModeling.$inject = ["eventBus", "elementFactory", "commandStack", "elementRegistry"];
