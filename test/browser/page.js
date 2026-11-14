/**
 * The page the browser checks drive: the modeler on its own, on the window, and
 * nothing else. A check waits for `ptnReady` and then works through `ptn`.
 */
import { PnModeler } from '../../index.js';

const modeler = new PnModeler({ container: document.getElementById('canvas') });
await modeler.createNew();

window.ptn = modeler;
window.ptnReady = true;
