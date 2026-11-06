// Paired v1.2 / v1.3 local-document benchmark. No user profile or live API needed.
async page => {
  const ctx=page.context(),versions={},assert=(v,m)=>{if(!v)throw Error(m);};
  for(const worker of ctx.serviceWorkers()){const version=await worker.evaluate(()=>chrome.runtime.getManifest().version);versions[version]={worker,origin:worker.url().replace('/background.js','')};}
  assert(versions['1.2.0']&&versions['1.3.0'],'Both versions required');
  const fixture=count=>{const now=Date.now(),videos={};for(let i=0;i<count;i++)videos[`BV1xx411c7mD:${i+11}`]={bvid:'BV1xx411c7mD',aid:2,cid:i+11,page:i+1,totalPages:count,partTitle:`第${i+1}讲`,title:'测试清单：从需求到界面',url:`https://www.bilibili.com/video/BV1xx411c7mD?p=${i+1}`,cover:'',duration:4200,ownerName:'演示',metaUpdatedAt:now,positionSec:600,maxPositionSec:600,completed:false,lastWatchedAt:now-i,bookmarks:[],addedAt:now-i,pinned:false,invalid:false};return{schemaVersion:1,videos,pending:{},trash:{},settings:{theme:'light',accentColor:'#0f766e',sampleIntervalSec:5,completionPercent:95,completionRemainingSec:30}};};
  const summary=values=>{const s=[...values].sort((a,b)=>a-b),r=n=>Math.round(n*10)/10;return{n:s.length,medianMs:r(s[Math.floor(s.length/2)]),p95Ms:r(s[Math.min(s.length-1,Math.ceil(s.length*.95)-1)]),maxMs:r(s.at(-1))};};
  const results={environment:'Chromium 158, paired alternating new MV3 documents, same disposable profile, warm browser/file cache, offline, no cover requests',startup:{},settings:{},interactions:{},errors:[]};
  await ctx.setOffline(true);
  try {
    for(const count of [3,1000,5000]){
      for(const v of Object.values(versions))await v.worker.evaluate(s=>chrome.storage.local.set({focusState:s}),fixture(count));
      const samples={'1.2.0':[],'1.3.0':[]},reads={'1.2.0':[],'1.3.0':[]},rows={'1.2.0':[],'1.3.0':[]};let rare=0;
      for(let i=0;i<15;i++)for(const version of i%2?['1.3.0','1.2.0']:['1.2.0','1.3.0']){
        const popup=await ctx.newPage();popup.on('pageerror',e=>results.errors.push(e.message));popup.on('request',r=>{if(r.url().includes('/assets/'))rare++;});
        await popup.addInitScript(()=>{window.__bench={ready:0,reads:0};const get=chrome.storage.local.get.bind(chrome.storage.local);chrome.storage.local.get=(...args)=>{window.__bench.reads++;return get(...args);};const observer=new MutationObserver(()=>{if(document.body?.dataset.ready==='true'){window.__bench.ready=performance.now();observer.disconnect();}});observer.observe(document,{subtree:true,attributes:true,attributeFilter:['data-ready']});});
        await popup.goto(`${versions[version].origin}/popup.html`);await popup.waitForFunction(()=>window.__bench.ready>0);const s=await popup.evaluate(()=>({...window.__bench,rows:document.querySelectorAll('.list-row,.group-row').length}));samples[version].push(s.ready);reads[version].push(s.reads);rows[version].push(s.rows);await popup.close();
      }
      assert(rare===0,'Rare assets requested on startup');results.startup[count]=Object.fromEntries(Object.keys(samples).map(v=>[v,{...summary(samples[v]),stateReads:[...new Set(reads[v])],initialRareRequests:rare,maxRenderedRows:Math.max(...rows[v])}]));
    }
    for(const version of ['1.2.0','1.3.0']){
      await versions[version].worker.evaluate(s=>chrome.storage.local.set({focusState:s}),fixture(3));const mounts=[],visible=[],reuse=[];
      for(let i=0;i<8;i++){
        const popup=await ctx.newPage();await popup.goto(`${versions[version].origin}/popup.html`);await popup.locator('body[data-ready=true]').waitFor();
        visible.push(await popup.evaluate(()=>{const t=performance.now();document.querySelector('#settings-toggle').click();return performance.now()-t;}));
        await popup.locator('#rare-theme-host[data-rare-state=ready]').waitFor();mounts.push(await popup.evaluate(()=>performance.getEntriesByName('rare-theme:first-mount')[0].duration));
        reuse.push(await popup.evaluate(()=>{document.querySelector('#settings-toggle').click();const t=performance.now();document.querySelector('#settings-toggle').click();return performance.now()-t;}));await popup.close();
      }
      results.settings[version]={panelVisibleHandler:summary(visible),firstRareMount:summary(mounts),reopenHandler:summary(reuse)};
    }
    for(const count of [1000,5000]){
      const s=fixture(count);s.groups={default:{id:'default',name:'默认分组',parentId:null,createdAt:0}};s.libraryUI={collapsedGroupIds:[]};
      // 100 groups, with five levels each, and all records assigned to leaf groups.
      for(let i=0;i<100;i++)s.groups[`g${i}`]={id:`g${i}`,name:`课程${i}`,parentId:i%5?`g${i-1}`:null,createdAt:i};Object.values(s.videos).forEach((v,i)=>{v.groupId=`g${Math.floor(i%100/5)*5+4}`;v.displayName=`视频 ${i}`;});
      await versions['1.3.0'].worker.evaluate(s=>chrome.storage.local.set({focusState:s}),s);const popup=await ctx.newPage();await popup.goto(`${versions['1.3.0'].origin}/popup.html`);await popup.locator('body[data-ready=true]').waitFor();
      const measurements=await popup.evaluate(async count=>{
        const frame=()=>new Promise(requestAnimationFrame),search=[],select=[];window.__long=[];const observer=new PerformanceObserver(l=>window.__long.push(...l.getEntries().map(e=>e.duration)));observer.observe({type:'longtask'});
        const searchEl=document.querySelector('#library-search'),list=document.querySelector('#list');
        const start=performance.now();list.scrollTop=list.scrollHeight;await frame();await frame();const scrollMs=performance.now()-start,renderedAtBottom=document.querySelectorAll('.list-row,.group-row').length;
        for(let i=0;i<12;i++) {const t=performance.now();searchEl.value=i%2?'':`视频 ${count-1}`;searchEl.dispatchEvent(new Event('input',{bubbles:true}));await frame();await frame();search.push(performance.now()-t);}
        searchEl.value=`视频 ${count-1}`;searchEl.dispatchEvent(new Event('input',{bubbles:true}));await frame();await frame();const lastVisible=[...document.querySelectorAll('.row-title')].some(e=>e.textContent===`视频 ${count-1}`);
        for(let i=0;i<12;i++){const t=performance.now();document.querySelector('.list-select').click();select.push(performance.now()-t);}
        observer.disconnect();return{scrollMs,renderedAtBottom,lastVisible,search,select,longTasks:window.__long};
      },count);
      assert(measurements.lastVisible&&measurements.renderedAtBottom<20,'Virtual list/search failed');results.interactions[count]={groups:100,depth:5,scrollToBottomMs:Math.round(measurements.scrollMs*10)/10,maxBottomRows:measurements.renderedAtBottom,searchToSecondFrame:summary(measurements.search),selectionHandler:summary(measurements.select),observedLongTasks:measurements.longTasks};await popup.close();
    }
    assert(results.errors.length===0,'Page errors');results.notes=['Navigation start to ready DOM, not toolbar creation overhead or OS cold boot.','15 paired samples per size; results depend on host load.','v1.2 paginates 10 rows, v1.3 virtualizes the continuous tree. Layout and data normalization also changed.','Rare UI is local and lazy. First settings mount includes React/chunk/CSS import and commit.','Search timing includes two headless animation frames; selection handler excludes transport and rendering.'];return results;
  } finally {await ctx.setOffline(false);}
}
