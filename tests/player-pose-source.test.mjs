import test from 'node:test';import assert from 'node:assert/strict';import {PlayerPoseSource} from '../player-pose-source.mjs';
async function fixture(run){
 const oldWorker=globalThis.Worker,oldBitmap=globalThis.createImageBitmap,created=[],bitmaps=[];
 globalThis.Worker=class{constructor(){this.sent=[];created.push(this);}postMessage(data){this.sent.push(data);if(data.type==='init')queueMicrotask(()=>this.onmessage({data:{type:'ready',delegate:'CPU'}}));}terminate(){this.terminated=true;}};
 globalThis.createImageBitmap=async()=>{const b={closed:0,close(){this.closed++;}};bitmaps.push(b);return b;};
 const states=[],results=[],s=new PlayerPoseSource(r=>results.push(r),(state)=>states.push(state));
 try{await run({s,states,results,created,bitmaps,video:{readyState:4,videoWidth:1280,videoHeight:720}});}finally{s.stop();globalThis.Worker=oldWorker;globalThis.createImageBitmap=oldBitmap;}
}
test('one Pose worker; 250ms cadence; at most one in-flight frame',()=>fixture(async({s,created,video,results})=>{await s.start();await s.tick(video,0);await s.tick(video,500);assert.equal(created[0].sent.filter(x=>x.type==='frame').length,1);created[0].onmessage({data:{type:'poses',time:0,inferenceMs:30,landmarks:[]}});await s.tick(video,100);assert.equal(created[0].sent.length,2);await s.tick(video,300);assert.equal(created[0].sent.length,3);assert.equal(results.length,1);}));
test('late results from stopped/replaced worker never reach app',()=>fixture(async({s,created,results})=>{await s.start();const old=created[0];await s.start();assert.equal(old.terminated,true);old.onmessage({data:{type:'poses',time:10,inferenceMs:1,landmarks:[[]]}});assert.equal(results.length,0);}));
test('bitmap completed after stop is closed without submission',()=>fixture(async({s,video,created})=>{await s.start();let resolve;globalThis.createImageBitmap=()=>new Promise(r=>resolve=r);const p=s.tick(video,300);s.stop();const b={closed:0,close(){this.closed++;}};resolve(b);await p;assert.equal(b.closed,1);assert.equal(created[0].sent.length,1);}));
test('failed transfer closes the untransferred bitmap and pauses source',()=>fixture(async({s,video,created,bitmaps,states})=>{await s.start();created[0].postMessage=()=>{throw Error('transfer');};await s.tick(video,300);assert.equal(bitmaps[0].closed,1);assert.equal(s.ready,false);assert.equal(states.at(-1),'failed');}));
test('worker error terminates processing instead of hand-only fallback',()=>fixture(async({s,created,states})=>{await s.start();created[0].onmessage({data:{type:'error'}});assert.equal(s.ready,false);assert.equal(created[0].terminated,true);assert.equal(states.at(-1),'failed');}));

test('CPU cadence reduces duty for a 100ms inference instead of running at 4fps',()=>fixture(async({s,video,created})=>{await s.start('CPU');await s.tick(video,0);created[0].onmessage({data:{type:'poses',time:0,inferenceMs:100,landmarks:[]}});await s.tick(video,250);assert.equal(created[0].sent.length,2);await s.tick(video,400);assert.equal(created[0].sent.length,3);}));

async function clocked(run){
 const oldSet=globalThis.setTimeout,oldClear=globalThis.clearTimeout,timers=[];
 globalThis.setTimeout=(fn,ms)=>{const t={fn,ms,cleared:false};timers.push(t);return t;};
 globalThis.clearTimeout=t=>{if(t&&typeof t==='object'&&'cleared'in t)t.cleared=true;else oldClear(t);};
 try{await run(timers);}finally{globalThis.setTimeout=oldSet;globalThis.clearTimeout=oldClear;}
}
test('unsettled bitmap capture times out and releases the Hand inference gate',()=>clocked(timers=>fixture(async({s,video,created,states})=>{
 await s.start();let resolve;globalThis.createImageBitmap=()=>new Promise(r=>resolve=r);
 const pending=s.tick(video,300);assert.equal(s.capturing,true);
 const watchdog=timers.filter(t=>t.ms===3000&&!t.cleared).at(-1);assert.ok(watchdog,'capture must be watched before bitmap settles');
 watchdog.fn();assert.equal(s.capturing,false);assert.equal(s.busy,false);assert.equal(s.ready,false);assert.equal(states.at(-1),'failed');assert.equal(created[0].terminated,true);
 const late={closed:0,close(){this.closed++;}};resolve(late);await pending;assert.equal(late.closed,1);assert.equal(created[0].sent.length,1);
})));
test('capture timeout and late bitmap cannot cancel a restarted Pose generation',()=>clocked(timers=>fixture(async({s,video,created,results})=>{
 await s.start();let resolve;globalThis.createImageBitmap=()=>new Promise(r=>resolve=r);const pending=s.tick(video,300);
 const watchdog=timers.filter(t=>t.ms===3000&&!t.cleared).at(-1);assert.ok(watchdog);watchdog.fn();await s.start();
 const late={closed:0,close(){this.closed++;}};resolve(late);await pending;
 assert.equal(s.ready,true);assert.equal(s.capturing,false);assert.equal(late.closed,1);assert.equal(created[1].terminated,undefined);assert.equal(results.length,0);
})));
test('successful capture replaces capture timeout with one inference timeout',()=>clocked(timers=>fixture(async({s,video})=>{
 await s.start();let resolve;globalThis.createImageBitmap=()=>new Promise(r=>resolve=r);const pending=s.tick(video,300);
 const capture=timers.filter(t=>t.ms===3000&&!t.cleared).at(-1);assert.ok(capture);
 resolve({close(){}});await pending;assert.equal(capture.cleared,true);assert.equal(s.capturing,false);assert.equal(s.busy,true);
 assert.equal(timers.filter(t=>t.ms===3000&&!t.cleared).length,1);
})));
