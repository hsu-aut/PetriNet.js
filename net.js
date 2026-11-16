/**
 * The analysis core without a canvas: for a host that has a net as data and
 * nothing to draw it on, such as a command line tool.
 *
 *   import { analyseData } from 'petrinetjs/net.js';
 *   const answer = analyseData({ places, transitions, arcs });
 *
 * It imports neither diagram-js nor anything of the browser.
 */
export { analyseData, exploreData } from './src/net/plain.js';
export { analyse, RULES } from './src/net/analyse.js';
export { readNet } from './src/net/model.js';
export { explore, OMEGA } from './src/net/explore.js';
export { findingsToCsv, markingsToCsv, toDot } from './src/net/report.js';
export { classNames, netClasses, workflowShape } from './src/net/classes.js';
export { soundness } from './src/net/workflow.js';
