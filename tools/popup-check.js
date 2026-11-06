// Real MV3 UI regression. Run only in the isolated, disposable test profile.
async page => {
  const ctx = page.context();
  let worker;
  for (const candidate of ctx.serviceWorkers()) if (await candidate.evaluate(() => chrome.runtime.getManifest().version) === '1.2.0') worker = candidate;
  if (!worker) throw Error('The v1.2 extension is not loaded');
  const origin = worker.url().replace('/background.js', '');
  const assert = (value, message) => { if (!value) throw Error(message); };
  const state = () => worker.evaluate(async () => (await chrome.storage.local.get('focusState')).focusState);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const now = Date.now(), base = {
    bvid: 'BV1xx411c7mD', aid: 2, cid: 11, page: 1, totalPages: 3, partTitle: '从需求到清晰的界面',
    url: 'https://www.bilibili.com/video/BV1xx411c7mD?p=1', title: '设计一款真正好用的产品：从需求到界面',
    cover: '', duration: 4200, ownerName: '演示 · 设计研究室', metaUpdatedAt: now,
    positionSec: 2300, maxPositionSec: 2300, completed: false, lastWatchedAt: now - 60000,
    bookmarks: [{ id: 'demo-1', sec: 754, note: '信息层级的三个原则', createdAt: now - 10000 }, { id: 'demo-2', sec: 1925, note: '这个案例值得再看', createdAt: now - 9000 }],
    addedAt: now - 5000, note: '', pinned: false, invalid: false,
  };
  const second = { ...base, cid: 12, page: 2, partTitle: '给交互做减法', positionSec: 1055, bookmarks: [], lastWatchedAt: now - 3600000 };
  const third = { ...base, bvid: 'BV1GJ411x7h7', aid: 100, cid: 13, page: 1, totalPages: 1, title: '把复杂的知识，变成可以理解的结构', duration: 1800, positionSec: 1795, completed: true, bookmarks: [], lastWatchedAt: now - 86400000 };
  const fixture = { schemaVersion: 1, videos: { 'BV1xx411c7mD:11': base, 'BV1xx411c7mD:12': second, 'BV1GJ411x7h7:13': third }, pending: {}, trash: {}, settings: { theme: 'system', sampleIntervalSec: 5, completionPercent: 95, completionRemainingSec: 30, openInNewTab: true, addEntireCollectionDefault: false, autoCleanup: false, cleanupAfterDays: 30, cleanupKeepBookmarked: true } };
  await worker.evaluate(data => chrome.storage.local.set({ focusState: data }), fixture);
  await page.emulateMedia({ colorScheme: 'light' }); await page.setViewportSize({ width: 400, height: 520 });
  await page.goto(`${origin}/popup.html`); await page.getByRole('button', { name: '继续观看 38:20', exact: true }).waitFor();
  const dimensions = await page.evaluate(() => ({ width: document.body.offsetWidth, height: document.body.offsetHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, primaryCount: document.querySelectorAll('.primary').length, hitHeight: document.querySelector('#resume-button').getBoundingClientRect().height, initialRare: performance.getEntriesByType('resource').filter(r => r.name.includes('/assets/rare-theme')).length }));
  assert(dimensions.width === 400 && dimensions.height === 520 && dimensions.scrollWidth <= 400 && dimensions.scrollHeight <= 520, 'Popup exceeds 400x520');
  assert(dimensions.primaryCount === 1 && dimensions.hitHeight >= 44 && dimensions.initialRare === 0, 'Primary action or lazy-loading constraint failed');
  await page.screenshot({ path: 'output/playwright/v12-fixture-light.png' });
  await page.getByRole('button', { name: '选择 设计一款真正好用的产品：从需求到界面 P2', exact: true }).click();
  await page.getByRole('button', { name: '继续观看 17:35', exact: true }).waitFor();
  assert((await state()).videos['BV1xx411c7mD:11'].positionSec === 2300, 'Selecting row changed saved progress');
  await page.getByRole('button', { name: '选择 设计一款真正好用的产品：从需求到界面 P1', exact: true }).click();
  await page.getByRole('button', { name: '时间书签 2', exact: true }).click();
  await page.getByRole('button', { name: '修改书签备注', exact: true }).first().click();
  await page.getByRole('textbox', { name: '一句备注' }).fill('浏览器验证后的备注');
  await page.getByRole('button', { name: '保存书签', exact: true }).click();
  await page.getByRole('button', { name: '跳转 12:34 浏览器验证后的备注', exact: true }).waitFor();
  assert((await state()).videos['BV1xx411c7mD:11'].positionSec === 2300, 'Bookmark edit changed progress');
  await page.locator('#toast-close').click();
  await page.screenshot({ path: 'output/playwright/v12-bookmarks.png' });
  await page.getByRole('button', { name: '删除此分P', exact: true }).click();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert((await state()).videos['BV1xx411c7mD:11'].bookmarks[0].note === '浏览器验证后的备注', 'Undo lost bookmark');
  await page.getByRole('button', { name: '选择 设计一款真正好用的产品：从需求到界面 P1', exact: true }).click();
  await page.getByRole('button', { name: '＋ 添加视频', exact: true }).click();
  await page.getByRole('textbox', { name: 'B站视频链接或 BV / av号' }).fill('https://www.bilibili.com/bangumi/play/ep1');
  await page.getByRole('button', { name: '添加当前分P', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '暂不支持该类型链接' }).waitFor();
  await page.getByRole('button', { name: '收起添加视频', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('#rare-theme-host[data-rare-state=ready] [data-slot=theme-selector]').waitFor();
  assert(await page.getByRole('radiogroup', { name: '外观主题' }).count() === 1, 'Official ThemeSelector not mounted');
  assert(await page.getByRole('radio').count() === 3, 'ThemeSelector options are missing');
  await page.getByRole('radio', { name: '深色', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.getByRole('radio', { name: '深色', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => chrome.storage.local.get('focusState').then(s => s.focusState.settings.theme === 'system'));
  await page.getByRole('radio', { name: '深色', exact: true }).click();
  await page.waitForFunction(() => chrome.storage.local.get('focusState').then(s => s.focusState.settings.theme === 'dark'));
  await page.getByRole('button', { name: '收起设置', exact: true }).click();
  await page.reload(); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running' && !a.pending));
  await page.screenshot({ path: 'output/playwright/v12-fixture-dark.png' });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('#rare-theme-host[data-rare-state=ready]').waitFor();
  await page.screenshot({ path: 'output/playwright/v12-rare-settings.png' });
  await page.getByRole('radio', { name: '浅色', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.getByLabel('播放时采样间隔').selectOption('10');
  await page.waitForFunction(() => document.querySelector('#interval').disabled === false);
  assert((await state()).settings.sampleIntervalSec === 10, 'Sampling setting was lost');
  await page.locator('#cleanup-panel summary').click();
  const old = JSON.parse(JSON.stringify(fixture));
  old.videos['BV1xx411c7mD:12'].addedAt = now - 40 * 86400000; old.videos['BV1xx411c7mD:12'].lastWatchedAt = now - 40 * 86400000; old.videos['BV1xx411c7mD:12'].completed = true;
  await worker.evaluate(data => chrome.storage.local.set({ focusState: data }), old);
  await page.locator('#cleanup-preview').filter({ hasText: '可清理 1 条' }).waitFor();
  await page.getByRole('button', { name: '手动清理', exact: true }).click();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert(!!(await state()).videos['BV1xx411c7mD:12'], 'Batch cleanup undo failed');
  await page.locator('#toast-close').click();
  await page.locator('#cleanup-panel').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'output/playwright/v12-cleanup.png' });
  assert(await page.evaluate(() => document.documentElement.scrollHeight <= 520), 'Expanded settings increased popup height');
  // Empty state must still open the add form with the single primary action.
  await worker.evaluate(data => chrome.storage.local.set({ focusState: { ...data, videos: {} } }), fixture);
  await page.reload(); await page.getByRole('button', { name: '添加第一个视频', exact: true }).click();
  await page.locator('#add-panel:not([hidden])').waitFor();
  await page.getByRole('button', { name: '收起添加视频', exact: true }).click();
  await page.screenshot({ path: 'output/playwright/v12-empty.png' });
  await worker.evaluate(data => chrome.storage.local.set({ focusState: data }), fixture);
  await page.reload(); await page.getByRole('button', { name: '继续观看 38:20', exact: true }).waitFor();
  assert(errors.length === 0, errors.join('; '));
  return { passed: ['400×520尺寸与单主按钮44px点击区', '初次打开不请求Rare UI/React资源', '紧凑清单选择后续播目标改变', '书签修改与进度隔离', '删除与撤销', '番剧错误提示', '真实Rare UI主题组件与方向键操作', '主题选择重开后持久化', '采样设置', '清理预览与整批撤销', '空状态主操作', '设置展开后高度仍不超过520px'], dimensions, pageErrors: errors };
}
