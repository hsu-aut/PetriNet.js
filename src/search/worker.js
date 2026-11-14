/**
 * What runs in the worker. It is bundled into workerSource.js by
 * `npm run build:worker` and started from a Blob, so it must import nothing that
 * needs the DOM: the searches are plain functions of data.
 *
 * Messages in:  { type: 'analyse' | 'explore', id, net, limits }
 * Messages out: { type: 'ready' }, { type: 'progress', id, markings, edges },
 *               { type: 'result', id, answer }, { type: 'error', id, message }
 */
import { runSearch } from './run.js';

const PROGRESS_EVERY_MS = 100;

self.onmessage = (event) => {
  const { type, id, net, limits } = event.data;

  let last = 0;
  const progress = ({ markings, edges }) => {
    const now = Date.now();
    if (now - last < PROGRESS_EVERY_MS) return;
    last = now;
    self.postMessage({ type: 'progress', id, markings, edges });
  };

  try {
    self.postMessage({ type: 'result', id, answer: runSearch(type, net, { ...limits, progress }) });
  } catch (error) {
    self.postMessage({ type: 'error', id, message: String(error?.message ?? error) });
  }
};

self.postMessage({ type: 'ready' });
