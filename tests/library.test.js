import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, recordsFromMetadata, validateBackup } from '../shared/model.js';
import { defaultLibrary, normalizeLibraryState, normalizeGroups, buildGroupIndex, createGroup, editGroup, deleteGroup, restoreGroup, editVideo, videoName, defaultVideoName, libraryEntries, mergeGroups } from '../shared/library.js';
const meta = { bvid:'BV1xx411c7mD',aid:2,title:'原标题',pages:[{cid:11,page:1,part:'入门',duration:600},{cid:12,page:2,part:'进阶',duration:800}] };
function fixture() { const s=emptyState(); for(const v of recordsFromMetadata(meta,1,true)) s.videos[`${v.bvid}:${v.cid}`]=v; return s; }
const key='BV1xx411c7mD:11';
test('legacy records migrate without changing progress, bookmarks or original metadata',()=>{
  const s=fixture(); delete s.groups; delete s.libraryUI; const v=s.videos[key]; delete v.groupId; delete v.displayName; v.positionSec=123; v.bookmarks=[{id:'keep',sec:42,note:'保留',createdAt:1}];
  const result=normalizeLibraryState(s); assert.equal(result.videos[key].groupId,'default'); assert.equal(result.videos[key].positionSec,123); assert.equal(result.videos[key].bookmarks[0].note,'保留'); assert.equal(result.videos[key].title,'原标题');
});
test('deep group indexing, search and ancestor counts work without recursive stack limits',()=>{
  const s=fixture(); let parentId=null;
  for(let i=0;i<2000;i++){const id=`g${i}`;s.groups[id]={id,name:`层${i}`,parentId,createdAt:i};parentId=id;}
  s.videos[key].groupId=parentId;s.videos[key].displayName='独立名称';s.libraryUI.collapsedGroupIds=['g0',parentId];
  const normalized=normalizeGroups(s.groups); assert.equal(buildGroupIndex(normalized).byId.get(parentId).depth,1999);
  assert.ok(!libraryEntries(s).entries.some(e=>e.key===key));
  for(const query of ['独立名称','原标题','入门']) { const view=libraryEntries(s,{query}); assert.ok(view.entries.some(e=>e.key===key));assert.equal(view.entries.find(e=>e.key==='g0').count,1); }
  assert.deepEqual(s.libraryUI.collapsedGroupIds,['g0',parentId]);
});
test('invalid parent references and cycles are rejected, default group is protected',()=>{
  const s=emptyState(),a=createGroup(s,{name:'课程'}).id,b=createGroup(s,{name:'前端',parentId:a}).id;
  assert.throws(()=>editGroup(s,{id:a,name:'课程',parentId:b}),/子分组/);
  assert.throws(()=>createGroup(s,{name:'前端',parentId:a}),/同名/);
  assert.throws(()=>deleteGroup(s,'default'),/默认/); assert.throws(()=>editGroup(s,{id:'default',name:'改名'}),/默认/);
  assert.throws(()=>normalizeGroups({...defaultLibrary().groups,a:{id:'a',name:'a',parentId:'missing'}}),/父分组/);
  assert.throws(()=>normalizeGroups({a:{id:'a',name:'a',parentId:'b'},b:{id:'b',name:'b',parentId:'a'}}),/循环/);
});
test('deleting a subtree only moves records, undo preserves progress and later user moves',()=>{
  const s=fixture(),a=createGroup(s,{name:'课程'}).id,b=createGroup(s,{name:'前端',parentId:a}).id,c=createGroup(s,{name:'其他'}).id;
  s.videos[key].groupId=b;s.videos[key].positionSec=123;s.videos[key].bookmarks=[{id:'safe',sec:11}];s.videos['BV1xx411c7mD:12'].groupId=a;
  s.pending.x={url:'x',groupId:b};s.libraryUI.collapsedGroupIds=[a,b];
  const r=deleteGroup(s,a);assert.equal(Object.keys(s.videos).length,2);assert.equal(s.videos[key].groupId,'default');assert.equal(s.pending.x.groupId,'default');
  s.videos[key].positionSec=190;s.videos['BV1xx411c7mD:12'].groupId=c;restoreGroup(s,s.trash[r.undoId]);
  assert.equal(s.videos[key].groupId,b);assert.equal(s.videos[key].positionSec,190);assert.equal(s.videos[key].bookmarks[0].id,'safe');assert.equal(s.videos['BV1xx411c7mD:12'].groupId,c);assert.equal(s.pending.x.groupId,b);assert.deepEqual(s.libraryUI.collapsedGroupIds,[a,b]);
});
test('custom display names preserve original title, blank resets to current default',()=>{
  const s=fixture(),g=createGroup(s,{name:'课程'}).id,v=s.videos[key];v.positionSec=123;const original=defaultVideoName(v);
  editVideo(s,key,{displayName:'  我的   课程 ',groupId:g});assert.equal(videoName(v),'我的 课程');assert.equal(v.title,'原标题');assert.equal(v.positionSec,123);
  v.title='最新原标题';assert.equal(videoName(v),'我的 课程');editVideo(s,key,{displayName:'',groupId:g});assert.equal(videoName(v),'最新原标题 · P1 入门');assert.notEqual(videoName(v),original);
});
test('backups round trip groups, custom names, pending preferences and folds; old backups remain valid',()=>{
  const s=fixture(),a=createGroup(s,{name:'课程'}).id;editVideo(s,key,{groupId:a,displayName:'自定义'});s.libraryUI.collapsedGroupIds=[a];
  s.pending['https://b23.tv/abc123']={url:'https://b23.tv/abc123',groupId:a,displayName:'暂存',addedAt:1,attempts:1,nextRetryAt:3};
  const b=validateBackup(JSON.parse(JSON.stringify(s)));assert.equal(b.videos[key].displayName,'自定义');assert.equal(b.videos[key].groupId,a);assert.equal(b.pending['https://b23.tv/abc123'].displayName,'暂存');assert.deepEqual(b.libraryUI.collapsedGroupIds,[a]);
  delete s.groups; delete s.libraryUI;for(const v of Object.values(s.videos)) {delete v.groupId;delete v.displayName;}s.pending={};assert.equal(validateBackup(s).videos[key].groupId,'default');
});
test('import remaps colliding IDs with different names and preserves hierarchy',()=>{
  const s=emptyState();s.groups.x={id:'x',name:'本机',parentId:null,createdAt:1};const imported=emptyState();imported.groups.x={id:'x',name:'备份',parentId:null,createdAt:2};imported.groups.y={id:'y',name:'子组',parentId:'x',createdAt:3};
  const {mapping}=mergeGroups(s,imported);assert.notEqual(mapping.get('x'),'x');assert.equal(s.groups.y.parentId,mapping.get('x'));assert.equal(s.groups.x.name,'本机');
});
