// SPDX-License-Identifier: Apache-2.0
'use client';

import { Activity, ArrowUpRight, Check, Copy } from 'lucide-react';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export default function AboutDialog({
  version,
  engine,
  engineReady,
}: {
  /** The installed version, from the service's health report. */
  version?: string;
  /** The simulation engine's label, such as "OpenModelica 1.27.1 (built in)". */
  engine?: string;
  engineReady?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  // What a bug report needs, without model content: Help → Copy Diagnostic Info
  // in the desktop menu adds the service log; this works in the browser too.
  const diagnostics = () =>
    [
      `Gradara ${version ?? 'unknown version'}`,
      `Engine: ${engine ?? 'unknown'} · ${engineReady ? 'ready' : 'not ready'}`,
      typeof navigator === 'undefined' ? '' : `${navigator.platform} · ${navigator.userAgent}`,
    ]
      .filter(Boolean)
      .join('\n');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(diagnostics());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* Clipboard access refused: the values are on screen to copy by hand. */
    }
  };
  return (
    <Dialog>
      <DialogTrigger
        className="brand about-trigger"
        aria-label="About Gradara"
        title="About Gradara"
      >
        <span className="brand-icon">
          <Activity size={23} />
        </span>
        Gradara
      </DialogTrigger>
      <DialogContent className="about-dialog">
        <DialogTitle>About Gradara</DialogTitle>
        <DialogDescription>
          A graphical workbench for multidomain simulation with OpenModelica.
        </DialogDescription>
        <dl className="about-versions">
          <dt>Version</dt>
          <dd>{version ?? '…'}</dd>
          <dt>Engine</dt>
          <dd>
            {engine ?? '…'}
            {engine ? (engineReady ? ' · ready' : ' · not ready') : ''}
          </dd>
          <dd className="about-copy">
            <button type="button" onClick={() => void copy()}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy diagnostics'}
            </button>
          </dd>
        </dl>
        <div className="about-creator">
          <span>Created by</span>
          <strong>Edgar Duarte</strong>
          <p>
            Engineering consulting in FPGA, embedded systems, connected
            products, and software through Virtu Services.
          </p>
          <a href="https://virtu-services.us" target="_blank" rel="noreferrer">
            Explore Virtu Services <ArrowUpRight size={15} />
          </a>
        </div>
        <div className="about-project-links">
          <a
            href="https://github.com/edgaralejod/gradara"
            target="_blank"
            rel="noreferrer"
          >
            Source on GitHub <ArrowUpRight size={14} />
          </a>
          <small>Explore the source, report an issue, or contribute.</small>
          <a
            href="https://www.apache.org/licenses/LICENSE-2.0"
            target="_blank"
            rel="noreferrer"
          >
            Apache License 2.0 <ArrowUpRight size={14} />
          </a>
          <small>
            Gradara&apos;s original code is Apache-2.0 licensed. OpenModelica
            and other dependencies retain their own licenses.
          </small>
        </div>
      </DialogContent>
    </Dialog>
  );
}
