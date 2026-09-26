// SPDX-License-Identifier: Apache-2.0
// Installed-app entry: the same workbench as app/page.tsx, built as static files
// that the local service serves. No server rendering or hosting runtime.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../app/globals.css';
import '../../app/engineering.css';
import '../../app/blocks.css';
import '../../app/inspector.css';
import '../../app/workbench-dialogs.css';
import Home from '../../app/page';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Home />
  </StrictMode>,
);
