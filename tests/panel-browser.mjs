import {createRequire} from 'node:module';import {writeFile,mkdir} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const baseUrl=(process.env.HOLO_TEST_URL||'http://127.0.0.1:8796').replace(/\/$/,'');
const require=createRequire(import.meta.url),{chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const browser=await chromium.launch({headless:true,channel:'msedge',args:['--use-fake-device-for-media-stream','--enable-unsafe-swiftshader']});
const checks=[],errors=[],external=[];let failure,page;
const pass=name=>{checks.push({name,status:'PASS'});console.log('PASS '+name);};const near=(a,b,e=.003)=>assert.ok(Math.abs(a-b)<e,`${a} vs ${b}`);
try{
 const context=await browser.newContext({viewport:{width:1440,height:960},permissions:['camera']});page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(baseUrl))external.push(r.url());});
 await page.route('**/vendor/vision_bundle.mjs',r=>r.fulfill({contentType:'text/javascript',body:"export const FilesetResolver={forVisionTasks:async()=>({})};export const HandLandmarker={createFromOptions:async()=>({detectForVideo:()=>({landmarks:window.__hands||[],handedness:(window.__sides||[]).map(side=>[{categoryName:side,score:1}])}),detect:()=>({landmarks:[]}),close(){}})};export const PoseLandmarker={createFromOptions:async()=>({detectForVideo:()=>{if(window.__noPose)return {landmarks:[]};const p=Array.from({length:33},()=>({x:.5,y:.55,z:0,visibility:1}));p[11]={x:.4,y:.35,visibility:1};p[12]={x:.6,y:.35,visibility:1};p[15]={x:.3,y:.5,visibility:0};p[16]={x:.7,y:.5,visibility:0};(window.__hands||[]).forEach((h,i)=>{const side=window.__sides?.[i]||'Left';if(side==='Left')p[15]={...h[0],visibility:1};if(side==='Right')p[16]={...h[0],visibility:1};});return {landmarks:[p]};},close(){}})};"}));

 await page.addInitScript(()=>{
  const NativeWorker=window.Worker;
  function pose(x=.5){const p=Array.from({length:33},()=>({x,y:.3,z:0,visibility:0}));for(const [i,dx,dy]of[[0,0,-.1],[11,-.08,0],[12,.08,0],[13,-.1,.12],[14,.1,.12],[15,-.12,.27],[16,.12,.27],[23,-.07,.32],[24,.07,.32]])p[i]={x:x+dx,y:.23+dy,z:0,visibility:1};return p;}
  window.Worker=function(url,opts){
   if(!String(url).includes('player-pose-worker'))return new NativeWorker(url,opts);
   const fake={onmessage:null,onerror:null,terminated:false,terminate(){this.terminated=true;},postMessage(data){
    if(data.type==='init'){window.__poseStarts=(window.__poseStarts||0)+1;setTimeout(()=>{if(!this.terminated)this.onmessage?.({data:{type:'ready',delegate:'CPU'}});},10);return;}
    if(data.type==='frame'){
     data.bitmap.close();let a=pose(window.__cross?.5:.48),b=pose(window.__cross?.515:.86);
     for(const [i,side]of[[15,'Left'],[16,'Right']]){const h=(window.__hands||[]).find((_,j)=>window.__sides?.[j]===side);if(h)a[i]={...h[0],visibility:1};else a[i].visibility=0;}
     const extras=(window.__hands||[]).filter((_,j)=>window.__sides?.[j]==='Visitor');
     extras.forEach((h,j)=>b[j?16:15]={...h[0],visibility:1});
     if(window.__missingShoulder)a[11].visibility=0;
     if(window.__missingWrist)a[15].visibility=0;
     let people=window.__noPose?[]:window.__solo?[a,structuredClone(a)]:window.__reversePeople?[b,a]:[a,b];
     if(window.__invalidPose)people='invalid';
     setTimeout(()=>{if(!this.terminated)this.onmessage?.({data:{type:window.__poseError?'error':'poses',time:window.__stalePose?data.time-5000:data.time,inferenceMs:8,landmarks:people}});},window.__poseDelay||5);
    }
   }};return fake;
  };
 });

 await page.goto(baseUrl+'/',{waitUntil:'domcontentloaded',timeout:60000});await page.waitForFunction(()=>window.holoSnapshot?.().anatomy.ready,null,{timeout:60000});
 const snap=()=>page.evaluate(()=>holoSnapshot()),tick=ms=>page.waitForTimeout(ms),buttonPoint=async selector=>{const b=await page.locator(selector).boundingBox();assert.ok(b,selector);return {x:b.x+b.width/2,y:b.y+b.height/2};};
 async function rawHands(specs,ms=130,expectPinch=true){await page.evaluate(specs=>{const lab=document.getElementById('lab'),v=document.getElementById('camera'),scale=Math.min(lab.clientWidth/v.videoWidth,lab.clientHeight/v.videoHeight),ox=(lab.clientWidth-v.videoWidth*scale)/2,oy=(lab.clientHeight-v.videoHeight*scale)/2;window.__sides=specs.map((s,i)=>s.side|| (i===0?'Left':'Right'));window.__hands=specs.map(({x,y,closed=false,size=1,fist=false,fingerShift=0,oblique=false,curl=0})=>{const ix=1-(x-ox)/(v.videoWidth*scale),iy=(y-oy)/(v.videoHeight*scale),w={x:ix+.02,y:iy+.24,z:0};const p=Array.from({length:21},()=>({...w}));p[1]={x:ix-.035,y:iy+.21,z:0};p[2]={x:ix-.07,y:iy+.16,z:0};p[3]={x:ix-.085,y:iy+.12,z:0};p[4]={x:ix+(closed?.005:-.12),y:iy+(closed?.005:.07),z:0};for(let f=0;f<4;f++){const m=5+f*4,fx=ix+f*.04;for(let j=0;j<4;j++)p[m+j]={x:fx,y:iy+.14-j*.047,z:0};if(fist||(f>0&&f<=curl)){p[m+2]={x:fx,y:iy+.18,z:0};p[m+3]={x:fx,y:iy+.215,z:0};}}if(fist&&closed)p[4]={...p[8],x:p[8].x+.003};if(closed&&fingerShift){p[4].x-=fingerShift/(v.videoWidth*scale);p[8].x-=fingerShift/(v.videoWidth*scale);}const center=[0,5,9,13,17].reduce((a,i)=>({x:a.x+p[i].x/5,y:a.y+p[i].y/5}),{x:0,y:0});return p.map(q=>({x:center.x+(q.x-center.x)*size,y:center.y+(q.y-center.y)*size,z:oblique?(q.x-center.x)*2:0}));});},specs);await tick(ms+180);}

 let previous=[];
 async function hands(specs,ms=130){
  const deltas=specs.map(s=>{const old=previous.find(p=>p.side===s.side)||previous[specs.indexOf(s)];return old?{s,old,d:Math.hypot(s.x-old.x,s.y-old.y)}:{s,old:s,d:0};});
  const steps=Math.ceil(Math.max(0,...deltas.map(v=>v.d))/32);
  if(steps>1)for(let k=1;k<steps;k++)await rawHands(deltas.map(({s,old})=>({...s,x:old.x+(s.x-old.x)*k/steps,y:old.y+(s.y-old.y)*k/steps,closed:old.closed??false})), -155);
  await rawHands(specs,ms);previous=[...previous.filter(p=>!specs.some(s=>s.side===p.side)),...specs];
 }

 async function tapAt(p){p={...p,side:'Left'};await hands([p],200);await hands([{...p,closed:true}],100);await hands([p],180);}
 const tapButton=async selector=>{await hands([],120);await tick(320);await tapAt(await buttonPoint(selector));};
 async function modelPoint(id){const b=(await snap()).renderSpace.projection[id];assert.ok(b?.visible,id);return {x:(b.left+b.right)/2,y:b.top+(b.bottom-b.top)*.36};}





 await page.locator('aside.intro [data-action=open-menu]').click();await page.locator('#summon-menu [data-action=summon-whole]').click();
 const panel=page.locator('#mode-controls'),handle=page.locator('#mode-handle');
 const rect=()=>panel.boundingBox();const frozen=(await snap()).objects;
 async function dragPanel(x,y){const b=await handle.boundingBox(),r=await rect(),dx=b.x+30-r.x,dy=b.y+b.height/2-r.y;await page.mouse.move(r.x+dx,r.y+dy);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:8});await page.mouse.up();await tick(120);return rect();}
 let r=await dragPanel(20,40);near(r.x,20,2);near(r.y,40,2);pass('Mouse can move palette to left/top without central safe-zone clamp');
 r=await dragPanel(1440-r.width-12,960-r.height-12);near(r.x+r.width,1428,2);near(r.y+r.height,948,2);pass('Palette reaches right/bottom while the entire panel stays visible');
 const placed=await rect();await tick(250);assert.deepEqual(await rect(),placed);assert.deepEqual((await snap()).objects,frozen);pass('Release preserves panel placement without moving the anatomy or floating slate');
 await page.setViewportSize({width:1000,height:820});await tick(180);r=await rect();assert.ok(r.x>=7&&r.y>=7&&r.x+r.width<=993&&r.y+r.height<=813);await page.setViewportSize({width:1440,height:960});await tick(180);pass('Resize keeps the panel inside the screen');
 await page.locator('#controls-reset').click();r=await rect();assert.ok(r.x>1000&&r.y<200);assert.deepEqual((await snap()).objects,frozen);pass('Independent panel recovery returns only the palette to the edge');
 await page.locator('#immersive').click();assert.equal(await page.locator('#controls-reset').isVisible(),true);await page.locator('#controls-reset').click();await page.locator('#restore-ui').click();pass('Panel recovery remains available in immersive mode');
 await page.evaluate(()=>window.__solo=true);await page.locator('#start').click();await page.waitForFunction(()=>holoSnapshot().mode==='camera');
 await hands([{x:620,y:260,side:'Left'}],1800);await page.waitForFunction(()=>holoSnapshot().player.ready&&holoSnapshot().trackedHands===1);
 await page.locator('#player-launcher').click();await page.locator('#player-reselect').click({trial:true});await page.locator('#player-launcher').click();pass('Player settings remain clickable above a freely positioned palette');
 await tapButton('#mode-inspect');assert.equal((await snap()).operation,'inspect');pass('Default palette can be selected by the main hand before repositioning');
 await dragPanel(500,140);r=await handle.boundingBox();let p={x:r.x+32,y:r.y+r.height/2,side:'Left'};await hands([p],250);await hands([{...p,closed:true}],220);assert.equal((await snap()).gripping,'controls');
 for(let i=1;i<=6;i++)await hands([{...p,x:p.x-32*i,y:p.y+45*i,closed:true}],50);
 await hands([{...p,x:p.x-192,y:p.y+270}],220);assert.equal((await snap()).gripping,null);r=await rect();assert.ok(r.y>380,JSON.stringify(r));const handPlaced=await rect();await tick(300);assert.deepEqual(await rect(),handPlaced);assert.deepEqual((await snap()).objects,frozen);pass('Main-hand pinch drags below the former limit, then releases and retains placement');
 await page.locator('#mirror-toggle').click();await tick(200);assert.deepEqual(await rect(),handPlaced);await page.locator('#mirror-toggle').click();await page.locator('#fullscreen').click();await tick(200);r=await rect();const size=await page.evaluate(()=>({w:document.getElementById('lab').clientWidth,h:document.getElementById('lab').clientHeight}));assert.ok(r.x>=7&&r.y>=7&&r.x+r.width<=size.w-7&&r.y+r.height<=size.h-7);await page.evaluate(()=>document.exitFullscreen());pass('Mirror and fullscreen preserve reachable panel placement');
 await page.locator('#controls-reset').click();await page.screenshot({path:'tests/results/panel-workspace-synthetic.png'});
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);pass('No browser errors or external requests');
}catch(e){failure=e;console.error(e);if(page)console.error(JSON.stringify(await page.evaluate(()=>window.holoSnapshot?.()).catch(()=>null)));}
finally{await mkdir('tests/results',{recursive:true});await writeFile('tests/results/panel-browser.json',JSON.stringify({checks,errors,externalRequests:external,failure:failure?.stack||null,physicalCameraVerified:false},null,2));await browser.close();}if(failure)process.exitCode=1;
