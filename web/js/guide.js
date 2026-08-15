const $ = (id) => document.getElementById(id);

/**
 * Set once the guide has been closed by hand. Its ABSENCE is what opens the
 * guide on the very first launch — so the key must never be written anywhere
 * else, otherwise the first-run page would be skipped.
 */
const SEEN_KEY = 'gup_rehber_seen';

/**
 * The visibility of the guide is NOT owned by `hidden` alone: the header and
 * the project screen are hidden by the `#content.guide-open` CSS rules. The
 * renderers (`renderProjects`, `renderEditor`) keep writing their own `hidden`
 * flags on every `update()`; were the guide to hide them in JS, the next status
 * event would bring the panel right back underneath it.
 */
function setOpen(open) {
  $('guideScreen').hidden = !open;
  $('content').classList.toggle('guide-open', open);
  if (open) window.scrollTo(0, 0);
}

/**
 * localStorage throws instead of returning null in a few settings (Safari's
 * private mode, third-party-cookie blocking in an iframe). Reading a failure
 * counts as "not seen yet" — the guide opens, which is the harmless direction;
 * a failed write only means it opens again next time.
 */
function seenBefore() {
  try {
    return localStorage.getItem(SEEN_KEY) !== null;
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // no persistent storage: the guide comes back on the next launch
  }
}

export function bindGuide() {
  $('btnGuide').addEventListener('click', () => setOpen(true));

  // Both the top and the bottom button close it — the page is long enough that
  // scrolling back up to a single button would be a chore.
  for (const button of document.querySelectorAll('.guide-close')) {
    button.addEventListener('click', () => {
      markSeen();
      setOpen(false);
    });
  }

  if (!seenBefore()) setOpen(true);
}
