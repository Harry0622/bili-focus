// Real content script and popup bookmark handshake on a controlled media page.
async page => {
  const ctx = page.context();
  let worker;
  for (const candidate of ctx.serviceWorkers()) if (await candidate.evaluate(() => chrome.runtime.getManifest().version) === '1.3.0') worker = candidate;
  if (!worker) throw Error('The v1.3 extension is not loaded');
  const origin = worker.url().replace('/background.js', '');
  const assert = (value, message) => { if (!value) throw Error(message); };
  const state = () => worker.evaluate(async () => (await chrome.storage.local.get('focusState')).focusState);
  const now = Date.now();
  const base = { bvid:'BV1xx411c7mD',aid:2,cid:11,page:1,totalPages:2,partTitle:'P1',url:'https://www.bilibili.com/video/BV1xx411c7mD?p=1',title:'受控播放器测试',cover:'',duration:600,ownerName:'测试',metaUpdatedAt:now,positionSec:50,maxPositionSec:50,completed:false,lastWatchedAt:now-10000,bookmarks:[],addedAt:now,note:'',pinned:false,invalid:false };
  const fixture = { schemaVersion:1,videos:{'BV1xx411c7mD:11':base,'BV1xx411c7mD:12':{...base,cid:12,page:2,partTitle:'P2',positionSec:60}},pending:{},trash:{},settings:{theme:'system',sampleIntervalSec:5,openInNewTab:true,addEntireCollectionDefault:false,completionPercent:95,completionRemainingSec:30} };
  await worker.evaluate(data => chrome.storage.local.set({focusState:data}), fixture);
  await page.goto(`${origin}/popup.html`); await page.locator('#list[aria-busy=false]').waitFor();
  const bytes = new Uint8Array(44 + 600 * 8000), dv = new DataView(bytes.buffer);
  const str = (offset,text) => [...text].forEach((c,i) => dv.setUint8(offset+i,c.charCodeAt(0)));
  str(0,'RIFF');dv.setUint32(4,bytes.length-8,true);str(8,'WAVE');str(12,'fmt ');dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,1,true);dv.setUint32(24,8000,true);dv.setUint32(28,8000,true);dv.setUint16(32,1,true);dv.setUint16(34,8,true);str(36,'data');dv.setUint32(40,bytes.length-44,true);bytes.fill(128,44);
  await ctx.unroute('https://www.bilibili.com/focus-test.wav'); await ctx.unroute('https://www.bilibili.com/video/**');
  await ctx.route('https://www.bilibili.com/focus-test.wav',r => {
    const m = r.request().headers().range?.match(/bytes=(\d+)-(\d*)/), start=m?Number(m[1]):0,end=m&&m[2]?Math.min(bytes.length-1,Number(m[2])):bytes.length-1;
    return r.fulfill({status:m?206:200,headers:{'Content-Type':'audio/wav','Accept-Ranges':'bytes','Content-Length':String(end-start+1),...(m?{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}:{})},body:Buffer.from(bytes.subarray(start,end+1))});
  });
  await ctx.route('https://www.bilibili.com/video/**',r => r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html><head><meta charset="utf-8"><title>受控播放器测试</title></head><body><video muted controls preload="auto" src="/focus-test.wav"></video></body></html>'}));
  const player = await ctx.newPage(); await player.goto('https://www.bilibili.com/video/BV1xx411c7mD?p=1');
  await player.locator('#bili-focus-entry').waitFor();
  await player.waitForFunction(() => {const v=document.querySelector('video');return v.readyState>=1&&v.seekable.length&&v.seekable.end(0)>300;});
  const seek = sec => player.locator('video').evaluate((v,sec) => new Promise(resolve => {v.addEventListener('seeked',resolve,{once:true});v.currentTime=sec;}), sec);
  await seek(123);
  await page.waitForFunction(() => chrome.storage.local.get('focusState').then(s=>Math.abs(s.focusState.videos['BV1xx411c7mD:11'].positionSec-123)<1));
  assert((await state()).videos['BV1xx411c7mD:12'].positionSec===60,'P1 overwrote P2');
  // Keep the player as the active browser tab, as it is under a real toolbar popup.
  await player.bringToFront();
  await page.evaluate(() => { document.querySelector('#bookmarks-toggle').click(); document.querySelector('#add-bookmark').click(); });
  await page.locator('#note-dialog[open]').waitFor();
  await page.getByRole('textbox',{name:'一句备注'}).fill('当前播放位置书签');
  await page.getByRole('button',{name:'保存书签',exact:true}).click();
  const marked = (await state()).videos['BV1xx411c7mD:11'];
  assert(Math.abs(marked.bookmarks[0].sec-123)<1 && Math.abs(marked.positionSec-123)<1,'Popup did not bookmark current media time independently');
  await seek(80);
  await page.waitForFunction(() => chrome.storage.local.get('focusState').then(s=>Math.abs(s.focusState.videos['BV1xx411c7mD:11'].positionSec-80)<1));
  assert(await player.locator('video').evaluate(v=>Math.abs(v.currentTime-80)<1),'Extension changed the player position');
  await player.evaluate(() => {history.pushState({},'','?p=2');document.body.append(document.createElement('i'));});
  await player.locator('#bili-focus-entry[aria-label="重点关注 · P2"]').waitFor();
  await player.locator('video').evaluate(v=>v.dispatchEvent(new Event('pause')));
  assert((await state()).videos['BV1xx411c7mD:12'].positionSec===60,'Old media time was attributed to the new P');
  await seek(10); await player.locator('video').evaluate(v=>v.dispatchEvent(new Event('loadedmetadata')));
  await page.waitForFunction(() => chrome.storage.local.get('focusState').then(s=>Math.abs(s.focusState.videos['BV1xx411c7mD:12'].positionSec-10)<1));
  assert(Math.abs((await state()).videos['BV1xx411c7mD:11'].positionSec-80)<1,'P2 overwrote P1');
  await player.close();
  const untracked = await ctx.newPage(); await untracked.goto('https://www.bilibili.com/video/BV1ab411c7mD?p=1'); await untracked.locator('#bili-focus-entry').waitFor();
  const before = JSON.stringify((await state()).videos);
  await untracked.locator('video').evaluate(v=>{v.currentTime=99;v.dispatchEvent(new Event('pause'));v.dispatchEvent(new Event('seeked'));});
  await untracked.close(); assert(JSON.stringify((await state()).videos)===before,'Untracked page wrote progress');
  return {passed:['新popup读取当前播放秒数并新增书签，续播位置不变','seeked采集及反向拖动','以播放器实际位置为准','受控SPA切P等待媒体边界，P1/P2隔离','关页与未关注页不写进度'],scope:'Real extension/storage/content script; a controlled HTMLMediaElement replaces the Bilibili production player'};
}
