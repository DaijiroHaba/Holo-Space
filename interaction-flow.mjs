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
