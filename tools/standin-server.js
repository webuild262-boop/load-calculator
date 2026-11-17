/*
 * standin-server.js — a tiny local stand-in for the data-set API.
 *
 * Serves this repository's static files (demo.html and its scripts)
 * and answers GET /api/datasets/{name} from the exported seed data,
 * the same contract the Azure Function implements — so the demo's
 * Live data path can be exercised end to end with no Azure resources.
 *
 * Usage:
 *   node tools/standin-server.js [port] [--no-api]
 *   STANDIN_DATA_DIR=/path/to/json node tools/standin-server.js
 *
 * The data directory defaults to tools/seed-data/ and is read fresh on
 * every request, so editing a JSON file changes the next day the page
 * loads — that is how the changed-document test proves the engine is
 * running on loaded data. --no-api makes every /api request answer
 * 404, for testing the page's fall back to the seeded day.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const dataDir = process.env.STANDIN_DATA_DIR || path.join(__dirname, 'seed-data');
const args = process.argv.slice(2);
const noApi = args.indexOf('--no-api') !== -1;
const port = parseInt(args.filter(function (a) { return /^\d+$/.test(a); })[0], 10) || 8931;

const NAMES = ['warehouse-inventory', 'production', 'dock-trailer-schedule',
  'upcoming-orders', 'cost-table', 'recycling', 'common-orders-and-runs'];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.md': 'text/markdown' };

const server = http.createServer(function (req, res) {
  const url = new URL(req.url, 'http://localhost');
  const m = url.pathname.match(/^\/api\/datasets\/([a-z-]+)$/);
  if (m) {
    if (noApi) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"no api here"}'); return; }
    const name = m[1];
    if (NAMES.indexOf(name) === -1) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unknown data set: ' + name, dataSets: NAMES }));
      return;
    }
    fs.readFile(path.join(dataDir, name + '.json'), 'utf8', function (err, text) {
      if (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"error":"stand-in could not read ' + name + '"}'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(text);
    });
    return;
  }
  const rel = url.pathname === '/' ? 'demo.html' : url.pathname.replace(/^\/+/, '');
  const file = path.join(repoRoot, rel);
  if (file.indexOf(repoRoot) !== 0) { res.writeHead(403); res.end('no'); return; }
  fs.readFile(file, function (err, buf) {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});
server.listen(port, '127.0.0.1', function () {
  console.log('stand-in on http://127.0.0.1:' + port + ' (data: ' + dataDir + (noApi ? ', api OFF' : '') + ')');
});
