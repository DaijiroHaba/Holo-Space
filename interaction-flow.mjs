// Interaction routing is independent of anatomy and DOM. Targets are stable IDs.
export class SummonGate {
 constructor(){this.reset();}
 reset(){this.id=null;this.since=null;this.last=null;this.absentAt=null;}
 update(hands,time,enabled){
  if(!enabled){this.reset();return {progress:0,ready:false};}
  const h=hands.find(h=>h.open&&!h.down&&!h.fist);
  if(!h)this.absentAt??=time;else this.absentAt=null;
  if(!h&&this.last!==null&&time-this.absentAt<350){if(this.since!==null)this.since+=Math.max(0,time-this.last);this.last=time;return {progress:Math.min(1,(time-this.since)/3000),ready:false};}
  if(!h||this.last!==null&&(time<=this.last||time-this.last>900)){this.reset();if(!h)return {progress:0,ready:false};}
  if(this.id!==h.id||this.since===null){this.id=h.id;this.since=time;}this.last=time;
  const progress=Math.min(1,(time-this.since)/3000);return {progress,ready:progress===1,id:h.id};
 }
}
export class TapRouter {
 constructor(){this.blockUntil=0;this.reset();}
 reset(){this.press=null;this.lastTime=null;}
 guard(time,duration=300){this.reset();this.blockUntil=time+duration;}
 update(hands,events,time){
  const output=[];
  if(this.lastTime!==null&&(time<=this.lastTime||time-this.lastTime>1200))this.reset();this.lastTime=time;
  if(this.press){const owner=hands.find(h=>h.id===this.press.id);if(!owner||events.some(e=>e.type==='lost'&&e.id===this.press.id))this.press=null;else this.press.travel=Math.max(this.press.travel,Math.hypot(owner.px-this.press.px,owner.py-this.press.py));}
  // A second visible hand never cancels the owning hand's tap. UI owns input
  // before any underlying object; one complete pinch/release executes once.
  const pins=events.filter(e=>e.type==='pinch').map(e=>hands.find(h=>h.id===e.id)).filter(Boolean).sort((a,b)=>Number(!!b.actionId)-Number(!!a.actionId));
  if(time>=this.blockUntil&&!this.press){const h=pins.find(h=>h.actionId||h.hoverId);if(h){if(h.actionId)this.press={kind:'ui',target:h.actionId,id:h.id,at:time,px:h.px,py:h.py,travel:0};else output.push({type:'grab',target:h.hoverId,id:h.id});}}
  for(const e of events)if(e.type==='release'&&this.press?.id===e.id){const p=this.press;this.press=null;const age=time-p.at;if(age>=20&&age<=10000&&p.travel<=.12){output.push({type:'tap',target:p.target,id:e.id});this.blockUntil=time+160;}}
  return output;
 }
}


// Body workflow only; UI taps and lobby summon keep their own routers.
export class RotationHandoff {
 constructor(){this.owner=null;this.armed=true;this.prepare=null;this.brakeSince=null;this.neutralSince=null;this.readyHands=new Set();this.blockUntil=0;this.grabAfter=0;this.last=null;this.reason='initial';this.state='fixed';}
 lock(reason,time){
  this.state='fixed';this.reason=reason;this.owner=null;this.prepare=null;this.brakeSince=null;this.neutralSince=null;this.readyHands.clear();
  this.armed=reason==='release';this.blockUntil=time+250;this.grabAfter=time+65;
  return {type:'fixed',reason};
 }
 manual(mode,time){this.owner=null;this.prepare=null;this.brakeSince=null;this.readyHands.clear();this.armed=true;this.blockUntil=time+350;this.grabAfter=time+65;this.state=mode==='rotate'?'rotate':'fixed';}
 canGrab(h,time){return !!h&&!h.brakeCandidate&&this.readyHands.has(h.id)&&time>=this.grabAfter;}
 update(hands,events,time,{enabled=false,operation='place',owner=null,heldIds=[],uiBusy=false,allowAutoStart=true,recoverable=false}={}){
  const gap=this.last===null?0:time-this.last;this.last=time;
  if(!enabled){this.prepare=null;this.brakeSince=null;return {type:'none'};}
  const rotating=operation==='rotate',required=rotating?(owner!==null?[owner]:this.owner!==null?[this.owner]:[]):heldIds;
  if(required.length&&(gap>(recoverable?700:200)||required.some(id=>!hands.some(h=>h.id===id))||events.some(e=>required.includes(e.id)&&['missing','lost','reacquired'].includes(e.type)))){if(recoverable){this.brakeSince=null;return {type:'rebase',reason:'tracking'};}return this.lock('tracking',time);}
  for(const h of hands){if(h.brakeCandidate)this.readyHands.delete(h.id);else if(!h.down&&h.pinch>=.46)this.readyHands.add(h.id);}
  if(rotating){
   this.state='rotate';this.prepare=null;
   const hand=hands.find(h=>h.id===(owner??this.owner))||hands.find(h=>!h.actionId&&h.hoverId!=='controls');
   if(!hand)return {type:'none'};this.owner=hand.id;
   if(hand.brakeCandidate){
    this.brakeSince??=time;
    if(hand.closedPalm&&time-this.brakeSince>=65)return this.lock('fist',time);
    return {type:'braking',owner:hand.id};
   }
   if(this.brakeSince!==null){this.brakeSince=null;return {type:'rebase',owner:hand.id};}
   return {type:'none',owner:hand.id};
  }
  this.brakeSince=null;
  if(heldIds.length){this.state=heldIds.length===2?'inspect':'hold-one';this.prepare=null;return {type:'none'};}
  // Explicitly neutralize both visible hands after a fist/loss. Simply opening
  // the braking hand while the other stays open must not restart rotation.
  if(!this.armed){
   const neutral=hands.length===2&&hands.every(h=>!h.palmOpen||h.depthQuality<.5||h.py>.85);
   if(neutral){this.neutralSince??=time;if(time-this.neutralSince>=120)this.armed=true;}else this.neutralSince=null;
  }
  const valid=allowAutoStart&&this.armed&&time>=this.blockUntil&&!uiBusy&&!heldIds.length&&hands.length===2&&hands.every(h=>h.palmOpen&&!h.down&&h.pinch>=.55&&h.depthQuality>=.75&&h.px>.06&&h.px<.94&&h.py>.15&&h.py<.85&&!h.actionId&&h.hoverId!=='controls')&&Math.abs(hands[0].px-hands[1].px)>.12;
  if(!valid){this.prepare=null;return {type:'none'};}
  const ordered=[...hands].sort((a,b)=>a.id-b.id),key=ordered.map(h=>h.id).join(',');
  if(!this.prepare||this.prepare.key!==key||ordered.some((h,i)=>Math.hypot(h.px-this.prepare.points[i].x,h.py-this.prepare.points[i].y)>.025))this.prepare={key,since:time,points:ordered.map(h=>({x:h.px,y:h.py}))};
  const progress=Math.min(1,(time-this.prepare.since)/700);
  if(progress<1){this.state='preparing';return {type:'preparing',progress};}
  this.owner=ordered[0].id;this.state='rotate';this.prepare=null;this.armed=false;
  return {type:'rotate',owner:this.owner};
 }
}

// Rotation owns its manipulating hand, even when its finger cursor crosses UI.
// The other hand may deliberately tap an icon while rotation is stationary.
export function routeHandTargets(hands,{operation,owner=null,capture=false,palmBusy=false,canGrab=()=>true}={}){
 return hands.map(h=>{
  if(capture)return {...h,actionId:null,hoverId:null};
  if(operation==='rotate')return {...h,actionId:palmBusy||h.id===owner?null:h.actionId,hoverId:null};
  return {...h,actionId:h.actionId,hoverId:operation==='inspect'&&h.hoverId!=='controls'&&!canGrab(h)?null:h.hoverId};
 });
}

// Ephemeral role continuity, not biometric/person identification. Pose is a hint.
export class OperatorGate {
 constructor(){this.reset();}
 reset(){this.roles={};this.mainSlot=null;this.blocked=false;this.state='waiting';this.handOnly=false;this.candidate=null;this.reason='initial';this.initialCandidate=null;this.last=null;this.interval=33;}
 poseCost(h,pose){return Math.min(...[15,16].map(i=>{const p=pose?.[i];return p&&(p.visibility??1)>.45?Math.hypot(1-h.wx-p.x,h.wy-p.y):1;}));}
 cost(t,h,time,pose){
  const gap=time-t.time,dt=Math.min(160,gap)/1000,px=t.wx+t.vx*dt,py=t.wy+t.vy*dt;
  const d=Math.hypot(h.wx-px,h.wy-py),limit=gap>1400?.23:Math.min(.34,.13+gap*.0006);
  const supportedAux=t.role==='aux'&&gap>1400&&time-(this.roles.main?.time??-Infinity)<150&&d<.55&&this.poseCost(h,pose)<.06&&h.handLabel&&h.handLabel===t.label;
  if(d>limit&&!supportedAux)return Infinity;
  return (supportedAux?Math.min(d,.18):d)+Math.min(.12,Math.max(0,gap-100)*.0002)+Math.min(.06,Math.abs(Math.log(Math.max(.001,h.size)/t.size))*.025)+(h.handLabel&&t.label&&h.handLabel!==t.label?.08:0)+Math.min(.015,this.poseCost(h,pose)*.025);
 }
 save(role,h,time){const old=this.roles[role],dt=old?Math.max(.02,(time-old.time)/1000):1;this.roles[role]={role,wx:h.wx,wy:h.wy,size:Math.max(.001,h.size),label:h.handLabel,time,vx:old?Math.max(-.7,Math.min(.7,(h.wx-old.wx)/dt)):0,vy:old?Math.max(-.7,Math.min(.7,(h.wy-old.wy)/dt)):0};return {...h,personSlot:role,trackKey:role};}
 update(hands,pose,time){
  if(this.last!==null&&time>this.last)this.interval=.85*this.interval+.15*Math.min(500,time-this.last);this.last=time;this.handOnly=!pose;
  const hs=hands.filter(h=>h&&[h.wx,h.wy,h.size].every(Number.isFinite));
  if(!this.mainSlot){const eligible=hs.filter(h=>h.open&&!h.brakeCandidate).sort((a,b)=>this.poseCost(a,pose)-this.poseCost(b,pose)||b.size-a.size);if(!eligible.length){this.initialCandidate=null;this.state='waiting';return [];}const first=eligible[0];const c=this.initialCandidate;if(!c||time-c.last>700||Math.hypot(first.wx-c.x,first.wy-c.y)>.07){this.initialCandidate={x:first.wx,y:first.wy,since:time,last:time};this.state='waiting';return [];}c.last=time;if(time-c.since<120)return [];this.mainSlot='main';this.save('main',first,time);this.initialCandidate=null;}
  const roles=Object.keys(this.roles),options=[];
  const walk=(i,used,pairs,total)=>{if(i===roles.length){options.push({pairs,total});return;}const role=roles[i];walk(i+1,used,pairs,total+.42);for(let j=0;j<hs.length;j++){if(used.has(j))continue;const c=this.cost(this.roles[role],hs[j],time,pose);if(Number.isFinite(c))walk(i+1,new Set([...used,j]),[...pairs,[role,j]],total+c);}};
  walk(0,new Set(),[],0);options.sort((a,b)=>a.total-b.total);const best=options[0];
  if(options[1]&&options[1].total-best.total<.022){this.state='ambiguous';this.reason='competing-hands';return [];}
  // When wrists overlap, suspend assignment; keep previous roles and velocity.
  if(best.pairs.length===2){const [x,y]=best.pairs.map(([,j])=>hs[j]);if(Math.hypot(x.wx-y.wx,x.wy-y.wy)<.045){this.state='ambiguous';this.reason='overlap';return [];}}
  const out=[],used=new Set();
  for(const [role,j] of best.pairs){const h=hs[j],old=this.roles[role];used.add(j);
   if(time-old.time>1400){const c=old.recovery;if(!c||Math.hypot(h.wx-c.x,h.wy-c.y)>.045){old.recovery={x:h.wx,y:h.wy,since:time};continue;}if(time-c.since<Math.max(180,Math.min(350,this.interval*2)))continue;}
   out.push(this.save(role,h,time));
  }
  if(!this.roles.aux&&out.some(h=>h.personSlot==='main')){
   const main=out.find(h=>h.personSlot==='main');const candidates=hs.map((h,j)=>({h,j})).filter(({h,j})=>!used.has(j)&&Math.hypot(h.wx-main.wx,h.wy-main.wy)>.08&&Math.hypot(h.wx-main.wx,h.wy-main.wy)<.7);
   const supported=candidates.filter(({h})=>this.poseCost(h,pose)<.1),pool=supported.length?supported:candidates;
   if(pool.length===1){const {h}=pool[0];if(!this.candidate||Math.hypot(h.wx-this.candidate.x,h.wy-this.candidate.y)>.08)this.candidate={x:h.wx,y:h.wy,since:time};if(time-this.candidate.since>=120){out.push(this.save('aux',h,time));this.candidate=null;}}else this.candidate=null;
  }
  this.state=out.some(h=>h.personSlot==='main')?(out.length===2?'two-hands':'main'):'confirming';this.reason=this.state==='confirming'?'main-missing':'continuous';
  return out.sort((a,b)=>a.personSlot==='main'?-1:b.personSlot==='main'?1:0);
 }
}

export class ClapResetGate{
 constructor(){this.reset();}
 reset(){this.last=null;this.armed=false;this.approach=0;this.cooldown=0;this.nearAt=null;}
 update(hands,time,enabled,aspect=1){
  if(!enabled||time<this.cooldown){this.last=null;this.armed=false;this.approach=0;this.nearAt=null;return false;}
  // Keep evidence through brief overlap, but never reset from missing hands alone.
  if(hands.length!==2){if(this.last&&time-this.last.time>220){this.last=null;this.armed=false;this.approach=0;this.nearAt=null;}return false;}
  const extended=h=>h.extended===undefined?h.palmOpen:h.extended>=3;
  const eligible=hands.every(extended),neutral=hands.every(h=>!h.down&&h.open!==false&&(h.pinch??1)>=.38);
  if(!eligible||(!this.armed&&!neutral)){this.last=null;this.armed=false;this.approach=0;this.nearAt=null;return false;}
  const d=Math.hypot((hands[0].px-hands[1].px)*aspect,hands[0].py-hands[1].py),size=(hands[0].size+hands[1].size)/2,apart=Math.max(.22,size*1.5),contact=Math.max(.075,size*.85);
  const prev=this.last;this.last={d,time};if(!prev||time-prev.time>220){this.armed=d>apart&&neutral;this.approach=0;return false;}
  const speed=(prev.d-d)/Math.max(.001,(time-prev.time)/1000);
  if(d>apart&&neutral&&!this.armed){this.armed=true;this.approach=0;}
  if(speed>.25)this.approach++;else if(speed<-.1)this.approach=0;
  if(this.armed&&this.approach>=2&&d<contact&&speed>.25){this.cooldown=time+1500;this.armed=false;this.last=null;return true;}return false;
 }
}
