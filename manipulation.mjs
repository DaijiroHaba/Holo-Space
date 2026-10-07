import {PalmDepthCue,applyDepth} from './depth-controller.mjs?v=0.12';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const angleDelta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
// One caller-owned object. Mode, hand count and identity changes rebase.
export class Manipulator {
 constructor(){this.reset();}
 reset(){this.previous=null;this.time=null;this.velocity={x:0,y:0};this.coast=0;this.cues=new Map();this.depthLock=0;this.stopped=false;this.palmReadyAt=null;this.palmID=null;}
 stop(){this.reset();this.stopped=true;}
 result(phase,state=null){return {phase,state,stopped:this.stopped};}
 update(hands,time,{state,key,aspect=1,worldPerX=8,worldPerY=5,enabled=true,operation='place',maxScale=64,minScale=.2}={}){
  if(key==='panel'){state={...state,rotation:0,tilt:0,roll:0};operation=['dual','inspect'].includes(operation)?'inspect':operation==='depth'?'depth':'place';}
  if(!enabled||!key||!state){this.reset();return this.result('unselected');}
  if(this.stopped)return this.result('stopped');
  if(!hands.length){this.reset();return this.result('placed');}
  if(operation!=='rotate'&&hands.every(h=>h.fist)){this.stop();return this.result('stopped');}
  const gap=this.time===null?0:time-this.time;
  if(gap<=0||gap>200)this.reset();this.time=time;
  hands=[...hands].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  const closed=hands.filter(h=>h.down),h=hands.find(h=>h.id===this.palmID)||hands[0];
  if(operation==='rotate'){
   this.palmID=h.id;
   const facing=(h.palmOpen??h.open)&&h.depthQuality>=(this.palmReadyAt===null?.75:.60);
   if(!facing){this.previous=null;this.palmReadyAt=null;return this.result('palm-clutch');}
   if(this.palmReadyAt===null)this.palmReadyAt=time+120;
  }else{this.palmReadyAt=null;this.palmID=null;}
  const branch=operation==='rotate'?'rotate':operation==='depth'?(h.open?'depth':'paused'):['dual','inspect'].includes(operation)?(closed.length===2?'dual':closed.length===1?'drag':'paused'):operation==='place'?(closed.length?'drag':'paused'):'paused';
  const used=operation==='rotate'||operation==='depth'?[h]:['dual','inspect'].includes(operation)&&closed.length?closed:closed.length?[closed[0]]:[h],cx=used.reduce((s,h)=>s+h.px,0)/used.length,cy=used.reduce((s,h)=>s+h.py,0)/used.length;
  const dx=used.length===2?(used[1].px-used[0].px)*aspect:0,dy=used.length===2?used[1].py-used[0].py:0;
  const sample={signature:`${key}:${operation}:${branch}:${used.map(h=>h.id).join(',')}`,cx,cy,distance:Math.hypot(dx,dy),roll:Math.atan2(-dy,dx),points:used.map(h=>({x:h.px,y:h.py})),palmYaw:h.palmYaw||0,palmPitch:h.palmPitch||0,palmRoll:h.palmRoll||0,yaw:0,depthReady:false,handSign:Math.sign(dx)||1};
  const prev=this.previous;this.previous=sample;
  if(!prev||prev.signature!==sample.signature){this.cues.clear();this.velocity={x:0,y:0};this.coast=0;this.depthLock=0;return this.result(branch==='rotate'?'ready':branch);}
  if(sample.points.some((p,i)=>Math.hypot(p.x-prev.points[i].x,p.y-prev.points[i].y)>.14)){this.cues.clear();this.velocity={x:0,y:0};this.coast=0;return this.result('reacquire');}
  // When hands meet/cross, their connecting axis and identity are ambiguous.
  // Freeze, then rebase after separation instead of applying a 180-degree turn.
  if(used.length===2&&(sample.distance<.09||prev.distance<.09)){this.cues.clear();return this.result('paused');}
  if(branch==='dual'&&Math.abs(dx)>.08&&sample.handSign!==prev.handSign){this.cues.clear();return this.result('reacquire');}
  sample.handSign=prev.handSign;
  const dt=clamp(gap/1000,.001,.08),mx=cx-prev.cx,my=cy-prev.cy;
  if(branch==='rotate'){
   if(time<this.palmReadyAt)return this.result('palm-ready');
   const ay=angleDelta(sample.palmYaw,prev.palmYaw),ap=angleDelta(sample.palmPitch,prev.palmPitch),ar=angleDelta(sample.palmRoll,prev.palmRoll);
   if(Math.max(Math.abs(ay),Math.abs(ap),Math.abs(ar))>.25)return this.result('reacquire');
   const dead=(v,d)=>Math.abs(v)>d?v:0;
   const rx=dead(mx,.0015)*7+dead(ay,.008)*.55,ry=dead(my,.0015)*6+dead(ap,.008)*.55,rz=dead(ar,.008)*.65;
   if(!rx&&!ry&&!rz)return this.result('palm-ready');
   return this.result('rotate',{...state,rotation:state.rotation+rx,tilt:state.tilt+ry,roll:state.roll+rz});
  }
  this.velocity={x:0,y:0};this.coast=0;
  if(!['drag','zoom','dual','depth'].includes(branch)){this.cues.clear();return this.result('paused');}
  let next={...state};
  if(branch==='drag'||branch==='dual'||branch==='depth'){next.x=clamp(state.x+mx*worldPerX,-14,14);next.y=clamp(state.y-my*worldPerY,-10,10);}
  const cues=used.map(hand=>{if(!this.cues.has(hand.id))this.cues.set(hand.id,new PalmDepthCue());return this.cues.get(hand.id).update(hand,time);});
  const valid=cues.every(c=>c.valid);sample.depthReady=valid;
  let phase=branch;
  if(valid&&prev.depthReady){const common=cues.reduce((s,c)=>s+c.delta,0)/cues.length;if(branch!=='zoom')next.z=applyDepth(state.z,common);if(cues.some(c=>c.delta!==0))this.depthLock=time+160;if(branch==='depth')phase=common>0?'near':common<0?'far':'depth-hold';}
  else if(branch==='depth')phase='depth-uncertain';
  if(used.length===2&&sample.distance>=.07&&prev.distance>=.07){
   // Depth takes priority over apparent screen separation. Distance rebases
   // continuously, so resuming zoom cannot apply an accumulated size jump.
   if(branch==='zoom'||valid&&prev.depthReady&&time>=this.depthLock)next.scale=clamp(state.scale*Math.exp(clamp(Math.log(sample.distance/prev.distance),-.10,.10)),minScale,maxScale);
   if(branch==='dual'&&operation!=='inspect'){next.roll=state.roll+clamp(angleDelta(sample.roll,prev.roll),-.14,.14);sample.yaw=valid?Math.atan2(2*(cues[0].value-cues[1].value)*sample.handSign,Math.max(.12,sample.distance)):0;if(valid&&prev.depthReady)next.rotation=state.rotation+clamp(angleDelta(sample.yaw,prev.yaw),-.14,.14);phase=!valid?'dual-uncertain':time<this.depthLock?'dual-depth':'dual';}
  }
  if(operation==='inspect')phase=used.length===2?(valid?'inspect':'inspect-uncertain'):'hold-one';
  return this.result(phase,next);
 }
}



