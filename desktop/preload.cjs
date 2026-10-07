// SPDX-License-Identifier: Apache-2.0
// The only bridge between the workbench page and the desktop shell. It exposes
// update status and actions, and personal-feature (layer) status and actions;
// nothing else from Node or Electron reaches the page. The shell checks every
// layer's signature itself, so the page can ask for an install but cannot skip the check.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gradaraDesktop', {
  updates: {
    getState: () => ipcRenderer.invoke('gradara:update:state'),
    check: () => ipcRenderer.invoke('gradara:update:check'),
    install: () => ipcRenderer.invoke('gradara:update:install'),
    onChange: (listener) => {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on('gradara:update', handler);
      return () => ipcRenderer.removeListener('gradara:update', handler);
    },
  },
  layers: {
    getState: () => ipcRenderer.invoke('gradara:layers:state'),
    install: (request) => ipcRenderer.invoke('gradara:layers:install', request),
    switchOn: (on) => ipcRenderer.invoke('gradara:layers:switch', !!on),
    remove: () => ipcRenderer.invoke('gradara:layers:remove'),
    trust: (request) => ipcRenderer.invoke('gradara:layers:trust', request),
    restart: () => ipcRenderer.invoke('gradara:layers:restart'),
  },
});
