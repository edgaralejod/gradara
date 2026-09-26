// SPDX-License-Identifier: Apache-2.0
// Mobile navigation and a download button that matches the visitor's OS.
// No analytics, cookies, or third-party requests.
const RELEASES = 'https://github.com/edgaralejod/gradara/releases/latest/download/';
const FILES = {
  windows: { file: 'Gradara-win-x64.exe', label: 'Download for Windows' },
  'mac-arm64': { file: 'Gradara-mac-arm64.dmg', label: 'Download for macOS' },
  'mac-x64': { file: 'Gradara-mac-x64.dmg', label: 'Download for macOS (Intel)' },
  linux: { file: 'Gradara-linux-x86_64.AppImage', label: 'Download for Linux' },
};

const toggle = document.querySelector('.nav-toggle');
const links = document.getElementById('site-navigation');
if (toggle && links) {
  toggle.addEventListener('click', () => {
    const open = links.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  links.addEventListener('click', (event) => {
    if (event.target.closest('a')) {
      links.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
}

async function detect() {
  const ua = navigator.userAgent;
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  if (/Win/i.test(platform) || /Windows/i.test(ua)) return 'windows';
  if (/Mac/i.test(platform) || /Macintosh/i.test(ua)) {
    try {
      const data = await navigator.userAgentData?.getHighEntropyValues(['architecture']);
      if (data?.architecture === 'x86') return 'mac-x64';
    } catch {
      /* Safari and Firefox do not expose the architecture; Apple silicon is the common case. */
    }
    return 'mac-arm64';
  }
  if (/Linux|X11/i.test(platform) && !/Android/i.test(ua)) return 'linux';
  return null;
}

void detect().then((os) => {
  if (!os) return;
  document.querySelectorAll('[data-download="primary"]').forEach((link) => {
    link.href = RELEASES + FILES[os].file;
    const label = link.querySelector('[data-label]');
    if (label) label.textContent = FILES[os].label;
  });
  const card = document.querySelector(`[data-platform="${os.startsWith('mac') ? 'mac' : os}"]`);
  if (card) card.classList.add('is-current');
});
