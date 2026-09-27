// SPDX-License-Identifier: Apache-2.0
// The only bridge between the workbench page and the desktop shell. It exposes
// update status and two actions; nothing else from Node or Electron reaches the page.
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
});
