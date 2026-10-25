import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import test from 'node:test';
import vm from 'node:vm';
import { createSetupServer } from '../wizard/server.mjs';
import { renderSetupPage } from '../wizard/ui.mjs';
import { createTerminalBootstrap } from './terminal-bootstrap.mjs';
import { probeApplicationUrl } from '../wizard/app-readiness.mjs';
import { resolveAppStartInvocation } from '../wizard/app-process.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('HTTP readiness follows redirects and rejects a failing target or redirect loop', async (t) => {
  const service = http.createServer((req, res) => {
    if (req.url === '/ready') { res.end('ready'); return; }
    if (req.url === '/broken') { res.writeHead(503); res.end('unavailable'); return; }
    res.writeHead(302, { Location: req.url === '/good' ? '/ready' : req.url === '/loop' ? '/loop' : '/broken' });
    res.end();
  });
  await new Promise((resolve) => service.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => service.close(resolve)));
  const base = `http://127.0.0.1:${service.address().port}`;
  assert.equal(await probeApplicationUrl(`${base}/good`), true);
  assert.equal(await probeApplicationUrl(`${base}/bad`), false);
  assert.equal(await probeApplicationUrl(`${base}/loop`), false);
});
async function port() {
  const s = net.createServer();
  await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve));
  const p = s.address().port;
  await new Promise((resolve) => s.close(resolve));
  return p;
}
async function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verified-start-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>Installed application</h1>');
  const appPort = await port();
  if (options.frontendPort) fs.writeFileSync(path.join(root, 'setup.config.json'), JSON.stringify({ ports: { app: appPort, dev: options.frontendPort } }));
  options.prepareRoot?.(root, appPort);
  const token = 'verified-start-token-123456789';
  const server = createSetupServer(token, { projectRoot: root, dataDir: root, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = await fetch(`${base}/setup?token=${token}`, { redirect: 'manual' });
  const cookie = auth.headers.get('set-cookie').split(';')[0];
  const html = await (await fetch(`${base}/setup`, { headers: { Cookie: cookie } })).text();
  const csrf = JSON.parse(html.match(/window\.__SETUP__=(\{[^;]+\});/)[1]).csrfToken;
  const request = async (route, body) => {
    const response = await fetch(base + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json', 'X-Setup-CSRF': csrf },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  t.after(async () => {
    try { await server.stopSpawnedApp(); } finally {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  const apply = (deployment = {}) => request('/api/apply', {
    deployment: { mode: 'localhost', publicUrl: `http://127.0.0.1:${appPort}`, basePath: '/', allowedOrigins: [`http://127.0.0.1:${appPort}`], trustProxyHops: 0, retention: { enabled: false, actionLogDays: 180, readNotificationDays: 90, emailLogDays: 60, passwordResetDays: 30 }, ...deployment },
    server: { host: '127.0.0.1', port: appPort },
    admin: { name: 'Administrator', email: 'admin@example.com', password: 'Guclu_Parola_2026!' }, email: { enabled: false }, buildClient: false, overwriteExistingEnv: false,
  });
  return { root, appPort, request, apply, server };
}
async function until(fn, predicate, timeout = 12000) {
  const deadline = Date.now() + timeout;
  let result;
  do { result = await fn(); if (predicate(result)) return result; await sleep(80); } while (Date.now() < deadline);
  assert.fail(`condition timed out: ${JSON.stringify(result)}`);
}

test('successful installation automatically starts the static app before reporting application readiness', async (t) => {
  const f = await fixture(t);
  const applied = await f.apply();
  assert.equal(applied.status, 202, JSON.stringify(applied.body));
  const result = await until(() => f.request('/api/status'), (r) => r.body.apply?.application?.state === 'ready');
  assert.equal(result.body.apply.status, 'success');
  assert.match(await (await fetch(`http://127.0.0.1:${f.appPort}`)).text(), /Installed application/);
});

test('built static application uses its served port even when a separate development port is configured', async (t) => {
  const f = await fixture(t, { frontendPort: await port() });
  await f.apply();
  const ready = await until(() => f.request('/api/status'), (r) => r.body.apply?.application?.state === 'ready');
  const health = await f.request('/api/app-health');
  assert.equal(ready.body.apply.status, 'success');
  assert.equal(health.body.loginUrl, `http://127.0.0.1:${f.appPort}`);
});

test('single web server serving its own frontend does not wait for an unused development server', async (t) => {
  const f = await fixture(t, {
    frontendPort: await port(),
    prepareRoot(root) { fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'single-web-server', scripts: { start: 'node app.mjs' } })); },
    startAppInvocation: { command: process.execPath, args: ['-e', 'require("http").createServer((q,s)=>s.end("full stack page")).listen(process.env.PORT,"127.0.0.1")'] },
  });
  await f.apply();
  await until(() => f.request('/api/status'), (r) => r.body.apply?.application?.state === 'ready');
  const health = await f.request('/api/app-health');
  assert.equal(health.body.uiPort, f.appPort);
  assert.equal(await (await fetch(health.body.loginUrl)).text(), 'full stack page');
});

test('signal-terminated application can be retried after a successful installation', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(t, { startAppInvocation: { command: process.execPath, args: ['-e', 'const fs=require("fs");if(!fs.existsSync("repair")){process.kill(process.pid,"SIGTERM")}else{require("http").createServer((q,s)=>s.end("repaired")).listen(process.env.PORT,"127.0.0.1")}'] } });
  await f.apply();
  await until(() => f.request('/api/status'), (r) => r.body.apply?.application?.state === 'error');
  fs.writeFileSync(path.join(f.root, 'repair'), 'ready');
  const result = await f.request('/api/start-app', {});
  assert.equal(result.body.reachable, true);
});

test('automatic application crash preserves installation success and allows one serialized retry', async (t) => {
  const f = await fixture(t, { startAppInvocation: { command: process.execPath, args: ['-e', 'const fs=require("fs");fs.appendFileSync("starts","x");if(!fs.existsSync("repair")){console.error("start failed");process.exit(9)}require("http").createServer((q,s)=>s.end("repaired")).listen(process.env.PORT,"127.0.0.1")'] } });
  await f.apply();
  const result = await until(() => f.request('/api/status'), (r) => r.body.apply?.application?.state === 'error');
  assert.equal(result.body.apply.status, 'success');
  assert.match(result.body.apply.application.message, /start failed|9/);
  assert.ok(fs.existsSync(path.join(f.root, 'installation.lock')));
  fs.writeFileSync(path.join(f.root, 'repair'), 'ready');
  const retries = await Promise.all([f.request('/api/start-app', {}), f.request('/api/start-app', {})]);
  assert.ok(retries.every((r) => r.status === 200 && r.body.reachable));
  assert.equal(fs.readFileSync(path.join(f.root, 'starts'), 'utf8'), 'xx', 'concurrent retry must launch only once');
});

test('health rejects a listening TCP socket that cannot serve HTTP', async (t) => {
  const f = await fixture(t);
  fs.writeFileSync(path.join(f.root, '.env'), `PORT=${f.appPort}\n`);
  const tcp = net.createServer((socket) => socket.destroy());
  await new Promise((resolve) => tcp.listen(f.appPort, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => tcp.close(resolve)));
  const health = await f.request('/api/app-health');
  assert.equal(health.body.reachable, false);
});

test('dual startup waits for frontend HTTP even when backend is already listening', { timeout: 45000 }, async (t) => {
  const frontendPort = await port();
  const f = await fixture(t, {
    frontendPort,
    startAppInvocation: {
      type: 'dual',
      backend: { command: process.execPath, args: ['-e', 'require("http").createServer((q,s)=>s.end("api")).listen(process.env.PORT,"127.0.0.1")'] },
      frontend: { command: process.execPath, args: ['-e', 'const fs=require("fs");const timer=setInterval(()=>{if(!fs.existsSync("frontend-ready"))return;clearInterval(timer);require("http").createServer((q,s)=>s.end("ui")).listen(process.env.PORT,"127.0.0.1")},50)'] },
    },
  });
  // Existing installation allows manual start without applying a new configuration.
  fs.writeFileSync(path.join(f.root, 'installation.lock'), 'installed');
  fs.writeFileSync(path.join(f.root, '.env'), `PORT=${f.appPort}\n`);
  const start = await f.request('/api/start-app', {});
  assert.equal(start.status, 202);
  assert.equal(start.body.reachable, false);
  fs.writeFileSync(path.join(f.root, 'frontend-ready'), 'ready');
  const ready = await until(() => f.request('/api/app-health'), (r) => r.body.reachable);
  assert.equal(ready.body.apiReachable, true);
  assert.equal(ready.body.uiReachable, true);
  assert.equal(ready.body.loginUrl, `http://127.0.0.1:${frontendPort}`);
  assert.equal(await (await fetch(ready.body.loginUrl)).text(), 'ui');
});

test('auto-resolved dual project never treats an existing backend alone as a ready frontend', async (t) => {
  const f = await fixture(t, { frontendPort: await port(), prepareRoot(root) {
    fs.unlinkSync(path.join(root, 'index.html'));
    for (const [dir, dependency] of [['backend', 'express'], ['frontend', 'vue']]) {
      fs.mkdirSync(path.join(root, dir));
      fs.writeFileSync(path.join(root, dir, 'package.json'), JSON.stringify({ name: dir, scripts: dir === 'backend' ? { start: 'node index.mjs' } : { dev: 'vite' }, dependencies: { [dependency]: '*' } }));
      fs.writeFileSync(path.join(root, dir, 'index.mjs'), 'import http from "node:http";http.createServer((q,s)=>s.end("component")).listen(process.env.PORT,"127.0.0.1");');
    }
  } });
  assert.equal(resolveAppStartInvocation(f.root).type, 'dual');
  const backend = http.createServer((req, res) => res.end('existing API'));
  await new Promise((resolve) => backend.listen(f.appPort, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => backend.close(resolve)));
  fs.writeFileSync(path.join(f.root, 'installation.lock'), 'installed');
  fs.writeFileSync(path.join(f.root, '.env'), `PORT=${f.appPort}\n`);
  const start = await f.request('/api/start-app', {});
  assert.equal(start.body.reachable, false);
});

test('failed installation never starts an application process', async (t) => {
  const f = await fixture(t, { startAppInvocation: { command: process.execPath, args: ['-e', 'require("fs").writeFileSync("unwanted-start","yes")'] } });
  fs.writeFileSync(path.join(f.root, '.env'), 'DO_NOT_OVERWRITE=1\n');
  await f.apply();
  const status = await until(() => f.request('/api/status'), (r) => r.body.apply?.status === 'error');
  assert.equal(status.body.apply.application.state, 'idle');
  assert.equal(fs.existsSync(path.join(f.root, 'unwanted-start')), false);
});

test('closing the wizard server also closes the automatically owned application', async (t) => {
  const f = await fixture(t);
  await f.apply();
  await until(() => f.request('/api/app-health'), (r) => r.body.reachable);
  await new Promise((resolve) => f.server.close(resolve));
  await until(async () => { try { await fetch(`http://127.0.0.1:${f.appPort}`); return false; } catch { return true; } }, Boolean, 3000);
});

test('production navigation waits for the configured external HTTP address while the local service keeps running', async (t) => {
  const externalPort = await port();
  const f = await fixture(t, { appStartTimeoutMs: 5000 });
  await f.apply({ mode: 'subdomain', publicUrl: `http://127.0.0.1:${externalPort}` });
  await until(() => f.request('/api/status'), (r) => r.body.apply?.application?.state === 'error');
  const health = await f.request('/api/app-health');
  assert.equal(health.body.serviceReachable, true);
  assert.equal(health.body.publicReachable, false);
  assert.equal(health.body.reachable, false);
  const proxy = http.createServer((req, res) => res.end('public page'));
  await new Promise((resolve) => proxy.listen(externalPort, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => proxy.close(resolve)));
  const retry = await f.request('/api/start-app', {});
  assert.equal(retry.body.reachable, true);
  assert.equal(retry.body.loginUrl, `http://127.0.0.1:${externalPort}`);
});

test('subpath deployment verifies the mounted application path before opening its configured address', async (t) => {
  const f = await fixture(t, {
    prepareRoot(root) {
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'mounted-path-app', scripts: { start: 'node app.mjs' } }));
      fs.writeFileSync(path.join(root, 'setup.config.json'), JSON.stringify({ app: { loginPath: '/login' } }));
    },
    startAppInvocation: { command: process.execPath, args: ['-e', 'require("http").createServer((q,s)=>{s.statusCode=q.url==="/portal/login"?200:404;s.end("mounted app")}).listen(process.env.PORT,"127.0.0.1")'] },
  });
  await f.apply({ mode: 'subpath', publicUrl: `http://127.0.0.1:${f.appPort}`, basePath: '/portal' });
  const result = await until(() => f.request('/api/status'), (r) => r.body.apply?.application?.state === 'ready');
  assert.equal(result.body.apply.status, 'success');
  const health = await f.request('/api/app-health');
  assert.equal(health.body.reachable, true);
  assert.equal(health.body.loginUrl, `http://127.0.0.1:${f.appPort}/portal/login`);
});

test('subpath readiness also supports a proxy that strips the external prefix', async (t) => {
  const publicPort = await port();
  const f = await fixture(t, {
    prepareRoot(root) {
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'strip-prefix-app', scripts: { start: 'node app.mjs' } }));
      fs.writeFileSync(path.join(root, 'setup.config.json'), JSON.stringify({ app: { loginPath: '/login' } }));
    },
    startAppInvocation: { command: process.execPath, args: ['-e', 'require("http").createServer((q,s)=>{s.statusCode=q.url==="/login"?200:404;s.end("proxied app")}).listen(process.env.PORT,"127.0.0.1")'] },
  });
  const proxy = http.createServer((req, res) => {
    const upstream = http.get(`http://127.0.0.1:${f.appPort}${req.url.replace(/^\/portal/, '') || '/'}`, (response) => {
      res.writeHead(response.statusCode); response.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end('upstream pending'); });
  });
  await new Promise((resolve) => proxy.listen(publicPort, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => proxy.close(resolve)));
  await f.apply({ mode: 'subpath', publicUrl: `http://127.0.0.1:${publicPort}`, basePath: '/portal' });
  await until(() => f.request('/api/status'), (r) => r.body.apply?.application?.state === 'ready');
  const health = await f.request('/api/app-health');
  assert.equal(health.body.loginUrl, `http://127.0.0.1:${publicPort}/portal/login`);
  assert.equal(health.body.reachable, true);
});

test('cancellation while a static listener is starting cannot leave an application listening', async (t) => {
  const f = await fixture(t);
  const nativeListen = http.Server.prototype.listen;
  let cancelled;
  const cancellation = new Promise((resolve) => { cancelled = resolve; });
  http.Server.prototype.listen = function (...args) {
    if (args[0] === f.appPort) {
      const ready = args.pop();
      args.push(() => { f.server.close(cancelled); setTimeout(ready, 40); });
    }
    return nativeListen.apply(this, args);
  };
  t.after(() => { http.Server.prototype.listen = nativeListen; });
  await f.apply();
  await cancellation;
  await sleep(120);
  await until(async () => { try { await fetch(`http://127.0.0.1:${f.appPort}`); return false; } catch { return true; } }, Boolean, 2000);
});

test('Vite preview receives the selected application port rather than relying on an ignored PORT environment variable', async (t) => {
  const f = await fixture(t, { prepareRoot(root) {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'vite-fixture', scripts: { preview: 'vite preview' }, devDependencies: { vite: '*' } }));
    fs.mkdirSync(path.join(root, 'node_modules/.bin'), { recursive: true });
    fs.mkdirSync(path.join(root, 'node_modules/vite'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules/vite/cli.cjs'), 'const i=process.argv.indexOf("--port");if(i<0){console.error("Vite needs an explicit port; PORT is ignored");process.exit(9)}require("http").createServer((q,s)=>s.end("Vite preview fixture")).listen(Number(process.argv[i+1]),"127.0.0.1")');
    fs.writeFileSync(path.join(root, 'node_modules/.bin/vite.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0../vite/cli.cjs" %*\r\n`);
    fs.writeFileSync(path.join(root, 'node_modules/.bin/vite'), '#!/bin/sh\nexec node "$(dirname "$0")/../vite/cli.cjs" "$@"\n', { mode: 0o755 });
  } });
  await f.apply();
  const result = await until(() => f.request('/api/status'), (r) => ['ready', 'error'].includes(r.body.apply?.application?.state));
  assert.equal(result.body.apply.application.state, 'ready', result.body.apply.application.message);
  assert.equal(await (await fetch(`http://127.0.0.1:${f.appPort}`)).text(), 'Vite preview fixture');
});

test('HTTP failure times out without false readiness and retry uses the existing process after recovery', async (t) => {
  const f = await fixture(t, {
    appStartTimeoutMs: 5000,
    startAppInvocation: { command: process.execPath, args: ['-e', 'const fs=require("fs");fs.appendFileSync("starts","x");require("http").createServer((q,s)=>{s.statusCode=fs.existsSync("recovered")?200:503;s.end("service")}).listen(process.env.PORT,"127.0.0.1")'] },
  });
  await f.apply();
  await until(() => f.request('/api/status'), (r) => r.body.apply?.application?.state === 'error');
  assert.equal((await f.request('/api/app-health')).body.reachable, false);
  fs.writeFileSync(path.join(f.root, 'recovered'), 'ready');
  const retry = await f.request('/api/start-app', {});
  assert.equal(retry.body.reachable, true);
  assert.equal(fs.readFileSync(path.join(f.root, 'starts'), 'utf8'), 'x');
});

test('static startup can be retried after a conflicting HTTP port becomes free', async (t) => {
  const f = await fixture(t);
  const occupied = http.createServer((req, res) => { res.writeHead(503); res.end('different service'); });
  await new Promise((resolve) => occupied.listen(f.appPort, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => occupied.close(resolve)));
  await f.apply();
  await until(() => f.request('/api/status'), (r) => r.body.apply?.application?.state === 'error');
  await new Promise((resolve) => occupied.close(resolve));
  const retry = await f.request('/api/start-app', {});
  assert.equal(retry.body.reachable, true, retry.body.message);
  assert.equal(await (await fetch(`http://127.0.0.1:${f.appPort}`)).text(), '<h1>Installed application</h1>');
});

test('startup timeout includes HTTP sockets that accept connections but never send response headers', async (t) => {
  const f = await fixture(t, {
    appStartTimeoutMs: 300,
    startAppInvocation: { command: process.execPath, args: ['-e', 'require("http").createServer(()=>{}).listen(process.env.PORT,"127.0.0.1")'] },
  });
  const started = Date.now();
  await f.apply();
  await until(() => f.request('/api/status'), (r) => r.body.apply?.application?.state === 'error', 4000);
  assert.ok(Date.now() - started < 3000, 'stalled HTTP must respect the startup deadline, including initial probes');
});

function browser(health) {
  const elements = Object.fromEntries(['doneBox', 'nextSteps', 'goLogin', 'goApp', 'redirectNote', 'startApp', 'loginLink'].map((id) => [id, { classList: { add() {}, remove() {} }, disabled: false }]));
  const location = { href: '' };
  const html = renderSetupPage('csrf');
  const code = html.slice(html.indexOf('function finishApplySuccess('), html.indexOf('async function pollApplyProgress('));
  const context = vm.createContext({
    document: { getElementById: (id) => elements[id] }, location, EMBEDDED: false, API: '/api',
    wizard: { elements: { namedItem: () => ({ value: '5000' }) } }, result: {},
    escapeHtml: String, safeHref: String, window: { __SETUP__: { csrfToken: 'csrf' } },
    setTimeout: (fn, ms) => { if (ms < 1500) fn(); },
    fetchJson: async () => ({ ok: true, status: 200, data: health }),
  });
  vm.runInContext(code, context);
  return { context, elements, location };
}

test('final screen application button and direct login link never bypass readiness', async () => {
  const { context, elements, location } = browser({ reachable: false, application: { state: 'error', message: 'start failed' } });
  context.finishApplySuccess({ mode: 'localhost', loginUrl: 'http://127.0.0.1:5000', publicUrl: 'http://127.0.0.1:5000', application: { state: 'error' } });
  await elements.goApp.onclick();
  assert.equal(location.href, '');
  assert.equal(typeof elements.loginLink.onclick, 'function');
  let prevented = false;
  await elements.loginLink.onclick({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(location.href, '');
});

test('health watcher navigates to the verified frontend URL instead of an obsolete backend URL', async () => {
  const { context, elements, location } = browser({ reachable: true, loginUrl: 'http://127.0.0.1:5173/login' });
  await context.watchAppHealth('http://127.0.0.1:5000/login', elements.redirectNote, true);
  assert.equal(location.href, 'http://127.0.0.1:5173/login');
});

test('original terminal observes automatic application startup, masked output and cancellation of the entire tree', { timeout: 30000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-autostart-'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-autostart-data-'));
  const appPort = await port();
  const wizardPort = await port();
  fs.writeFileSync(path.join(root, 'index.html'), 'fixture');
  fs.writeFileSync(path.join(root, '.env.example'), 'SERVICE_SECRET=fixture-private-value\n');
  fs.writeFileSync(path.join(root, 'setup.config.json'), JSON.stringify({ install: { command: null }, start: { command: process.execPath, args: ['app.mjs'] } }));
  fs.writeFileSync(path.join(root, 'app.mjs'), 'import http from "node:http";console.log("terminal-app-started");const secret=process.env.SERVICE_SECRET;process.stdout.write("secret="+secret.slice(0,8));setTimeout(()=>{process.stdout.write(secret.slice(8)+"\\n");http.createServer((q,s)=>s.end("terminal supervised app")).listen(process.env.PORT,"127.0.0.1")},100);');
  const logs = [];
  let wizardUrl;
  const setup = createTerminalBootstrap({ root, dataDir, port: wizardPort, noOpen: true, log(text) {
    logs.push(text);
    const match = text.match(/http:\/\/127\.0\.0\.1:\d+\/setup\?token=[A-Za-z0-9_-]+/);
    if (match) wizardUrl = match[0];
  } });
  const running = setup.startWizard().then(() => null, (error) => error);
  t.after(async () => {
    setup.cancel();
    await running;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  await until(async () => wizardUrl, Boolean);
  const base = `http://127.0.0.1:${wizardPort}`;
  const auth = await fetch(wizardUrl, { redirect: 'manual' });
  const cookie = auth.headers.get('set-cookie').split(';')[0];
  const html = await (await fetch(`${base}/setup`, { headers: { Cookie: cookie } })).text();
  const csrf = JSON.parse(html.match(/window\.__SETUP__=(\{[^;]+\});/)[1]).csrfToken;
  const applied = await fetch(`${base}/api/apply`, {
    method: 'POST', headers: { Cookie: cookie, Origin: base, 'X-Setup-CSRF': csrf, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deployment: { mode: 'localhost', publicUrl: `http://127.0.0.1:${appPort}`, basePath: '/', allowedOrigins: [`http://127.0.0.1:${appPort}`], trustProxyHops: 0, retention: { enabled: false, actionLogDays: 180, readNotificationDays: 90, emailLogDays: 60, passwordResetDays: 30 } },
      server: { host: '127.0.0.1', port: appPort }, admin: { name: '', email: '', password: '' }, email: { enabled: false }, buildClient: false, overwriteExistingEnv: false,
    }),
  });
  assert.equal(applied.status, 202, await applied.text());
  await until(async () => setup.status().application, (state) => state.state === 'ready');
  assert.equal(await (await fetch(`http://127.0.0.1:${appPort}`)).text(), 'terminal supervised app');
  assert.ok(fs.existsSync(path.join(dataDir, 'installation.lock')));
  assert.match(logs.join(''), /terminal-app-started/);
  assert.doesNotMatch(logs.join(''), /fixture-private-value/);
  assert.doesNotMatch(logs.join(''), /fixture-|private-value/);
  assert.match(logs.join(''), /secret=\*{6}/);
  setup.cancel();
  assert.ok(await running instanceof Error);
  await until(async () => { try { await fetch(`http://127.0.0.1:${appPort}`); return false; } catch { return true; } }, Boolean);
});
