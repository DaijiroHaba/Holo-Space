import {createRequire} from 'node:module';import {writeFile,mkdir} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const baseUrl=(process.env.HOLO_TEST_URL||'http://127.0.0.1:8796').replace(/\/$/,'');
const require=createRequire(import.meta.url),{chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const browser=await chromium.launch({headless:true,channel:'msedge',args:['--use-fake-device-for-media-stream','--enable-unsafe-swiftshader']});
const checks=[],errors=[],external=[];let failure,page;
const pass=name=>{checks.push({name,status:'PASS'});console.log('PASS '+name);};const near=(a,b,e=.003)=>assert.ok(Math.abs(a-b)<e,`${a} vs ${b}`);
try{
 const context=await browser.newContext({viewport:{width:1440,height:960},permissions:['camera']});page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(baseUrl))external.push(r.url());});
 await page.route('**/vendor/vision_bundle.mjs',r=>r.fulfill({contentType:'text/javascript',body:"export const FilesetResolver={forVisionTasks:async()=>({})};export const HandLandmarker={createFromOptions:async()=>({detectForVideo:()=>({landmarks:[],handedness:(window.__sides||[]).map(side=>[{categoryName:side,score:1}])}),detect:()=>{window.__roiCalls=(window.__roiCalls||0)+1;const r=window.__roiRect,v=document.getElementById('camera');if(!r)return{landmarks:[]};return {landmarks:(window.__hands||[]).filter(h=>h[0].x*v.videoWidth>=r.left&&h[0].x*v.videoWidth<=r.left+r.width&&h[0].y*v.videoHeight>=r.top&&h[0].y*v.videoHeight<=r.top+r.height).map(h=>h.map((p,i)=>({...p,x:window.__roiOutside&&i===4?-.05:(p.x*v.videoWidth-r.left)/r.width,y:(p.y*v.videoHeight-r.top)/r.height})))}},close(){}})};export const PoseLandmarker={createFromOptions:async()=>({detectForVideo:()=>{if(window.__noPose)return {landmarks:[]};const p=Array.from({length:33},()=>({x:.5,y:.55,z:0,visibility:1}));p[11]={x:.4,y:.35,visibility:1};p[12]={x:.6,y:.35,visibility:1};p[15]={x:.3,y:.5,visibility:0};p[16]={x:.7,y:.5,visibility:0};(window.__hands||[]).forEach((h,i)=>{const side=window.__sides?.[i]||'Left';if(side==='Left')p[15]={...h[0],visibility:1};if(side==='Right')p[16]={...h[0],visibility:1};});return {landmarks:[p]};},close(){}})};"}));

 await page.addInitScript(()=>{
  const NativeWorker=window.Worker;
  function pose(x=.5){const p=Array.from({length:33},()=>({x,y:.3,z:0,visibility:0}));for(const [i,dx,dy]of[[0,0,-.1],[11,-.08,0],[12,.08,0],[13,-.1,.12],[14,.1,.12],[15,-.12,.27],[16,.12,.27],[23,-.07,.32],[24,.07,.32]])p[i]={x:x+dx,y:.23+dy,z:0,visibility:1};return p;}
  window.Worker=function(url,opts){
   if(!String(url).includes('player-pose-worker'))return new NativeWorker(url,opts);
   const fake={onmessage:null,onerror:null,terminated:false,terminate(){this.terminated=true;},postMessage(data){
    if(data.type==='init'){window.__poseStarts=(window.__poseStarts||0)+1;setTimeout(()=>{if(!this.terminated)this.onmessage?.({data:{type:'ready',delegate:'CPU'}});},10);return;}
    if(data.type==='frame'){
     data.bitmap.close();let a=pose(window.__bodyShift ? .82 : .48),b=pose(window.__cross?.515:.86);
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

await page.addInitScript(()=>{const draw=CanvasRenderingContext2D.prototype.drawImage;CanvasRenderingContext2D.prototype.drawImage=function(...a){if(a[0]?.tagName==='VIDEO'&&a.length===9&&this.canvas.width===384)window.__roiRect={left:a[1],top:a[2],width:a[3],height:a[4]};return draw.apply(this,a);};}); await page.goto(baseUrl+'/',{waitUntil:'domcontentloaded',timeout:60000});await page.waitForFunction(()=>window.holoSnapshot?.().anatomy.ready,null,{timeout:60000});
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
 const p={x:700,y:230,side:'Left',size:.25};await rawHands([p],120);
 await page.waitForFunction(()=>holoSnapshot().rescueHands>0,null,{timeout:5000});assert.equal((await snap()).fullFrameHands,0);pass('Wrist ROI can detect small hands even when full-frame detector sees zero');
 await page.waitForFunction(()=>holoSnapshot().player.ready&&holoSnapshot().trackedHands===1,null,{timeout:5000});pass('Single-player selection and main-hand enrollment complete from ROI-only hand input');
 await page.evaluate(()=>window.__bodyShift=true);await tick(350);assert.equal((await snap()).player.state,'holding');const kept=(await snap()).objects;assert.ok((await snap()).rescueReady);pass('Large body-position outlier holds model instead of deleting player');
 await rawHands([p],1800);await page.waitForFunction(()=>holoSnapshot().player.ready&&holoSnapshot().trackedHands===1,null,{timeout:5000});assert.deepEqual((await snap()).objects,kept);pass('Held/lost player can re-confirm with ROI open palm without a mouse or transform jump');
 await page.evaluate(()=>window.__roiOutside=true);await tick(400);assert.equal((await snap()).rescueHands,0);assert.equal((await snap()).gripping,null);pass('Out-of-crop gesture joint stays invalid before remapping');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);pass('No page errors or external requests');
}catch(e){failure=e;console.error(e);if(page){console.error(JSON.stringify(await page.evaluate(()=>window.holoSnapshot?.()).catch(()=>null)));await page.screenshot({path:'tests/results/large-roi-failure-synthetic.png'}).catch(()=>{});}}
finally{await mkdir('tests/results',{recursive:true});await writeFile('tests/results/large-roi-browser.json',JSON.stringify({checks,errors,externalRequests:external,failure:failure?.stack||null,physicalCameraVerified:false},null,2));await browser.close();}if(failure)process.exitCode=1;
