(() => {
  const BTN_ID = 'ytlb-loop-button';

  // Modes: 'off' -> 'video' -> 'playlist' (only offered when a playlist/queue is open) -> 'off'
  // Persists across videos in this tab.
  let mode = 'off';
  let jumping = false; // guards against double-triggering the wrap-around

  const ICONS = {
    off: loopIcon(''),
    video: loopIcon('<text x="12" y="15.2" text-anchor="middle" font-size="8" font-weight="700" font-family="Roboto, Arial, sans-serif">1</text>'),
    playlist: loopIcon('<rect x="9" y="9.6" width="6" height="1.4" rx=".5"/><rect x="9" y="11.8" width="6" height="1.4" rx=".5"/><rect x="9" y="14" width="4" height="1.4" rx=".5"/>'),
  };
  function loopIcon(inner) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>${inner}</svg>`;
  }
  const LABELS = {
    off: 'Loop: off',
    video: 'Loop: this video',
    playlist: 'Loop: playlist',
  };

  // ---------- page helpers ----------
  const getPlayer = () => document.querySelector('#movie_player');
  const getVideo = () => document.querySelector('#movie_player video.html5-main-video');
  const isAdShowing = () => !!getPlayer()?.classList.contains('ad-showing');
  const listId = () => new URLSearchParams(location.search).get('list');
  const hasPlaylist = () => !!listId();

  // YouTube can render more than one playlist panel (e.g. watch page + miniplayer).
  // Use the one that has a selected (currently playing) item.
  function getPanelInfo() {
    for (const panel of document.querySelectorAll('ytd-playlist-panel-renderer')) {
      const items = [...panel.querySelectorAll('ytd-playlist-panel-video-renderer')];
      const current = items.findIndex((el) => el.hasAttribute('selected'));
      if (current === -1) continue;

      // Header shows e.g. "9 / 20" — more reliable than the item count for long, lazily-loaded lists.
      let pos = null, total = null;
      const counter = panel.querySelector('#publisher-container, .index-message-wrapper, .index-message');
      const m = counter?.textContent.match(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/);
      if (m) {
        pos = parseInt(m[1].replace(/,/g, ''), 10);
        total = parseInt(m[2].replace(/,/g, ''), 10);
      }
      return { panel, items, current, pos, total };
    }
    return null;
  }

  function isLastInPlaylist() {
    const info = getPanelInfo();
    if (info) {
      if (info.pos && info.total) return info.pos >= info.total;
      return info.current === info.items.length - 1;
    }
    // Panel not found: fall back to the URL's index vs nothing we can compare — assume not last.
    return false;
  }

  function jumpToPlaylistStart() {
    if (jumping) return;
    jumping = true;
    setTimeout(() => (jumping = false), 4000);

    const info = getPanelInfo();
    const first = info?.items[0]?.querySelector('a#wc-endpoint, a[href*="/watch"]');
    const href = first?.getAttribute('href') || '';
    const firstIdx = new URLSearchParams(href.split('?')[1] || '').get('index');
    if (first && (firstIdx === '1' || firstIdx === null || (info.pos && info.current + 1 === info.pos))) {
      first.click(); // in-app navigation, keeps the playlist panel
      return;
    }
    // Fallback: full navigation to the start of the list.
    location.assign(`/watch?list=${encodeURIComponent(listId())}&index=1`);
  }

  // ---------- state sync ----------
  function effectiveMode() {
    if (mode === 'playlist' && !hasPlaylist()) return 'off';
    return mode;
  }

  function applyState() {
    const video = getVideo();
    if (video) video.loop = effectiveMode() === 'video' && !isAdShowing();

    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    const m = effectiveMode();
    if (btn.dataset.mode !== m) {
      btn.dataset.mode = m;
      btn.innerHTML = ICONS[m];
    }
    btn.classList.toggle('ytlb-active', m !== 'off');
    const label = `${LABELS[m]} (r)`;
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }

  function cycleMode() {
    const order = hasPlaylist() ? ['off', 'video', 'playlist'] : ['off', 'video'];
    const cur = order.indexOf(effectiveMode());
    mode = order[(cur + 1) % order.length];
    applyState();
  }

  function injectButton() {
    if (document.getElementById(BTN_ID)) return;
    const controls = document.querySelector('#movie_player .ytp-right-controls');
    if (!controls) return;
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.className = 'ytp-button ytlb-button';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      cycleMode();
    });
    controls.prepend(btn);
    applyState();
  }

  // ---------- playlist wrap-around ----------
  // Jump just before the last video finishes, so YouTube never gets the chance to
  // autoplay a recommendation or stop at the end of the list.
  function shouldWrap(video) {
    return effectiveMode() === 'playlist' && !isAdShowing() && !jumping &&
      video.duration && isFinite(video.duration) && isLastInPlaylist();
  }
  document.addEventListener('timeupdate', (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement) || !shouldWrap(v)) return;
    if (v.duration - v.currentTime < 0.4) jumpToPlaylistStart();
  }, true);
  // Backup in case timeupdate missed the window: intercept 'ended' before YouTube sees it.
  window.addEventListener('ended', (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement) || !shouldWrap(v)) return;
    e.stopImmediatePropagation();
    jumpToPlaylistStart();
  }, true);

  // ---------- keyboard: "r" cycles ----------
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'r' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (!location.pathname.startsWith('/watch')) return;
    cycleMode();
  }, true);

  // ---------- keep in sync with YouTube's SPA ----------
  ['loadedmetadata', 'playing', 'play'].forEach((evt) =>
    document.addEventListener(evt, (e) => {
      if (e.target instanceof HTMLVideoElement) applyState();
    }, true)
  );
  window.addEventListener('yt-navigate-finish', () => { injectButton(); applyState(); });
  new MutationObserver(() => {
    injectButton();
    const v = getVideo();
    if (v && v.loop !== (effectiveMode() === 'video' && !isAdShowing())) applyState();
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

  injectButton();
})();
