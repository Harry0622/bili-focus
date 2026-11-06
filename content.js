(() => {
  if (globalThis.__biliFocusLoaded) return;
  globalThis.__biliFocusLoaded = true;
  function playbackRoute() { const u = new URL(location.href); return `${u.origin}${u.pathname.replace(/\/$/, '')}?p=${u.searchParams.get('p') || 1}`; }
  let state, current = null, timer, playerAbort, lastSample, route = playbackRoute(), destroyed = false;
  let observer, checkScheduled = false, initialDocument = true, mediaReadyRoute = '', mediaReadyVideo;
  const host = document.createElement('div');
  host.id = 'bili-focus-entry';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    :host{position:fixed;right:24px;bottom:84px;z-index:2147483600;font:13px/1.5 system-ui,sans-serif;color:#1c1c1e;--bf-bg:#ffffff;--bf-base:#f2f2f7;--bf-raised:#e5e5ea;--bf-border:#00000017}
    .box{display:flex;gap:5px;padding:5px;border:1px solid var(--bf-border);border-radius:12px;background:var(--bf-bg)}
    button{font:inherit;border:1px solid transparent;border-radius:8px;padding:9px 12px;cursor:pointer;background:transparent;color:inherit;transition:background-color 200ms ease-out}button:hover{background:var(--bf-raised)}button:focus-visible{outline:1px solid #0a84ff}
    button:disabled{opacity:.6;cursor:default}.primary{background:var(--bf-raised);border-color:var(--bf-border)}.primary:hover{background:var(--bf-base)}
    .panel{margin-bottom:8px;padding:14px;border:1px solid var(--bf-border);border-radius:12px;background:var(--bf-bg);width:250px}.panel[hidden]{display:none}
    label{display:block;margin-bottom:7px;font:600 13px Georgia,SimSun,serif}input{box-sizing:border-box;width:100%;font:inherit;padding:8px;border-radius:7px;border:1px solid var(--bf-border);background:var(--bf-base);color:inherit}.actions{display:flex;justify-content:flex-end;gap:4px;margin-top:8px}.status{max-width:280px;max-height:90px;overflow:auto;background:var(--bf-bg);border-radius:8px;padding:4px 9px;margin-bottom:4px}.status:empty{display:none}
    :host([data-theme=dark]){color:#f2f2f7;--bf-bg:#2c2c2e;--bf-base:#1c1c1e;--bf-raised:#3a3a3c;--bf-border:#ffffff17}
    @media(prefers-color-scheme:dark){:host(:not([data-theme=light])){color:#f2f2f7;--bf-bg:#2c2c2e;--bf-base:#1c1c1e;--bf-raised:#3a3a3c;--bf-border:#ffffff17}}
    @media(prefers-reduced-motion:reduce){button{transition:none}}
    </style><div class="status" role="status" aria-live="polite"></div><form class="panel" hidden><label for="bf-note">记录当前时间 · <span></span></label><input id="bf-note" maxlength="300" placeholder="写一句备注（可选）"><div class="actions"><button type="button" id="cancel">取消</button><button class="primary" type="submit">保存书签</button></div></form><div class="box"><button class="primary" id="add">＋ 重点关注</button><button id="all" title="添加该视频全部分P">全部P</button><button id="mark" hidden>＋ 书签</button></div>`;
  const $ = s => root.querySelector(s);
  const status = text => { $('.status').textContent = text; };
  async function send(type, payload = {}) {
    try { const response = await chrome.runtime.sendMessage({ type, ...payload }); if (!response?.ok) throw new Error(response?.error || '扩展未响应'); return response.result; }
    catch (e) { status(e.message || '扩展已更新，请刷新页面'); throw e; }
  }
  function identity() {
    try {
      const u = new URL(location.href), match = u.pathname.match(/^\/video\/(BV[\da-zA-Z]{10}|av\d+)\/?$/i);
      if (!match) return null;
      const page = Number(u.searchParams.get('p') || 1);
      return Object.entries(state?.videos || {}).find(([, v]) => v.page === page && (v.bvid.toLowerCase() === match[1].toLowerCase() || `av${v.aid}` === match[1].toLowerCase()));
    } catch { return null; }
  }
  function capture(ended = false) {
    // No code path can read currentTime until a stored bvid:cid is active.
    if (!current || !current.ready || playbackRoute() !== route || !current.video.isConnected) return;
    const sec = current.video.currentTime;
    if (!Number.isFinite(sec)) return;
    lastSample = { key: current.key, sample: { sec, at: Date.now(), ended } };
    void send('PROGRESS', lastSample).catch(() => {});
  }
  function stop(flushCached = false) {
    clearInterval(timer); timer = undefined;
    if (flushCached && lastSample) void send('PROGRESS', lastSample).catch(() => {});
    playerAbort?.abort(); playerAbort = undefined; current = null; lastSample = undefined;
  }
  function bind() {
    if (destroyed) return;
    const entry = identity();
    const changedRoute = route !== playbackRoute();
    if (changedRoute) {
      if (current?.key !== entry?.[0]) { stop(true); initialDocument = false; $('form').hidden = true; }
      route = playbackRoute(); status('');
    }
    host.setAttribute('aria-label', entry ? `重点关注 · P${entry[1].page}` : '添加当前视频到重点关注');
    $('#add').textContent = entry ? '✓ 已重点关注' : '＋ 重点关注';
    $('#add').disabled = !!entry;
    $('#mark').hidden = !entry;
    $('#all').hidden = !!entry && entry[1].totalPages === 1;
    if (!entry) { stop(); return; }
    const video = document.querySelector('video');
    if (current?.key === entry[0] && current.video === video && current.interval === state.settings.sampleIntervalSec) return;
    if (current && !changedRoute) capture();
    stop();
    if (!video) return;
    current = { key: entry[0], video, interval: state.settings.sampleIntervalSec, ready: video.readyState >= 1 && (initialDocument || (mediaReadyRoute === route && mediaReadyVideo === video)) };
    playerAbort = new AbortController();
    const options = { signal: playerAbort.signal };
    for (const event of ['pause', 'seeked', 'playing']) video.addEventListener(event, () => capture(), options);
    video.addEventListener('ended', () => capture(true), options);
    timer = setInterval(() => { if (!video.paused && !video.ended) capture(); }, state.settings.sampleIntervalSec * 1000);
    capture();
  }
  function scheduleCheck() {
    if (checkScheduled || destroyed) return;
    checkScheduled = true;
    setTimeout(() => { checkScheduled = false; bind(); }, 120);
  }
  async function add(entire) {
    $('#add').disabled = true; $('#all').disabled = true;
    try { const r = await send('ADD', { url: location.href, entire }); status(r.message); }
    catch { /* Error shown by send. */ }
    finally { $('#add').disabled = !!identity(); $('#all').disabled = false; }
  }
  $('#add').addEventListener('click', () => add(state?.settings.addEntireCollectionDefault === true));
  $('#all').addEventListener('click', () => add(true));
  let bookmarkSample;
  $('#mark').addEventListener('click', () => {
    if (!current?.ready || playbackRoute() !== route) { status('播放器正在切换，请稍后记录书签'); return; }
    bookmarkSample = { key: current.key, sec: current.video.currentTime };
    const n = Math.floor(bookmarkSample.sec); $('form span').textContent = `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
    $('form').hidden = false; $('input').value = ''; $('input').focus();
  });
  $('#cancel').addEventListener('click', () => { $('form').hidden = true; });
  $('form').addEventListener('submit', async e => {
    e.preventDefault();
    const button = $('form button[type=submit]'); button.disabled = true;
    try { await send('BOOKMARK_ADD', { ...bookmarkSample, note: $('input').value }); $('form').hidden = true; status('书签已保存'); }
    catch { /* Keep note for retry. */ } finally { button.disabled = false; }
  });
  function theme() { host.setAttribute('data-theme', state?.settings?.theme || 'system'); }
  function onStorage(changes, area) { if (area === 'local' && changes.focusState) { state = changes.focusState.newValue; theme(); bind(); } }
  function visibility() { if (document.hidden) capture(); }
  function pagehide(e) { capture(); stop(true); observer?.disconnect(); if (!e.persisted) { destroyed = true; chrome.storage.onChanged.removeListener(onStorage); } }
  function pageshow(e) { if (e.persisted) { observer.observe(document.body, { childList: true, subtree: true }); bind(); } }
  chrome.storage.onChanged.addListener(onStorage);
  chrome.runtime.onMessage.addListener((m, _sender, respond) => {
    if (m.type !== 'CURRENT_BOOKMARK') return;
    if (!current?.ready || playbackRoute() !== route || current.key !== m.key) { respond({ ok: false, error: '请在对应分P的播放页记录当前时间，播放器切换时请稍等' }); return; }
    respond({ ok: true, sec: current.video.currentTime, key: current.key });
  });
  document.addEventListener('visibilitychange', visibility);
  // Metadata events identify the media boundary during SPA P switches. Until
  // this boundary the old player's time must never be attributed to the new P.
  document.addEventListener('loadedmetadata', e => {
    if (!(e.target instanceof HTMLVideoElement)) return;
    mediaReadyRoute = playbackRoute(); mediaReadyVideo = e.target;
    if (route !== playbackRoute()) bind();
    if (current?.video === e.target) { current.ready = true; capture(); }
  }, true);
  document.addEventListener('loadstart', e => {
    if (current?.video === e.target) current.ready = false;
  }, true);
  window.addEventListener('pagehide', pagehide);
  window.addEventListener('pageshow', pageshow);
  window.addEventListener('popstate', scheduleCheck);
  chrome.storage.local.get('focusState').then(result => {
    if (destroyed) return;
    state = result.focusState;
    theme();
    document.body.append(host);
    observer = new MutationObserver(scheduleCheck);
    observer.observe(document.body, { childList: true, subtree: true });
    bind();
  }).catch(() => status('读取本机清单失败，请刷新后重试'));
})();
