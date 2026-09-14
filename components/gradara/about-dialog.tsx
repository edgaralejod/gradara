// SPDX-License-Identifier: Apache-2.0
'use client';

import { Activity, ArrowUpRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export default function AboutDialog() {
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
        Gradara<span className="preview-tag">MODELING</span>
      </DialogTrigger>
      <DialogContent className="about-dialog">
        <DialogTitle>About Gradara</DialogTitle>
        <DialogDescription>
          A graphical workbench for multidomain simulation with OpenModelica.
        </DialogDescription>
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
            href="https://cursor.com/codebase/edgaralejod/gradara"
            target="_blank"
            rel="noreferrer"
          >
            Source on Cursor Origin <ArrowUpRight size={14} />
          </a>
          <small>Repository access requires Origin codebase permissions.</small>
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
