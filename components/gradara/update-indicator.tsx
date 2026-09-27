'use client';
// SPDX-License-Identifier: Apache-2.0
// Header indicator for in-app updates: hidden until an update is downloading or ready.
import { Download, LoaderCircle, RotateCw } from 'lucide-react';
import { describeUpdate, updateBridge, useDesktopUpdates } from '@/lib/gradara/updates';

export default function UpdateIndicator({ onOpenSettings }: { onOpenSettings: () => void }) {
  const state = useDesktopUpdates();
  const indicator = describeUpdate(state).indicator;
  if (!state || !indicator) return null;
  const next = state.version ? `Gradara ${state.version}` : 'a new version';
  if (indicator.action === 'install') {
    return (
      <button
        type="button"
        className="update-indicator is-ready"
        title={`${next} is downloaded. Restart to install it; your models are saved.`}
        onClick={() => void updateBridge()?.install()}
      >
        <RotateCw size={14} />
        {indicator.label}
      </button>
    );
  }
  if (indicator.action === 'download') {
    return (
      <button
        type="button"
        className="update-indicator is-ready"
        title={`${next} is available on gradara.app`}
        onClick={() => void updateBridge()?.install()}
      >
        <Download size={14} />
        {indicator.label}
      </button>
    );
  }
  return (
    <button
      type="button"
      className="update-indicator"
      title={`Downloading ${next} in the background`}
      onClick={onOpenSettings}
    >
      <LoaderCircle className="spin" size={14} />
      {indicator.label}
    </button>
  );
}
