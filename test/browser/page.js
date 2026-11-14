/**
 * The page the browser checks drive: the modeler on its own, on the window, and
 * nothing else. A check waits for `ptnReady` and then works through `ptn`.
 */
import { PnModeler } from '../../index.js';

// ?properties=off leaves the properties panel out, as a host that does not want it would.
const options = { container: document.getElementById('canvas') };
if (new URLSearchParams(location.search).get('properties') === 'off') options.propertiesPanel = false;

const modeler = new PnModeler(options);
await modeler.createNew();

window.ptn = modeler;
window.ptnReady = true;
