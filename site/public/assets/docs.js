// SPDX-License-Identifier: Apache-2.0
// Block reference: filter the library list and the index, and mark the section in view.
// No analytics, cookies, or third-party requests.

const norm = (s) => s.toLowerCase().trim();

// Index page: filter cards, hide empty categories.
const indexInput = document.querySelector('[data-filter="index"]');
if (indexInput) {
  const groups = [...document.querySelectorAll('.index-category')];
  const empty = document.querySelector('.index-empty');
  const chips = document.querySelector('.category-chips');
  const apply = () => {
    const q = norm(indexInput.value);
    let shown = 0;
    for (const group of groups) {
      let any = false;
      for (const li of group.querySelectorAll('li[data-name]')) {
        const hit = !q || q.split(/\s+/).every((w) => li.dataset.name.includes(w));
        li.hidden = !hit;
        if (hit) any = true, shown++;
      }
      group.hidden = !any;
    }
    if (empty) empty.hidden = shown > 0;
    if (chips) chips.hidden = Boolean(q);
  };
  indexInput.addEventListener('input', apply);
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement !== indexInput) {
      event.preventDefault();
      indexInput.focus();
    }
  });
  if (indexInput.value) apply();
}

// Block pages: filter the library sidebar.
const navInput = document.querySelector('[data-filter="nav"]');
if (navInput) {
  const groups = [...document.querySelectorAll('.docs-nav details')];
  const initial = new Map(groups.map((g) => [g, g.open]));
  const empty = document.querySelector('.docs-nav-empty');
  navInput.addEventListener('input', () => {
    const q = norm(navInput.value);
    let shown = 0;
    for (const group of groups) {
      let any = false;
      for (const li of group.querySelectorAll('li[data-name]')) {
        const hit = !q || q.split(/\s+/).every((w) => li.dataset.name.includes(w));
        li.hidden = !hit;
        if (hit) any = true, shown++;
      }
      group.hidden = !any;
      group.open = q ? any : initial.get(group);
    }
    if (empty) empty.hidden = shown > 0;
  });
  // Keep the current block in view in the sidebar.
  const current = document.querySelector('.docs-nav a[aria-current="page"]');
  const nav = document.querySelector('.docs-nav');
  if (current && nav && nav.scrollHeight > nav.clientHeight) {
    nav.scrollTop = current.offsetTop - nav.clientHeight / 3;
  }
}

// Block pages: highlight the section in view in "On this page".
const tocLinks = [...document.querySelectorAll('.docs-toc a')];
if (tocLinks.length && 'IntersectionObserver' in window) {
  const byId = new Map(tocLinks.map((a) => [a.hash.slice(1), a]));
  const visible = new Set();
  const mark = () => {
    const first = [...byId.keys()].find((id) => visible.has(id));
    if (!first) return;
    for (const [id, a] of byId) a.classList.toggle('is-active', id === first);
  };
  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const id = e.target.querySelector('h2')?.id;
        if (!id) continue;
        if (e.isIntersecting) visible.add(id);
        else visible.delete(id);
      }
      mark();
    },
    { rootMargin: '-80px 0px -55% 0px' },
  );
  for (const id of byId.keys()) {
    const section = document.getElementById(id)?.closest('section');
    if (section) observer.observe(section);
  }
}
