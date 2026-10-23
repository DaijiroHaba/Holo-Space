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

 await page.goto(baseUrl+'/');await page.waitForFunction(()=>window.holoSnapshot?.().anatomy.ready,null,{timeout:60000});
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




 await page.evaluate(()=>window.__solo=true);
 await page.locator('#start').click();await page.waitForFunction(()=>holoSnapshot().mode==='camera');
 let p={x:620,y:350,side:'Left'},q={x:850,y:350,side:'Right'};
 await hands([p,q],1700);assert.equal((await snap()).player.state,'locked');assert.equal((await snap()).player.automatic,true);assert.equal((await snap()).player.duplicatePoses,1);pass('Duplicate single-person Pose automatically locks without clicking candidate or confirm');
 await hands([p,q],3400);assert.equal((await snap()).menu,true);pass('Automatic player open palm summons original menu');
 await tapButton('#summon-menu [data-action=summon-whole]');assert.equal((await snap()).stage,'workspace');pass('Single hand tap summons anatomy after automatic selection');
 await hands([p,q],300);await page.waitForFunction(()=>holoSnapshot().player.ready&&!holoSnapshot().player.blocked&&holoSnapshot().trackedHands===2&&holoSnapshot().operator.mainId!==null,null,{timeout:6000});const beforeOrder=(await snap()).operator.mainId;await page.evaluate(()=>window.__reversePeople=true);await hands([q,p],600);assert.equal((await snap()).operator.mainId,beforeOrder);assert.equal((await snap()).player.state,'locked');pass('People/hand array permutations keep selected body and main hand');
 const icon=await buttonPoint('#mode-rotate');await hands([p,{...icon,side:'Visitor'}],250);await hands([p,{...icon,side:'Visitor',closed:true}],120);await hands([p,{...icon,side:'Visitor'}],200);assert.equal((await snap()).operation,'place');pass('Bystander tap cannot switch mode');
 p={...await modelPoint('single'),side:'Left'};await hands([p,q],450);await hands([{...p,closed:true},q],220);assert.equal((await snap()).gripping,'single');const held=(await snap()).objects.single;await hands([{...p,x:p.x+30,closed:true},q],180);assert.ok((await snap()).objects.single.x>held.x);pass('Selected main pinch grabs and moves anatomy');
 await page.evaluate(()=>window.__noPose=true);await tick(450);const frozen=(await snap()).objects.single;assert.equal((await snap()).gripping,null);assert.equal((await snap()).player.state,'holding');const frameAt=(await snap()).diagnostics.performance.frameCount;await tick(300);assert.ok((await snap()).diagnostics.performance.frameCount>frameAt);assert.deepEqual((await snap()).objects.single,frozen);pass('Pose loss releases active grip, preserves transform and keeps RAF alive');
 await page.evaluate(()=>window.__noPose=false);await tick(1100);assert.equal((await snap()).player.state,'locked');assert.equal((await snap()).gripping,null);await hands([{...p,x:p.x+30,closed:true},q],500);assert.equal((await snap()).gripping,null);assert.deepEqual((await snap()).objects.single,frozen);pass('Stable reacquisition while pinched does not resume or jump');
 await hands([p,q],400);await hands([{...p,closed:true},q],250);assert.equal((await snap()).gripping,'single');await hands([p,q],220);assert.equal((await snap()).gripping,null);pass('Release then a new pinch can re-grab and place');
 const rotationButton=await buttonPoint('#mode-rotate');await tapButton('#mode-rotate');assert.equal((await snap()).operation,'rotate');for(let i=1;i<=12;i++)await hands([{...p,x:rotationButton.x+(p.x-rotationButton.x)*i/12,y:rotationButton.y+(p.y-rotationButton.y)*i/12}],70);await hands([p],400);let rot=(await snap()).objects.single.rotation;for(let i=1;i<=5;i++)await hands([{...p,x:p.x+i*7}],60);p={...p,x:p.x+35};assert.ok(Math.abs((await snap()).objects.single.rotation-rot)>.05);await hands([{...p,fist:true,closed:true}],250);assert.equal((await snap()).operation,'inspect');const fixed=(await snap()).objects.single.rotation;await hands([p],300);assert.equal((await snap()).objects.single.rotation,fixed);pass('Palm rotation and main-fist brake retain fixed angle');
 p={...await modelPoint('single'),side:'Left'};q={x:p.x+230,y:p.y,side:'Right'};await hands([p,q],450);await hands([{...p,closed:true},q],230);await hands([{...p,closed:true},{...q,closed:true}],230);assert.equal((await snap()).trackedHands,2);assert.equal((await snap()).gripping,'single');let zoom=(await snap()).objects.single;for(let i=1;i<=3;i++)await hands([{...p,x:p.x-i*9,closed:true},{...q,x:q.x+i*9,closed:true}],70);assert.ok((await snap()).objects.single.scale>zoom.scale);assert.equal((await snap()).objects.single.rotation,zoom.rotation);pass('Two owned wrists join sequentially, zoom without angle drift');
 await page.evaluate(()=>window.__missingWrist=true);await tick(450);assert.equal((await snap()).gripping,null);await page.evaluate(()=>window.__missingWrist=false);await hands([p,q],450);assert.equal((await snap()).gripping,null);pass('One Pose wrist loss cancels bimanual capture and never substitutes bystander');


 await hands([p,q],800);const beforePause=(await snap()).objects;
 await page.evaluate(()=>{window.__tabHidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__tabHidden});document.dispatchEvent(new Event('visibilitychange'));});
 await tick(2500);assert.equal((await snap()).player.suspended,true);assert.deepEqual((await snap()).objects,beforePause);pass('Background pause preserves player and transforms without stale gestures');
 await page.evaluate(()=>{window.__tabHidden=false;document.dispatchEvent(new Event('visibilitychange'));});
 await hands([{...p,closed:true},{...q,closed:true}],500);assert.equal((await snap()).gripping,null);
 await hands([p,q],1300);assert.equal((await snap()).player.state,'locked');assert.equal((await snap()).gripping,null);assert.deepEqual((await snap()).objects,beforePause);pass('Foreground return requires fresh player observations and release, without model jump');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);pass('No browser errors or external assets');
}catch(e){failure=e;console.error(e);if(page){console.error(JSON.stringify(await page.evaluate(()=>window.holoSnapshot?.()).catch(()=>null)));await page.screenshot({path:'tests/results/player-auto-failure-synthetic.png'}).catch(()=>{});}}
finally{await mkdir('tests/results',{recursive:true});await writeFile('tests/results/player-auto-browser.json',JSON.stringify({checks,errors,externalRequests:external,failure:failure?.stack||null,physicalCameraVerified:false},null,2));await browser.close();}if(failure)process.exitCode=1;
