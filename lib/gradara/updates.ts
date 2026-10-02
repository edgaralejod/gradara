// SPDX-License-Identifier: Apache-2.0
// In-app updates. The desktop shell (desktop/main.cjs) runs electron-updater and
// publishes its state through the preload bridge (desktop/preload.cjs); the
// workbench shows it. Source checkouts and the browser have no bridge.
import { useEffect, useState } from 'react';

export type UpdateStatus =
  | 'disabled' // development build, self-test, or GRADARA_DISABLE_UPDATES=1
  | 'idle' // nothing checked yet
  | 'checking'
  | 'current' // the installed version is the latest
  | 'downloading'
  | 'ready' // downloaded; installs on restart or next quit
  | 'manual' // a newer version exists but this package type updates by reinstalling
  | 'error';

export type UpdateState = {
  status: UpdateStatus;
  currentVersion: string;
  version: string | null; // the newer version, when known
  percent: number; // download progress, 0 to 100
  checkedAt: number | null; // epoch ms of the last completed check
  error: string;
};

export type UpdateBridge = {
  getState(): Promise<UpdateState>;
  check(): Promise<UpdateState>;
  install(): Promise<boolean>;
  onChange(listener: (state: UpdateState) => void): () => void;
};

declare global {
  interface Window {
    gradaraDesktop?: { updates?: UpdateBridge };
  }
}

export function updateBridge(): UpdateBridge | null {
  if (typeof window === 'undefined') return null;
  return window.gradaraDesktop?.updates ?? null;
}

export type UpdateSummary = {
  /** Short text for Settings. */
  detail: string;
  /** Header indicator: hidden unless an update needs attention or is in flight. */
  indicator: null | { label: string; action: 'install' | 'download' | null };
  /** Whether "Check for updates" makes sense now. */
  canCheck: boolean;
};

export function describeUpdate(state: UpdateState | null): UpdateSummary {
  if (!state) {
    return {
      detail: 'Updates apply to the desktop app. A source checkout updates with git pull.',
      indicator: null,
      canCheck: false,
    };
  }
  const next = state.version ? `Gradara ${state.version}` : 'A new version';
  // Never show more than 100%, whatever the shell reports.
  const shown = Math.round(Math.min(100, Math.max(0, state.percent)));
  switch (state.status) {
    case 'disabled':
      return { detail: 'Automatic updates are turned off for this build.', indicator: null, canCheck: false };
    case 'checking':
      return { detail: 'Checking for updates…', indicator: null, canCheck: false };
    case 'current':
      return { detail: 'Gradara is up to date.', indicator: null, canCheck: true };
    case 'downloading':
      return {
        detail: `Downloading ${next} (${shown}%). You can keep working.`,
        indicator: { label: `Updating ${shown}%`, action: null },
        canCheck: false,
      };
    case 'ready':
      return {
        detail: `${next} is ready. It installs when you restart or next quit.`,
        indicator: { label: 'Restart to update', action: 'install' },
        canCheck: false,
      };
    case 'manual':
      return {
        detail: `${next} is available. Download it from gradara.app to update this package.`,
        indicator: { label: 'Update available', action: 'download' },
        canCheck: true,
      };
    case 'error':
      return {
        detail: `The last update check failed: ${state.error || 'unknown error'}. Gradara retries automatically.`,
        indicator: null,
        canCheck: true,
      };
    default:
      return { detail: 'Gradara checks for updates in the background.', indicator: null, canCheck: true };
  }
}

/** Live update state from the desktop shell, or null outside the desktop app. */
export function useDesktopUpdates(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    const bridge = updateBridge();
    if (!bridge) return;
    let live = true;
    void bridge.getState().then((s) => live && setState(s)).catch(() => {});
    const stop = bridge.onChange((s) => live && setState(s));
    return () => {
      live = false;
      stop();
    };
  }, []);
  return state;
}
