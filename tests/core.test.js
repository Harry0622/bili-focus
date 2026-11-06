import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLink, resolveLink } from '../shared/links.js';
import { fetchVideo, ApiError, retryDelay } from '../shared/api.js';
import { emptyState, keyOf, recordsFromMetadata, resumeTarget, applyProgress, validateBackup, formatTime, validCover } from '../shared/model.js';

const bvid = 'BV1xx411c7mD';
const meta = { bvid, aid: 2, title: '测试多P视频', pic: 'https://i0.hdslb.com/cover.jpg', owner: { name: '测试UP' }, pages: [{ cid: 11, page: 1, part: '第一P', duration: 600 }, { cid: 12, page: 2, part: '第二P', duration: 800 }] };
const records = () => recordsFromMetadata(meta, 1, true);

test('BV / av / mobile links normalize and remove tracking parameters', () => {
  assert.equal(parseLink(`${bvid}`).url, `https://www.bilibili.com/video/${bvid}?p=1`);
  assert.equal(parseLink(`https://m.bilibili.com/video/${bvid}?p=2&spm_id_from=x&t=5&from=y`).url, `https://www.bilibili.com/video/${bvid}?p=2`);
  assert.equal(parseLink('av2').aid, 2);
});
test('reject unsupported, malicious and malformed links explicitly', () => {
  for (const url of ['https://www.bilibili.com/bangumi/play/ep1', 'https://live.bilibili.com/123', 'https://evil.com/video/'+bvid, 'javascript:alert(1)', `https://www.bilibili.com/video/${bvid}?p=-1`, `https://www.bilibili.com/video/${bvid}?p=1.2`, 'av0']) assert.throws(() => parseLink(url));
});
test('short links follow redirects and validate final UGC destination', async () => {
  assert.equal((await resolveLink('https://b23.tv/abc123', async (_url, init) => { assert.equal(init.credentials, 'omit'); return { url: `https://www.bilibili.com/video/${bvid}?p=2&from=x` }; })).page, 2);
  await assert.rejects(resolveLink('b23.tv/abc123', async () => ({ url: 'https://www.bilibili.com/bangumi/play/ep2' })), /暂不支持/);
});
test('metadata makes independent P records using each P duration', () => {
  const [p1,p2] = records(); assert.notEqual(keyOf(p1), keyOf(p2)); assert.equal(p1.duration, 600); assert.equal(p2.duration, 800); assert.equal(recordsFromMetadata(meta,2,false).length,1);
  assert.throws(() => recordsFromMetadata(meta,3,false), /分P不存在/);
});
test('resume completion boundaries: next P, last P, single P, explicit last location', () => {
  const [p1,p2] = records(); p1.positionSec=100;
  assert.match(resumeTarget(p1,emptyState().settings).url, /p=1&t=100$/);
  p1.positionSec=571; assert.match(resumeTarget(p1,emptyState().settings).url, /p=2$/); assert.ok(!resumeTarget(p1,emptyState().settings).url.includes('t='));
  p2.completed=true; assert.match(resumeTarget(p2,emptyState().settings).url,/p=2$/); assert.equal(resumeTarget(p2,emptyState().settings).lastPage,true);
  p1.totalPages=1; assert.match(resumeTarget(p1,emptyState().settings).url,/p=1$/);
});
test('actual position may move backwards; stale samples cannot overwrite it or another P', () => {
  const s=emptyState(); const [a,b]=records(); s.videos[keyOf(a)]=a; s.videos[keyOf(b)]=b; const now=Date.now();
  assert.equal(applyProgress(s,keyOf(a),{sec:400,at:now-10}),true);
  assert.equal(applyProgress(s,keyOf(a),{sec:120,at:now}),true); assert.equal(a.positionSec,120); assert.equal(a.maxPositionSec,400); assert.equal(b.positionSec,0);
  assert.equal(applyProgress(s,keyOf(a),{sec:500,at:now-20}),false); assert.equal(applyProgress(s,'untracked',{sec:10,at:now}),false);
  assert.equal(applyProgress(s,keyOf(a),{sec:NaN,at:now+1}),false);
});
test('ended marks completed, a later actual position clears completion', () => {
  const s=emptyState(),v=records()[0];s.videos[keyOf(v)]=v; const now=Date.now();
  applyProgress(s,keyOf(v),{sec:599,at:now-1,ended:true}); assert.equal(v.completed,true);
  applyProgress(s,keyOf(v),{sec:10,at:now}); assert.equal(v.completed,false);
});
test('cover URLs cannot load arbitrary domains or executable/data content', () => {
  assert.equal(validCover('//i0.hdslb.com/a.jpg'),'https://i0.hdslb.com/a.jpg');
  for (const cover of ['https://evil.com/a','https://hdslb.com.evil.com/a','data:image/svg+xml,abc','javascript:alert(1)']) assert.equal(validCover(cover),'');
});
test('backup validates atomically and sanitizes text and remote cover sources', () => {
  const s=emptyState(),v=records()[0]; s.videos[keyOf(v)]=v; v.cover='https://evil.com/x'; v.bookmarks=[{id:'a',sec:42,note:'<script>alert(1)</script>',createdAt:1}];
  const clean=validateBackup(s); assert.equal(clean.videos[keyOf(v)].cover,'');assert.equal(clean.videos[keyOf(v)].bookmarks[0].sec,42);
  assert.throws(()=>validateBackup({...s,schemaVersion:2}));
  s.videos['bad:key']=v;assert.throws(()=>validateBackup(s));
});
test('time formatter covers hours and malformed input',()=>{assert.equal(formatTime(2300),'38:20'); assert.equal(formatTime(3601),'1:00:01');assert.equal(formatTime(-1),'0:00');});
test('API uses anonymous request and unsigned endpoint',async()=>{const data=await fetchVideo({aid:2},async(url,init)=>{assert.equal(url,'https://api.bilibili.com/x/web-interface/view?aid=2');assert.equal(init.credentials,'omit');return {ok:true,json:async()=>({code:0,data:meta})};});assert.equal(data.bvid,bvid);});
for (const code of [-352,-412,-509,-404]) test(`API error ${code} is typed and reported`,async()=>{await assert.rejects(fetchVideo({bvid},async()=>({ok:true,json:async()=>({code})})),e=>e instanceof ApiError&&e.code===code&&e.retryable===(code!==-404));});
test('network, non-JSON and HTTP failure are actionable',async()=>{
  await assert.rejects(fetchVideo({bvid},async()=>{throw Error('offline')}),/网络连接失败/);
  await assert.rejects(fetchVideo({bvid},async()=>({ok:false,status:412})),e=>e.code===-412);
  await assert.rejects(fetchVideo({bvid},async()=>({ok:true,json:async()=>{throw Error('invalid')}})),/返回异常/);
  await assert.rejects(fetchVideo({bvid},async()=>({ok:true,json:async()=>null})),/返回异常/);
  await assert.rejects(fetchVideo({bvid},async()=>({ok:true,json:async()=>({code:0,data:{...meta,pages:[null]}})})),/视频信息不完整/);
  assert.equal(retryDelay(0),60000);assert.equal(retryDelay(1),120000);assert.ok(retryDelay(99)<=86400000);
});
