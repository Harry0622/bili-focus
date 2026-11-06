async page => {
  const ctx=page.context(), assert=(v,m)=>{if(!v)throw Error(m);};let worker;
  for(const w of ctx.serviceWorkers())if(await w.evaluate(()=>chrome.runtime.getManifest().version)==='1.3.0')worker=w;
  const origin=worker.url().replace('/background.js',''),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const state=()=>worker.evaluate(async()=> (await chrome.storage.local.get('focusState')).focusState);
  await worker.evaluate(async()=>{
    const s={schemaVersion:1,videos:{},pending:{},trash:{},groups:{default:{id:'default',name:'默认分组',parentId:null,createdAt:0}},libraryUI:{collapsedGroupIds:[]},settings:{theme:'light'}};s.groups.course={id:'course',name:'课程',parentId:null,createdAt:1};await chrome.storage.local.set({focusState:s});
    globalThis.__fetch=globalThis.fetch;globalThis.__fetchCalls=0;
    globalThis.fetch=async()=>{globalThis.__fetchCalls++;return new Response(JSON.stringify({code:0,data:{bvid:'BV1xx411c7mD',aid:2,title:'接口原标题',pic:'',owner:{name:'演示UP'},pages:[{cid:11,page:1,part:'入门',duration:600},{cid:12,page:2,part:'进阶',duration:800}]}}),{status:200,headers:{'content-type':'application/json'}});};
  });
  // A standalone extension test tab is itself the active tab. Emulate the tabs
  // query result that a toolbar popup receives while the Bili tab stays active.
  await page.addInitScript(()=>{chrome.tabs.query=async()=>[{id:1,url:'https://www.bilibili.com/video/BV1xx411c7mD?p=1'}];});
  try {
    await page.goto(`${origin}/popup.html`);await page.getByRole('button',{name:'添加第一个视频',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#add-current').disabled);
    assert(await page.locator('#current-name').inputValue()==='接口原标题 · P1 入门','Current title not prefilled');
    const layout=await page.evaluate(()=>{const b=s=>document.querySelector(s).getBoundingClientRect();return {buttonY:b('#add-current').y,buttonHeight:b('#add-current').height,linksY:b('#link-add-details').y,bodyHeight:document.body.offsetHeight};});assert(layout.buttonY<layout.linksY&&layout.buttonHeight>=44&&layout.bodyHeight===520,'Current-page priority layout');
    await page.screenshot({path:'output/playwright/v13-add-current.png'});await page.locator('#current-name').fill('我的课程');await page.locator('#current-group').selectOption('course');await page.locator('#entire').check();await page.getByRole('button',{name:'添加当前页',exact:true}).click();await page.waitForFunction(()=>chrome.storage.local.get('focusState').then(x=>Object.keys(x.focusState.videos).length===2));
    let s=await state();assert(Object.values(s.videos).every(v=>v.groupId==='course'&&v.displayName===`我的课程 · P${v.page}`),'All-P group/name failed');assert(await worker.evaluate(()=>globalThis.__fetchCalls)===1,'Save refetched metadata');
    await page.getByRole('button',{name:'＋ 添加视频',exact:true}).click();await page.locator('#link-add-details summary').click();await page.locator('#video-link').fill('https://www.bilibili.com/bangumi/play/ep1');await page.getByRole('button',{name:'读取链接信息',exact:true}).click();await page.locator('#add-error').filter({hasText:'暂不支持'}).waitFor();
    await page.locator('#video-link').fill('BV1xx411c7mD');await page.getByRole('button',{name:'读取链接信息',exact:true}).click();await page.locator('#link-fields').waitFor();assert(await page.locator('#link-name').inputValue()==='接口原标题 · P1 入门','Link default not prefilled');await page.locator('#link-name').fill('');await page.getByRole('button',{name:'保存链接视频',exact:true}).click();
    s=await state();assert(s.videos['BV1xx411c7mD:11'].displayName==='我的课程 · P1'&&s.videos['BV1xx411c7mD:11'].groupId==='course','Duplicate overwrote saved name/group');
    await page.getByRole('button',{name:'编辑名称和分组',exact:true}).first().click();await page.locator('#record-name').fill('');await page.locator('#record-group').selectOption('default');await page.getByRole('button',{name:'保存修改',exact:true}).click();await page.waitForFunction(()=>chrome.storage.local.get('focusState').then(x=>Object.values(x.focusState.videos).some(v=>v.groupId==='default'&&v.displayName==='')));
    assert(errors.length===0,errors.join(','));return {layout,errors,features:['current page prefill/save','group selection','custom batch names','no redundant metadata refetch','link preview and default name','unsupported link','dedupe preserves existing name/group','empty name restores default']};
  } finally { await worker.evaluate(()=>{globalThis.fetch=globalThis.__fetch;delete globalThis.__fetch;delete globalThis.__fetchCalls;}); }
}
