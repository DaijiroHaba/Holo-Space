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





 await page.evaluate(()=>window.__solo=true);await page.locator('#start').click();await page.waitForFunction(()=>holoSnapshot().mode==='camera');
 const p={x:620,y:350,side:'Left'},q={x:850,y:350,side:'Right'};await hands([p,q],1800);
 await page.waitForFunction(()=>holoSnapshot().player.ready&&holoSnapshot().trackedHands===2);
 await page.evaluate(()=>document.querySelector('[data-action=summon-whole]').click());const before=(await snap()).objects;pass('Player locks and anatomy is available before capture fault');
 await page.evaluate(()=>{
  const original=window.createImageBitmap.bind(window);window.__lateCaptures=[];window.__lateClosed=0;window.__hangCapture=true;
  window.createImageBitmap=(...args)=>window.__hangCapture&&args[0]?.tagName==='VIDEO'?new Promise(resolve=>window.__lateCaptures.push(async()=>{const b=await original(...args);resolve({close(){b.close();window.__lateClosed++;}});})):original(...args);
 });
 await page.waitForFunction(()=>holoSnapshot().diagnostics.recognition.pose==='failed',null,{timeout:6500});
 assert.equal((await snap()).trackedHands,0);assert.equal((await snap()).gripping,null);assert.deepEqual((await snap()).objects,before);assert.equal((await snap()).cameraActive,true);pass('Unsettled capture times out, stops manipulation and preserves camera/models');
 const paused=await snap();await tick(450);const running=await snap();assert.ok(running.diagnostics.performance.frameCount>paused.diagnostics.performance.frameCount);assert.ok(running.timing.inferenceMs.samples>paused.timing.inferenceMs.samples);assert.deepEqual(running.objects,before);pass('Rendering and Hand detection continue safely after capture gate is released');
 await page.evaluate(()=>window.__hangCapture=false);await page.locator('[data-action=diagnostics]').first().click();await page.locator('[data-action=recognition-auto]').click();
 await hands([p,q],2100);await page.waitForFunction(()=>holoSnapshot().player.ready&&holoSnapshot().trackedHands===2,null,{timeout:7000});assert.deepEqual((await snap()).objects,before);assert.equal((await snap()).gripping,null);pass('Existing recognition retry restores fresh player/hand input without moving models');
 const epoch=(await snap()).player.epoch,starts=await page.evaluate(()=>window.__poseStarts);
 await page.evaluate(async()=>{for(const resolve of window.__lateCaptures)await resolve();});await tick(400);
 assert.equal(await page.evaluate(()=>window.__lateClosed),1);assert.equal(await page.evaluate(()=>window.__poseStarts),starts);assert.equal((await snap()).player.epoch,epoch);assert.equal((await snap()).player.ready,true);assert.deepEqual((await snap()).objects,before);pass('Late bitmap from timed-out generation is closed without disrupting the replacement worker');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);pass('No browser errors or external requests');
}catch(e){failure=e;console.error(e);if(page)console.error(JSON.stringify(await page.evaluate(()=>window.holoSnapshot?.()).catch(()=>null)));}
finally{await mkdir('tests/results',{recursive:true});await writeFile('tests/results/audit-recovery-browser.json',JSON.stringify({checks,errors,externalRequests:external,failure:failure?.stack||null,physicalCameraVerified:false},null,2));await browser.close();}if(failure)process.exitCode=1;
