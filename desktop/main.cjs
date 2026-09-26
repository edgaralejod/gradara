// SPDX-License-Identifier: Apache-2.0
// Gradara desktop shell: starts the bundled local service on a private loopback
// port, shows the workbench, and stops the service when the app quits.
// No telemetry. The only network requests the shell itself makes are update
// checks against GitHub Releases (disable with GRADARA_DISABLE_UPDATES=1).
'use strict';

const { app, BrowserWindow, Menu, dialog, shell, session } = require('electron');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const DEV = !app.isPackaged;
const REPO = path.resolve(__dirname, '..');
const RESOURCES = DEV ? REPO : process.resourcesPath;
const PRIVACY_URL = 'https://gradara.app/privacy';
const ISSUES_URL = 'https://github.com/edgaralejod/gradara/issues';

let backend = null;
let port = 0;
let mainWindow = null;
let quitting = false;

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
  backend.on('exit', (code) => {
    fs.closeSync(log);
    backend = null;
    if (!quitting) {
      const choice = dialog.showMessageBoxSync({
        type: 'error',
        message: 'The Gradara service stopped unexpectedly.',
        detail: `Exit code ${code}. Your saved models are safe. The service log may explain what happened.`,
        buttons: ['Restart', 'Open logs', 'Quit'],
        defaultId: 0,
      });
      if (choice === 0) restart();
      else if (choice === 1) {
        void shell.openPath(logDir());
        app.quit();
      } else app.quit();
    }
  });
}

function stopBackend() {
  if (!backend || backend.exitCode !== null) return;
  const pid = backend.pid;
  if (process.platform === 'win32') {
    execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      backend.kill('SIGTERM');
    }
  }
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
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
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
  port = await freePort();
  startBackend();
  try {
    await waitForService();
    await window.loadURL(`http://127.0.0.1:${port}/`);
  } catch (error) {
    if (quitting) return;
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

function restart() {
  stopBackend();
  setTimeout(() => void launch(), 500);
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
        { type: 'separator' },
        { label: 'Privacy', click: () => void shell.openExternal(PRIVACY_URL) },
        { label: 'Report an Issue', click: () => void shell.openExternal(ISSUES_URL) },
        ...(isMac ? [] : [{ role: 'about' }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function checkForUpdates() {
  if (DEV || process.env.GRADARA_DISABLE_UPDATES === '1') return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  } catch {
    /* updater unavailable for this package format */
  }
}

void app.whenReady().then(() => {
  app.setAboutPanelOptions({
    applicationName: 'Gradara',
    applicationVersion: app.getVersion(),
    copyright: 'Copyright 2026 Edgar Duarte and the Gradara contributors. Apache-2.0.',
    website: 'https://gradara.app/',
  });
  // The workbench needs no camera, microphone, location, or notifications.
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  buildMenu();
  void launch();
  checkForUpdates();
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
  stopBackend();
});
