// Interaction routing is independent of anatomy and DOM. Targets are stable IDs.
export class SummonGate {
 constructor(){this.reset();}
 reset(){this.id=null;this.since=null;this.last=null;}
 update(hands,time,enabled){
  if(!enabled){this.reset();return {progress:0,ready:false};}
  const h=hands.find(h=>h.open&&!h.down&&!h.fist);
  if(!h||this.last!==null&&(time<=this.last||time-this.last>250)){this.reset();if(!h)return {progress:0,ready:false};}
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
  if(this.lastTime!==null&&(time<=this.lastTime||time-this.lastTime>300))this.reset();this.lastTime=time;
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
 update(hands,events,time,{enabled=false,operation='place',owner=null,heldIds=[],uiBusy=false}={}){
  const gap=this.last===null?0:time-this.last;this.last=time;
  if(!enabled){this.prepare=null;this.brakeSince=null;return {type:'none'};}
  const rotating=operation==='rotate',required=rotating?(owner!==null?[owner]:this.owner!==null?[this.owner]:[]):heldIds;
  if(required.length&&(gap>200||required.some(id=>!hands.some(h=>h.id===id))||events.some(e=>required.includes(e.id)&&['missing','lost','reacquired'].includes(e.type))))return this.lock('tracking',time);
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
  const valid=this.armed&&time>=this.blockUntil&&!uiBusy&&!heldIds.length&&hands.length===2&&hands.every(h=>h.palmOpen&&!h.down&&h.pinch>=.55&&h.depthQuality>=.75&&h.px>.06&&h.px<.94&&h.py>.15&&h.py<.85&&!h.actionId&&h.hoverId!=='controls')&&Math.abs(hands[0].px-hands[1].px)>.12;
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
