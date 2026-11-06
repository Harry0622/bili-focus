// Real public Bilibili metadata and cover images; all progress is disposable demo data.
async page => {
  const ctx = page.context(); let worker;
  for (const candidate of ctx.serviceWorkers()) if (await candidate.evaluate(() => chrome.runtime.getManifest().version) === '1.3.0') worker = candidate;
  const origin = worker.url().replace('/background.js', '');
  const assert = (value, message) => { if (!value) throw Error(message); };
  const settled = () => page.waitForFunction(() => document.getAnimations().every(a=>a.playState!=='running' && !a.pending));
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const referers = [];
  page.on('request', request => { if (request.resourceType() === 'image') referers.push(request.headers().referer || null); });
  await worker.evaluate(() => chrome.storage.local.set({ focusState: { schemaVersion:1,videos:{},pending:{},trash:{},settings:{theme:'light',accentColor:'#0f766e',autoCleanup:true} } }));
  await page.goto(`${origin}/popup.html`); await page.locator('body[data-ready=true]').waitFor();
  const added = [];
  for (const bvid of ['BV1GJ411x7h7','BV1UB4v67Exr','BV1hA4a6yEp9']) {
    const response = await page.evaluate(bvid => chrome.runtime.sendMessage({type:'ADD',url:bvid}), bvid);
    assert(response.ok && !response.result.pending, `Public metadata could not be added: ${JSON.stringify(response)}`);
    added.push(bvid);
  }
  await worker.evaluate(async () => {
    const {focusState:s} = await chrome.storage.local.get('focusState');
    const videos = Object.values(s.videos); const now = Date.now();
    for (let i=0;i<videos.length;i++) { videos[i].positionSec=i===0?58:20; videos[i].lastWatchedAt=now-(i+1)*60000; }
    await chrome.storage.local.set({focusState:s});
  });
  await page.waitForFunction(() => document.querySelectorAll('.list-row').length === 3 && [...document.querySelectorAll('.list-row img')].every(img => img.complete && img.naturalWidth>0) && document.querySelector('#focus-cover img')?.naturalWidth>0);
  const covers = await page.evaluate(() => [...document.querySelectorAll('.thumbnail img')].map(img=>({url:img.src,width:img.naturalWidth,referrerPolicy:img.referrerPolicy})));
  assert(covers.length === 4 && covers.every(c=>c.url.startsWith('https://') && c.width>0 && c.referrerPolicy==='no-referrer'), 'Cover rendering is incomplete');
  assert(referers.every(value=>value===null), 'A cover request sent a Referer');
  const font = await page.locator('.row-title').first().evaluate(el=>getComputedStyle(el).fontSize);
  assert(font==='14px','Row font did not increase');
  await page.setViewportSize({width:400,height:520}); await settled();
  await page.screenshot({path:'output/playwright/v13-real-covers-light.png'});
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.locator('#rare-theme-host[data-rare-state=ready]').waitFor();
  assert(await page.locator('#auto-cleanup').count()===0,'Automatic cleanup control is still visible');
  await page.getByRole('button',{name:'海蓝',exact:true}).click();
  await page.waitForFunction(()=>chrome.storage.local.get('focusState').then(s=>s.focusState.settings.accentColor==='#2563eb'));
  await page.getByRole('textbox',{name:'颜色值',exact:true}).fill('#C0643A');
  await page.getByRole('textbox',{name:'颜色值',exact:true}).press('Enter');
  await page.waitForFunction(()=>chrome.storage.local.get('focusState').then(s=>s.focusState.settings.accentColor==='#c0643a'));
  await page.reload(); await page.locator('body[data-ready=true]').waitFor();
  assert(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--primary'))==='#c0643a','Custom color did not persist');
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.locator('#rare-theme-host[data-rare-state=ready]').waitFor();
  await page.getByLabel('自定义颜色',{exact:true}).fill('#be3f64');
  await page.waitForFunction(()=>chrome.storage.local.get('focusState').then(s=>s.focusState.settings.accentColor==='#be3f64'));
  await page.getByRole('radio',{name:'深色',exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  await settled();
  await page.screenshot({path:'output/playwright/v13-custom-color-settings.png'});
  await page.getByRole('button',{name:'青绿',exact:true}).click();
  await page.waitForFunction(()=>chrome.storage.local.get('focusState').then(s=>s.focusState.settings.accentColor==='#0f766e'));
  await page.getByRole('button',{name:'收起设置',exact:true}).click();
  await settled();
  await page.screenshot({path:'output/playwright/v13-real-covers-dark.png'});
  // Simulate only the browser's size-query result, not a giant allocation.
  await page.addInitScript(() => { chrome.storage.local.getBytesInUse = async () => 1024**3+1; });
  const before = await worker.evaluate(async()=>JSON.stringify((await chrome.storage.local.get('focusState')).focusState.videos));
  await page.reload(); await page.locator('#storage-warning:not([hidden])').waitFor();
  await page.getByRole('button',{name:'去清理',exact:true}).click();
  await page.locator('#cleanup-panel[open]').waitFor();
  assert(await page.locator('#settings').isVisible(),'Reminder did not open manual cleanup');
  const after = await worker.evaluate(async()=>JSON.stringify((await chrome.storage.local.get('focusState')).focusState.videos));
  assert(before===after,'Storage reminder removed data');
  assert(await page.evaluate(()=>document.documentElement.scrollHeight<=520),'Storage warning overflowed the popup');
  await page.screenshot({path:'output/playwright/v13-storage-warning.png'});
  assert(errors.length===0,errors.join('; '));
  return {passed:['真实免登录view接口添加3个投稿','4处真实CDN封面在扩展内加载，HTTPS且无Referer','清单字号14px','预设色、HEX和原生选择器保存，重开保持','Rare UI深浅色与自定义色配合','自动清理入口已移除','超过1GiB显示提醒并进入手动清理，不删除数据','尺寸保持400×520'],added,covers,referers,rowFont:font,pageErrors:errors,warningMethod:'mock getBytesInUse only; no 1GB allocation, default quota unchanged'};
}
