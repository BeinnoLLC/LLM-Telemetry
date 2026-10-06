// OpenRouter rankings window chooser (#113). Every view is rendered at build
// time (build_rankings.py), so this only toggles which one is visible.
const rkButtons = document.querySelectorAll('.vb[data-view]');
const rkViews = document.querySelectorAll('section.view[data-view]');
function rkShow(name) {
  rkViews.forEach(v => { v.hidden = v.dataset.view !== name; });
  rkButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === name)));
}
rkButtons.forEach(b => b.addEventListener('click', () => rkShow(b.dataset.view)));
