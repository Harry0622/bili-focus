// Run in the isolated dual-extension Chromium profile using Playwright CLI.
async page => {
  const ctx = page.context();
  const versions = {};
  for (const worker of ctx.serviceWorkers()) {
    const version = await worker.evaluate(() => chrome.runtime.getManifest().version);
    versions[version] = { worker, origin: worker.url().replace('/background.js', '') };
  }
  if (!versions['1.0.0'] || !versions['1.1.0']) throw Error('Load both the retained v1.0 baseline and v1.1 extension');
  const assert = (value, message) => { if (!value) throw Error(message); };
  const fixture = count => {
    const videos = {}, now = Date.now();
    for (let i = 0; i < count; i++) videos[`BV1xx411c7mD:${i + 11}`] = {
      bvid: 'BV1xx411c7mD', aid: 2, cid: i + 11, page: i + 1, totalPages: count,
      partTitle: `第 ${i + 1} 讲`, url: `https://www.bilibili.com/video/BV1xx411c7mD?p=${i + 1}`,
      title: '测试清单：从需求到清晰的界面', cover: '', duration: 4200, ownerName: '演示', metaUpdatedAt: now,
      positionSec: i === 0 ? 2300 : 600, maxPositionSec: 2300, completed: false,
      lastWatchedAt: now - (i + 1) * 60000, bookmarks: [{ id: `b${i}`, sec: 754, note: '值得再看', createdAt: now - 10000 }],
      addedAt: now - i, note: '', pinned: false, invalid: false,
    };
    return { schemaVersion: 1, videos, pending: {}, trash: {}, settings: { sampleIntervalSec: 5, openInNewTab: true, addEntireCollectionDefault: false, completionPercent: 95, completionRemainingSec: 30, theme: 'system', autoCleanup: false, cleanupAfterDays: 30, cleanupKeepBookmarked: true } };
  };
  function summary(samples) {
    const s = [...samples].sort((a, b) => a - b), round = n => Math.round(n * 10) / 10;
    return { n: s.length, meanMs: round(s.reduce((a, b) => a + b, 0) / s.length), medianMs: round(s[Math.floor(s.length / 2)]), p95Ms: round(s[Math.min(s.length - 1, Math.ceil(s.length * .95) - 1)]), maxMs: round(s.at(-1)) };
  }
  const results = { environment: 'Chromium 158, isolated persistent profile, local MV3 pages, offline, no cover requests', startup: {}, settings: {}, interactions: {} };
  const consoleErrors = [];
  await ctx.setOffline(true);
  try {
    for (const count of [3, 1000]) {
      for (const v of Object.values(versions)) await v.worker.evaluate(data => chrome.storage.local.set({ focusState: data }), fixture(count));
      const timings = { '1.0.0': [], '1.1.0': [] }, storageReads = { '1.0.0': [], '1.1.0': [] };
      let unexpectedInitialRareRequests = 0;
      // Alternate versions to reduce ordering and host-load bias. Each iteration
      // opens a new extension document; browser/filesystem caches stay warm.
      for (let i = 0; i < (count === 3 ? 50 : 25); i++) for (const version of i % 2 ? ['1.1.0', '1.0.0'] : ['1.0.0', '1.1.0']) {
        const popup = await ctx.newPage();
        popup.on('pageerror', error => consoleErrors.push(error.message));
        popup.on('request', request => { if (request.url().includes('/assets/rare-theme')) unexpectedInitialRareRequests++; });
        await popup.addInitScript(() => {
          window.__benchmark = { ready: 0, storageReads: 0 };
          const get = chrome.storage.local.get.bind(chrome.storage.local);
          chrome.storage.local.get = (...args) => { window.__benchmark.storageReads++; return get(...args); };
          const observer = new MutationObserver(() => {
            if (!window.__benchmark.ready && document.querySelector('#list')?.getAttribute('aria-busy') === 'false') {
              window.__benchmark.ready = performance.now(); observer.disconnect();
            }
          });
          observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-busy'] });
        });
        await popup.goto(`${versions[version].origin}/popup.html`);
        await popup.waitForFunction(() => window.__benchmark.ready > 0);
        const measured = await popup.evaluate(() => window.__benchmark);
        timings[version].push(measured.ready); storageReads[version].push(measured.storageReads);
        await popup.close();
      }
      assert(unexpectedInitialRareRequests === 0, 'Rare UI was requested before opening settings');
      results.startup[count] = Object.fromEntries(Object.keys(timings).map(version => [version, { ...summary(timings[version]), initialStorageReads: [...new Set(storageReads[version])], initialRareRequests: 0 }]));
    }
    for (const v of Object.values(versions)) await v.worker.evaluate(data => chrome.storage.local.set({ focusState: data }), fixture(3));
    const cold = { '1.0.0': [], '1.1.0': [] }, visible = { '1.0.0': [], '1.1.0': [] }, warm = { '1.0.0': [], '1.1.0': [] };
    let rareDomChecks = 0;
    for (let i = 0; i < 20; i++) for (const version of i % 2 ? ['1.1.0', '1.0.0'] : ['1.0.0', '1.1.0']) {
      const popup = await ctx.newPage();
      popup.on('pageerror', error => consoleErrors.push(error.message));
      await popup.goto(`${versions[version].origin}/popup.html`);
      await popup.locator('#list[aria-busy=false]').waitFor();
      const start = await popup.evaluate(() => { const start = performance.now(); document.querySelector('#settings-toggle').click(); return { start, visibleMs: performance.now() - start }; });
      visible[version].push(start.visibleMs);
      if (version === '1.1.0') {
        await popup.locator('#rare-theme-host[data-rare-state=ready] [data-slot=theme-selector]').waitFor(); rareDomChecks++;
        cold[version].push(await popup.evaluate(() => performance.getEntriesByName('rare-theme:first-mount')[0].duration));
      } else cold[version].push(start.visibleMs);
      const w = await popup.evaluate(async () => {
        document.querySelector('#settings-toggle').click();
        const start = performance.now(); document.querySelector('#settings-toggle').click(); const sync = performance.now() - start;
        await new Promise(requestAnimationFrame); return { syncMs: sync, nextFrameMs: performance.now() - start };
      });
      warm[version].push(w);
      await popup.close();
    }
    results.settings = Object.fromEntries(Object.keys(cold).map(version => [version, { panelVisible: summary(visible[version]), completeFirstOpen: summary(cold[version]), warmHandler: summary(warm[version].map(v => v.syncMs)), warmNextFrame: summary(warm[version].map(v => v.nextFrameMs)) }]));
    results.settings.rareDomChecks = rareDomChecks;
    const popup = await ctx.newPage(); await popup.goto(`${versions['1.1.0'].origin}/popup.html`); await popup.locator('#list[aria-busy=false]').waitFor();
    const select = [], fold = [], filters = [], longTasks = [];
    await popup.evaluate(() => { window.__longTasks = []; new PerformanceObserver(list => { for (const e of list.getEntries()) window.__longTasks.push({ name: e.name, duration: e.duration }); }).observe({ type: 'longtask', buffered: true }); });
    for (let i = 0; i < 50; i++) {
      const measured = await popup.evaluate(async i => {
        const start = performance.now(); document.querySelectorAll('.list-row')[i % 2].click(); const sync = performance.now() - start;
        await new Promise(requestAnimationFrame); return { sync, nextFrame: performance.now() - start };
      }, i);
      select.push(measured);
      fold.push(await popup.evaluate(() => { const start = performance.now(); document.querySelector('#bookmarks-toggle').click(); document.querySelector('#bookmarks-toggle').click(); return performance.now() - start; }));
      filters.push(await popup.evaluate(() => { const start = performance.now(); document.querySelector('[data-filter=completed]').click(); document.querySelector('[data-filter=all]').click(); return performance.now() - start; }));
    }
    longTasks.push(...await popup.evaluate(() => window.__longTasks));
    results.interactions = { selectionHandler: summary(select.map(v => v.sync)), selectionNextFrame: summary(select.map(v => v.nextFrame)), bookmarkOpenCloseHandler: summary(fold), filterRoundTripHandler: summary(filters), observedLongTasks: longTasks };
    await popup.close();
    results.pageErrors = consoleErrors;
    assert(consoleErrors.length === 0, 'Browser page errors occurred');
    results.notes = ['startup = navigation start to local-list DOM ready, not toolbar popup creation overhead', 'new popup documents with warm browser/filesystem caches; this is not an OS cold boot test', 'settings v1.1 completeFirstOpen measures the actual local Rare UI/React/CSS import and first React commit', 'handler timings exclude automation transport; nextFrame records the next headless animation-frame callback, not a physical-display latency measurement', 'layout changed too, so startup delta cannot be attributed solely to Rare UI'];
    return results;
  } finally { await ctx.setOffline(false); }
}
