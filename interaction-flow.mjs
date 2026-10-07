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
 update(hands,events,time,{enabled=false,operation='place',owner=null,heldIds=[],uiBusy=false,allowAutoStart=true}={}){
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

export class OperatorGate{
 constructor(){this.reset();}
 reset(){this.mainSlot=null;this.body=null;this.anchor=null;this.lastSeen=null;this.blocked=false;this.state='waiting';this.handOnly=false;this.candidate=null;this.lastHand=null;}
 update(hands,pose,time,{dual=false}={}){
  const visible=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&(p.visibility??1)>=.55;
  if(this.blocked){this.state='operator-reset';return [];}
  if(this.handOnly)return this.updateHandOnly(hands,time,dual);
  if(!this.mainSlot){const eligible=hands.filter(h=>h.open&&!h.brakeCandidate&&h.handLabel);if(hands.length===1&&eligible.length===1){const h=eligible[0];if(!this.candidate||time-this.candidate.last>250||this.candidate.label!==h.handLabel||Math.hypot(h.wx-this.candidate.x,h.wy-this.candidate.y)>.1)this.candidate={label:h.handLabel,x:h.wx,y:h.wy,since:time,last:time};this.candidate.last=time;if(time-this.candidate.since>=700){this.handOnly=true;this.mainSlot=h.handLabel;this.lastSeen=null;return this.updateHandOnly(hands,time,dual);}}else this.candidate=null;}
  if(!pose||![11,12].every(i=>visible(pose[i]))){if(this.body&&this.lastSeen!==null&&time-this.lastSeen>700)this.blocked=true;this.state=this.blocked?'operator-reset':'body-wait';return [];}
  const center={x:(pose[11].x+pose[12].x)/2,y:(pose[11].y+pose[12].y)/2},width=Math.hypot(pose[11].x-pose[12].x,pose[11].y-pose[12].y);
  if(width<.055){this.state='body-wait';return [];}
  if(this.body&&(Math.hypot(center.x-this.body.x,center.y-this.body.y)>.14||width/this.body.width>1.7||width/this.body.width<.58)){this.blocked=true;this.state='operator-reset';return [];}
  if(this.anchor&&Math.hypot(center.x-this.anchor.x,center.y-this.anchor.y)>.24){this.blocked=true;this.state='operator-reset';return [];}this.anchor??={...center};this.lastSeen=time;this.body={...center,width};const candidates=[];
  for(const slot of ['Left','Right']){
   const wrist=pose[slot==='Left'?15:16];if(!visible(wrist))continue;
   const ranked=hands.map(h=>({h,cost:Math.hypot((1-h.wx)-wrist.x,h.wy-wrist.y)})).filter(v=>v.cost<Math.max(.075,width*.65)).sort((a,b)=>a.cost-b.cost);
   if(ranked.length&&!(ranked[1]&&ranked[1].cost-ranked[0].cost<.015))candidates.push({...ranked[0].h,personSlot:slot,handLabel:slot});
  }
  if(candidates.length===2&&candidates[0].points===candidates[1].points){this.state='ambiguous';return [];}
  if(!this.mainSlot){const choice=candidates.filter(h=>h.open&&!h.brakeCandidate).sort((a,b)=>b.size*(.5+b.depthQuality)-a.size*(.5+a.depthQuality))[0];if(choice)this.mainSlot=choice.personSlot;}
  const main=candidates.find(h=>h.personSlot===this.mainSlot);
  if(!main){this.state='main-wait';return [];}this.state=dual?'two-hands':'main';
  return dual?[main,...candidates.filter(h=>h.personSlot!==this.mainSlot)].slice(0,2):[main];
 }
 updateHandOnly(hands,time,dual){
  const ranked=hands.filter(h=>h.handLabel===this.mainSlot).map(h=>({h,d:this.lastHand?Math.hypot(h.wx-this.lastHand.wx,h.wy-this.lastHand.wy):0})).sort((a,b)=>a.d-b.d);
  if(this.lastSeen!==null&&time-this.lastSeen>700){this.blocked=true;this.state='operator-reset';return [];}
  if(!ranked.length||ranked[0].d>.28||(ranked[1]&&ranked[1].d-ranked[0].d<.04)){this.state='hand-only-wait';return [];}
  const main={...ranked[0].h,personSlot:this.mainSlot};this.lastSeen=time;this.lastHand={wx:main.wx,wy:main.wy};this.state='hand-only';
  if(!dual)return [main];
  const aux=hands.filter(h=>h.handLabel&&h.handLabel!==this.mainSlot&&Math.hypot(h.wx-main.wx,h.wy-main.wy)<.65);
  return aux.length===1?[main,{...aux[0],personSlot:aux[0].handLabel}]:[main];
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
