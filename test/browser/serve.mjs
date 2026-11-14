/**
 * Builds the test page and serves it, for the checks in this folder.
 *
 *   const { server, port } = await serve();
 *
 * The bundle is not minified: diagram-js resolves services through didi, which
 * falls back to constructor parameter names wherever a component omits
 * $inject, and a minifier renames those.
 */
import * as esbuild from 'esbuild';
import { cp, mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..', '..', '.test-page');

const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
};

async function build() {
  await mkdir(out, { recursive: true });

  await esbuild.build({
    entryPoints: [resolve(here, 'page.js')],
    outfile: resolve(out, 'page.js'),
    bundle: true,
    format: 'esm',
    target: 'es2022',
    minify: false,
    logLevel: 'warning',
  });

  await esbuild.build({
    entryPoints: [resolve(here, '..', '..', 'assets', 'pn-js.css')],
    outfile: resolve(out, 'page.css'),
    bundle: true,
    loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl', '.eot': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' },
    logLevel: 'warning',
  });

  await cp(resolve(here, 'index.html'), resolve(out, 'index.html'));
}

export async function serve(port = 0) {
  await build();

  const server = createServer(async (req, res) => {
    const raw = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const stripped = raw.replace(/^\/+/, '');
    const file = stripped === '' ? join(out, 'index.html') : join(out, normalize(stripped));
    if (!file.startsWith(out)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res
        .writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
        .end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });

  return new Promise((ok) =>
    server.listen(port, '127.0.0.1', () => ok({ server, port: server.address().port })),
  );
}
