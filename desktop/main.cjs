// SPDX-License-Identifier: Apache-2.0
// Gradara desktop shell: starts the bundled local service on a private loopback
// port, shows the workbench, and stops the service when the app quits.
// No telemetry. The only network requests the shell itself makes are update
// checks against GitHub Releases (disable with GRADARA_DISABLE_UPDATES=1).
'use strict';

const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, shell, session } = require('electron');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const DEV = !app.isPackaged;
const REPO = path.resolve(__dirname, '..');
const RESOURCES = DEV ? REPO : process.resourcesPath;
const PRIVACY_URL = 'https://gradara.app/privacy';
const ISSUES_URL = 'https://github.com/edgaralejod/gradara/issues';
// Installer tests set this to a file path: the app checks itself once the
// workbench loads, writes a JSON report there, and quits (no dialogs).
const SELF_TEST_REPORT = process.env.GRADARA_SELF_TEST_REPORT || '';

let backend = null;
let port = 0;
let mainWindow = null;
let quitting = false;
// True once the workbench has loaded; startup failures are reported by launch().
let serviceReady = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function dataDir() {
  return path.join(app.getPath('userData'), 'data');
}

function logDir() {
  return path.join(app.getPath('userData'), 'logs');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port: chosen } = server.address();
      server.close(() => resolve(chosen));
    });
  });
}

function openLog() {
  fs.mkdirSync(logDir(), { recursive: true });
  const file = path.join(logDir(), 'service.log');
  try {
    if (fs.statSync(file).size > 5 * 1024 * 1024) fs.renameSync(file, `${file}.1`);
  } catch {
    /* first run */
  }
  return fs.openSync(file, 'a');
}

function backendCommand() {
  if (DEV) {
    const python = process.platform === 'win32'
      ? path.join(REPO, '.venv', 'Scripts', 'python.exe')
      : path.join(REPO, '.venv', 'bin', 'python');
    return { command: python, args: [path.join(REPO, 'packaging', 'backend_entry.py'), '--port', String(port)], cwd: REPO };
  }
  const exe = process.platform === 'win32' ? 'gradara-backend.exe' : 'gradara-backend';
  const dir = path.join(RESOURCES, 'backend');
  return { command: path.join(dir, exe), args: ['--port', String(port)], cwd: dir };
}

function startBackend() {
  const { command, args, cwd } = backendCommand();
  const log = openLog();
  const env = {
    ...process.env,
    GRADARA_DATA_DIR: dataDir(),
    GRADARA_LOG_DIR: logDir(),
    GRADARA_PORT: String(port),
    GRADARA_VERSION: app.getVersion(),
    GRADARA_STATIC_DIR: DEV ? path.join(REPO, 'dist-desktop', 'web') : path.join(RESOURCES, 'web'),
    GRADARA_RESOURCES: DEV ? REPO : path.join(RESOURCES, 'app-resources'),
    PYTHONUNBUFFERED: '1',
  };
  backend = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', log, log],
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  const child = backend;
  let ended = false;
  const onEnded = (detail) => {
    if (ended) return;
    ended = true;
    try {
      fs.closeSync(log);
    } catch {
      /* already closed */
    }
    if (backend === child) backend = null;
    if (quitting) return;
    if (SELF_TEST_REPORT) {
      void finishSelfTest({ ok: false, error: `The service stopped: ${detail}.` });
      return;
    }
    if (!serviceReady) return;
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      message: 'The Gradara service stopped unexpectedly.',
      detail: `${detail}. Your saved models are safe. The service log may explain what happened.`,
      buttons: ['Restart', 'Open logs', 'Quit'],
      defaultId: 0,
    });
    if (choice === 0) restart();
    else if (choice === 1) {
      void shell.openPath(logDir());
      app.quit();
    } else app.quit();
  };
  // 'error' fires instead of 'exit' when the service cannot be started at all
  // (missing file, blocked by security software, no execute permission).
  child.on('error', (error) => onEnded(`It could not be started (${error.code || error.message})`));
  child.on('exit', (code, signal) => onEnded(signal ? `Stopped by ${signal}` : `Exit code ${code}`));
}

function stopBackend() {
  if (!backend || backend.exitCode !== null) return Promise.resolve();
  const pid = backend.pid;
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
    });
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    backend.kill('SIGTERM');
  }
  return Promise.resolve();
}

function waitForService(timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get({ host: '127.0.0.1', port, path: '/api/ai', timeout: 2000 }, (response) => {
        response.resume();
        if (response.statusCode === 200) resolve();
        else retry();
      });
      request.on('error', retry);
      request.on('timeout', () => {
        request.destroy();
        retry();
      });
    };
    const retry = () => {
      if (!backend) reject(new Error('The service exited during startup.'));
      else if (Date.now() > deadline) reject(new Error('The service did not start in time.'));
      else setTimeout(attempt, 300);
    };
    attempt();
  });
}

const SPLASH = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%;display:grid;place-items:center;background:#f3f6f8;color:#304757;
font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}div{text-align:center}b{display:block;font-size:22px;
color:#1d3342;margin-bottom:6px}@media(prefers-color-scheme:dark){html,body{background:#161b21;color:#9fb0bf}b{color:#e8eef3}}</style>
</head><body><div><b>Gradara</b>Starting the local workspace…</div></body></html>`)}`;

function isLocal(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === '127.0.0.1' && Number(parsed.port) === port;
  } catch {
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Gradara',
    backgroundColor: '#f3f6f8',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // Exposes update status and two update actions to the workbench, nothing else.
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  if (SELF_TEST_REPORT) {
    mainWindow.webContents.on('console-message', (details) => {
      if (details.level === 'error') selfTest.consoleErrors.push(String(details.message).slice(0, 500));
    });
  }
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !isLocal(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isLocal(url) && !url.startsWith('data:')) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  return mainWindow;
}

async function launch() {
  const window = mainWindow || createWindow();
  window.loadURL(SPLASH);
  window.show();
  serviceReady = false;
  port = await freePort();
  startBackend();
  try {
    await waitForService();
    await window.loadURL(`http://127.0.0.1:${port}/`);
    serviceReady = true;
    if (SELF_TEST_REPORT) void runSelfTest(window);
  } catch (error) {
    if (quitting) return;
    if (SELF_TEST_REPORT) return void finishSelfTest({ ok: false, error: error.message });
    const choice = dialog.showMessageBoxSync(window, {
      type: 'error',
      message: 'Gradara could not start its local service.',
      detail: `${error.message} The service log in the logs folder has details.`,
      buttons: ['Open logs', 'Quit'],
    });
    if (choice === 0) void shell.openPath(logDir());
    app.quit();
  }
}

function serviceRequest(method, route, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: route,
      method,
      timeout: 30000,
      headers: {
        'X-Gradara-Client': 'self-test',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode !== 200) reject(new Error(`${method} ${route}: HTTP ${response.statusCode}`));
        else {
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(new Error(`${method} ${route}: not JSON`));
          }
        }
      });
    });
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error(`${method} ${route}: timed out`)));
    if (payload) request.write(payload);
    request.end();
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const selfTest = { consoleErrors: [], finished: false };

async function runSelfTest(window) {
  const checks = {};
  try {
    const ai = await serviceRequest('GET', '/api/ai');
    checks.aiProvider = ai.provider ?? null;
    const engine = await serviceRequest('GET', '/api/engine');
    checks.engine = engine.backend ?? null;
    const created = await serviceRequest('POST', '/api/models', { name: 'Installer self-test', template: 'dc' });
    checks.modelBlocks = created.project?.blocks?.length ?? 0;
    if (!checks.modelBlocks) throw new Error('Creating a model from the DC template returned no blocks.');
    const deadline = Date.now() + 60000;
    let rendered = false;
    while (!rendered && Date.now() < deadline) {
      rendered = await window.webContents.executeJavaScript(
        "(() => { const root = document.getElementById('root'); return !!root && root.childElementCount > 0 && document.body.innerText.trim().length > 40; })()",
      );
      if (!rendered) await sleep(500);
    }
    checks.workbenchRendered = rendered;
    if (!rendered) throw new Error('The workbench did not render within 60 seconds.');
    // The preload bridge must reach the page; self-test builds report updates as disabled.
    checks.updateBridge = await window.webContents.executeJavaScript(
      "(async () => { const u = window.gradaraDesktop && window.gradaraDesktop.updates; if (!u) return 'missing'; const s = await u.getState(); return s ? s.status : 'no state'; })()",
    );
    if (checks.updateBridge !== 'disabled') {
      throw new Error(`The update bridge is not working (got ${checks.updateBridge}).`);
    }
    await finishSelfTest({ ok: true, checks });
  } catch (error) {
    await finishSelfTest({ ok: false, checks, error: error.message });
  }
}

async function finishSelfTest(result) {
  if (selfTest.finished) return;
  selfTest.finished = true;
  const report = {
    ...result,
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    executable: process.execPath,
    resources: RESOURCES,
    userData: app.getPath('userData'),
    backendPid: backend?.pid ?? null,
    consoleErrors: selfTest.consoleErrors.slice(0, 20),
  };
  quitting = true;
  await stopBackend();
  try {
    fs.writeFileSync(SELF_TEST_REPORT, JSON.stringify(report, null, 2));
  } catch (error) {
    process.stderr.write(`Could not write the self-test report: ${error.message}\n`);
  }
  app.exit(report.ok ? 0 : 1);
}

function restart() {
  void stopBackend();
  setTimeout(() => void launch(), 500);
}

/**
 * Help → Copy Diagnostic Info: what a useful bug report needs (versions, OS, engine
 * status, the end of the service log), with the home folder replaced by "~". No
 * model content is included; the user pastes it where they choose.
 */
async function copyDiagnostics() {
  const lines = [
    `Gradara ${app.getVersion()} (Electron ${process.versions.electron})`,
    `${os.type()} ${os.release()} ${process.arch}`,
  ];
  try {
    const engine = await serviceRequest('GET', '/api/engine');
    lines.push(`Engine: ${engine.backend ?? 'unknown'} (${engine.preference ?? 'auto'}) · ${engine.ready ? 'ready' : 'not ready'} · ${engine.label ?? ''}`);
  } catch (error) {
    lines.push(`Engine: status unavailable (${error.message})`);
  }
  try {
    const log = fs.readFileSync(path.join(logDir(), 'service.log'), 'utf8').split(/\r?\n/).slice(-60);
    lines.push('', 'Last lines of service.log:', ...log);
  } catch {
    lines.push('', 'No service log yet.');
  }
  const text = lines.join('\n').split(os.homedir()).join('~');
  clipboard.writeText(text);
  const { response } = await dialog.showMessageBox({
    type: 'info',
    buttons: ['Report an Issue', 'Close'],
    defaultId: 0,
    cancelId: 1,
    message: 'Diagnostic info copied',
    detail: 'Versions, engine status, and the end of the service log are on the clipboard. Paste them into your bug report. They contain no model content.',
  });
  if (response === 0) void shell.openExternal(ISSUES_URL);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        // Panel widths and the dock live in the workbench; it listens for this event.
        {
          label: 'Reset Layout',
          click: () =>
            void mainWindow?.webContents.executeJavaScript(
              "window.dispatchEvent(new Event('gradara:reset-layout'))",
            ),
        },
        { role: 'togglefullscreen' },
        ...(DEV ? [{ role: 'toggleDevTools' }] : []),
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Open Data Folder', click: () => void shell.openPath(dataDir()) },
        { label: 'Open Logs Folder', click: () => void shell.openPath(logDir()) },
        { label: 'Restart Local Service', click: () => restart() },
        ...(UPDATES_ENABLED ? [{ label: 'Check for Updates', click: () => void checkNow() }] : []),
        { type: 'separator' },
        { label: 'Privacy', click: () => void shell.openExternal(PRIVACY_URL) },
        { label: 'Report an Issue', click: () => void shell.openExternal(ISSUES_URL) },
        { label: 'Copy Diagnostic Info', click: () => void copyDiagnostics() },
        { label: 'Third-Party Licenses', click: () => void shell.openPath(path.join(RESOURCES, DEV ? 'THIRD_PARTY_NOTICES.md' : path.join('legal', 'THIRD_PARTY_LICENSES.txt'))) },
        ...(isMac ? [] : [{ role: 'about' }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ------------------------------------------------------------------ updates
// Like the Claude and ChatGPT desktop apps: check at launch and every few hours,
// download in the background, show "Restart to update" in the workbench, and
// install on restart or on the next quit. The .deb package cannot replace itself
// without a password prompt, so it only reports that a new version exists.
const UPDATES_ENABLED = !DEV && !SELF_TEST_REPORT && process.env.GRADARA_DISABLE_UPDATES !== '1';
const MANUAL_UPDATES = process.platform === 'linux' && !process.env.APPIMAGE;
const DOWNLOAD_PAGE = 'https://gradara.app/#download';
const updateState = {
  status: UPDATES_ENABLED ? 'idle' : 'disabled',
  currentVersion: app.getVersion(),
  version: null,
  percent: 0,
  checkedAt: null,
  error: '',
};
let updater = null;

function publishUpdate(patch) {
  Object.assign(updateState, patch);
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('gradara:update', { ...updateState });
  }
}

function checkNow() {
  if (!updater || updateState.status === 'downloading' || updateState.status === 'ready') return Promise.resolve();
  return updater.checkForUpdates().then(
    () => undefined,
    (error) => publishUpdate({ status: 'error', error: String(error?.message || error).slice(0, 200) }),
  );
}

function setUpUpdates() {
  if (!UPDATES_ENABLED) return;
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
  } catch {
    publishUpdate({ status: 'disabled' });
    return;
  }
  updater.autoDownload = !MANUAL_UPDATES;
  updater.autoInstallOnAppQuit = true;
  updater.on('checking-for-update', () => publishUpdate({ status: 'checking', error: '' }));
  updater.on('update-not-available', () => publishUpdate({ status: 'current', checkedAt: Date.now() }));
  updater.on('update-available', (info) =>
    publishUpdate({ status: MANUAL_UPDATES ? 'manual' : 'downloading', version: info.version, percent: 0, checkedAt: Date.now() }),
  );
  updater.on('download-progress', (progress) => publishUpdate({ status: 'downloading', percent: progress.percent }));
  updater.on('update-downloaded', (info) => publishUpdate({ status: 'ready', version: info.version, percent: 100 }));
  updater.on('error', (error) => publishUpdate({ status: 'error', error: String(error?.message || error).slice(0, 200) }));
  setTimeout(() => void checkNow(), 10000).unref();
  setInterval(() => void checkNow(), 4 * 60 * 60 * 1000).unref();
}

// Only the workbench served by our own service may call these.
const trusted = (event) => isLocal(event.senderFrame?.url || '');
ipcMain.handle('gradara:update:state', (event) => (trusted(event) ? { ...updateState } : null));
ipcMain.handle('gradara:update:check', async (event) => {
  if (!trusted(event)) return null;
  await checkNow();
  return { ...updateState };
});
ipcMain.handle('gradara:update:install', async (event) => {
  if (!trusted(event)) return false;
  if (updateState.status === 'manual') {
    void shell.openExternal(DOWNLOAD_PAGE);
    return true;
  }
  if (updateState.status !== 'ready' || !updater) return false;
  quitting = true;
  await stopBackend();
  setImmediate(() => updater.quitAndInstall(false, true));
  return true;
});

void app.whenReady().then(() => {
  app.setAboutPanelOptions({
    applicationName: 'Gradara',
    applicationVersion: app.getVersion(),
    copyright: 'Copyright 2026 Edgar Duarte and the Gradara contributors. Apache-2.0. Published by Virtu Services LLC.',
    credits: 'Simulation by OpenModelica and the Modelica Standard Library. Gradara and its results are not certified for safety-critical use; verify results independently.',
    website: 'https://gradara.app/',
  });
  // The workbench needs no camera, microphone, location, or notifications.
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  buildMenu();
  if (SELF_TEST_REPORT) {
    // Watchdog: a hung start still produces a report instead of a stuck CI job.
    setTimeout(() => void finishSelfTest({ ok: false, error: 'Self-test timed out after 240 seconds.' }), 240000).unref();
  }
  void launch();
  setUpUpdates();
  app.on('activate', () => {
    if (!mainWindow && backend) {
      void createWindow().loadURL(`http://127.0.0.1:${port}/`);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  void stopBackend();
});
