// Ephemeral geometric association. Never biometric identity or persistent registration.
export const PLAYER_LIMITS=Object.freeze({maxPoses:4,maxHands:4,poseIntervalMs:250,poseMaxIntervalMs:600,poseAgeMs:900,confirmMs:500,confirmSamples:3,recoverMs:2200,neutralMs:100,autoSelectMs:700,autoIntentMs:1000});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const valid=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1&&(p.visibility??1)>=.5&&(p.presence??1)>=.5;
const dist=(a,b,aspect)=>Math.hypot((a.x-b.x)*aspect,a.y-b.y);
export function handInsideAnalysis(h){return Array.isArray(h)&&h.length===21&&h.every(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>.002&&p.x<.998&&p.y>.002&&p.y<.998);}
export function sanitizeHands(r={}){const ids=(r.landmarks||[]).map((p,i)=>handInsideAnalysis(p)?i:-1).filter(i=>i>=0);return {landmarks:ids.map(i=>r.landmarks[i]),handedness:ids.map(i=>r.handedness?.[i]||[])};}
export function describePlayer(points,index,aspect=16/9){
 if(!Array.isArray(points)||!valid(points?.[11])||!valid(points?.[12]))return null;
 const a=points[11],b=points[12],scale=dist(a,b,aspect);if(scale<.055)return null;
 const visible=points.filter(valid),xs=visible.map(p=>p.x),ys=visible.map(p=>p.y);
 return {index,points,center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},scale,wrists:[15,16].map(i=>valid(points[i])?points[i]:null),box:{left:clamp(Math.min(...xs)-.035,0,1),right:clamp(Math.max(...xs)+.035,0,1),top:clamp(Math.min(...ys)-.055,0,1),bottom:clamp(Math.max(...ys)+.035,0,1)}};
}
// Suppress only near-identical full skeleton predictions, never centre overlap alone.
export function sameBodyPrediction(a,b,aspect=16/9){
 const scale=Math.min(a.scale,b.scale),headA=a.points[0],headB=b.points[0];
 if(!valid(headA)||!valid(headB)||dist(headA,headB,aspect)>scale*.075)return false;
 if(a.scale/b.scale<.8||a.scale/b.scale>1.25)return false;
 if([15,16].some(i=>valid(a.points[i])&&valid(b.points[i])&&dist(a.points[i],b.points[i],aspect)>scale*.35))return false;
 const core=[11,12,13,14,23,24].filter(i=>valid(a.points[i])&&valid(b.points[i]));
 if(core.length<4)return false;
 const d=core.map(i=>dist(a.points[i],b.points[i],aspect)/scale).sort((x,y)=>x-y);
 return d[Math.floor(d.length/2)]<.18&&d.filter(v=>v<.25).length>=Math.ceil(core.length*.8);
}
function uniqueBodies(people,aspect){
 const kept=[];for(const p of people){
  const same=kept.find(q=>sameBodyPrediction(p,q,aspect));
  if(same){same.duplicateIndices.push(p.index);continue;}
  kept.push({...p,duplicateIndices:[]});
 }return kept;
}
export function inputTimingBudget(processingMs=0,intervalMs=0){
 const p=Number.isFinite(processingMs)?Math.max(0,processingMs):0,i=Number.isFinite(intervalMs)?Math.max(0,intervalMs):0;
 return {handAgeMs:clamp(p*1.5+50,250,1000),intentGapMs:clamp(i*2.4+p*.5,450,1600),continuityMs:clamp(i*1.8,220,900),poseAgeExtraMs:clamp(p,0,900)};
}
export class PlayerSession{
 constructor(config={}){this.limits={...PLAYER_LIMITS,...config};this.nextId=1;this.reset();}
 reset(){this.epoch=(this.epoch||0)+1;this.state='unselected';this.people=[];this.selected=null;this.lastPose=-Infinity;this.selectedAt=0;this.samples=0;this.aspect=16/9;this.atCapacity=false;this.handAtCapacity=false;this.reason='人物の枠を選び「この人に決定」';this.recoverySince=null;this.recoverySamples=0;this.unknownWrists=[];this.lastMatch=-Infinity;this.handHistory=new Map();this.rawPoses=0;this.duplicatePoses=0;this.autoIntent=null;this.automatic=false;this.newSelection=false;this.suspended=false;this.resumeAt=0;this.resumeMatch=false;this.inputTiming=inputTimingBudget();this.poseProcessingMs=0;this.poseLatencyMs=0;this.poseGapMs=0;this.poseTimingStamp=null;}
 observeInputTiming(processingMs,intervalMs){this.inputTiming=inputTimingBudget(processingMs,intervalMs);}
 observePoseTiming(ms,stamp,now){
  this.poseProcessingMs=Number.isFinite(ms)?clamp(ms,0,900):0;
  if(Number.isFinite(stamp)&&Number.isFinite(now)&&stamp<=now&&stamp>=this.resumeAt&&(this.poseTimingStamp===null||stamp>this.poseTimingStamp)){
   if(this.poseTimingStamp!==null){const gap=clamp(stamp-this.poseTimingStamp,0,2000);this.poseGapMs=this.poseGapMs?this.poseGapMs*.6+gap*.4:gap;}
   this.poseTimingStamp=stamp;this.poseLatencyMs=clamp(now-stamp,0,1800);
  }
 }
 poseAgeBudget(){return Math.min(1800,Math.max(this.limits.poseAgeMs+Math.max(this.inputTiming.poseAgeExtraMs,this.poseProcessingMs),this.poseLatencyMs+this.poseGapMs*1.3+100));}
 fresh(now){return Number.isFinite(now)&&now>=this.lastPose&&now-this.lastPose<=this.poseAgeBudget();}
 ready(now){return !this.suspended&&this.state==='locked'&&this.fresh(now)&&!this.atCapacity;}
 hold(reason){this.handHistory.clear();this.recoverySince=null;this.recoverySamples=0;if(this.state==='locked'||this.state==='pending'){this.epoch++;this.holdFrom=this.state;this.state='holding';}this.reason=reason;}
 lose(reason){this.handHistory.clear();if(this.state!=='lost')this.epoch++;this.state='lost';this.selected=null;this.reason=reason+' / 選び直してください';}
 reselect(){this.handHistory.clear();this.epoch++;this.state='unselected';this.selected=null;this.samples=0;this.reason='人物の枠を選び「この人に決定」';}
 fail(){if(this.selected)this.lose('人物確認を再準備してください');else{this.state='unselected';this.reason='人物確認を再準備してください';}}
 suspend(now){this.suspended=true;this.autoIntent=null;if(this.selected)this.hold('画面待機 / 配置を保持');}
 resume(now){if(!this.suspended)return;this.suspended=false;this.resumeAt=now;this.resumeMatch=true;this.lastMatch=now;this.autoIntent=null;if(this.selected)this.hold('画面に復帰 / 同じ人物を確認中');}
 update(poses,stamp,aspect=16/9,now=stamp){
  if(this.suspended||stamp<this.resumeAt)return false;
  if(!Array.isArray(poses)){this.hold('人物の入力を確認中');return false;}
  if(!Number.isFinite(stamp)||stamp<=this.lastPose||stamp>now||now-stamp>this.poseAgeBudget())return false;
  const oldPeople=this.people,last=this.lastPose,resumed=this.resumeMatch;this.resumeMatch=false;this.lastPose=stamp;this.aspect=aspect;
  const described=poses.map((p,i)=>describePlayer(p,i,aspect)).filter(Boolean);
  this.rawPoses=poses.length;this.people=uniqueBodies(described,aspect);this.duplicatePoses=described.length-this.people.length;
  // Globally nearest assignment prevents an earlier array entry stealing a stable candidate ID.
  const pairs=this.people.flatMap(p=>oldPeople.map(q=>({p,q,d:dist(q.center,p.center,aspect)/Math.max(.055,q.scale)+Math.abs(Math.log(p.scale/q.scale))}))).filter(v=>v.d<.6).sort((a,b)=>a.d-b.d);
  const assigned=new Set(),used=new Set();
  for(const {p,q}of pairs){if(assigned.has(p)||used.has(q.id))continue;p.id=q.id;p.seenSince=stamp-last<=this.limits.recoverMs?q.seenSince:stamp;p.observations=stamp-last<=this.limits.recoverMs?(q.observations||1)+1:1;assigned.add(p);used.add(q.id);}
  for(const p of this.people)if(!assigned.has(p)){p.id=this.nextId++;p.seenSince=stamp;p.observations=1;}
  this.atCapacity=poses.length>=this.limits.maxPoses;
  this.unknownWrists=poses.filter((_,i)=>!described.some(p=>p.index===i)).flatMap(p=>[p?.[15],p?.[16]].filter(valid));
  if(this.limits.autoSelect&&this.state==='unselected'&&!this.atCapacity&&this.people.length===1){const p=this.people[0];this.reason='一人を確認中 / そのまま手を開いてください';if(p.observations>=3&&stamp-p.seenSince>=this.limits.autoSelectMs){this.activateAutomatic(p,now);return true;}}
  if(!['pending','locked','holding'].includes(this.state))return true;
  if(this.atCapacity){this.lose('人物候補が上限です（4人以上は確認できません）');return false;}
  const prev=this.selected;if(!prev){this.lose('人物の基準がありません');return false;}
  if(!resumed&&stamp-last>this.limits.recoverMs){this.lose('人物確認が長く途切れました');return false;}
  const rank=this.people.map(person=>({person,cost:dist(prev.center,person.center,aspect)/prev.scale+Math.abs(Math.log(person.scale/prev.scale))})).sort((a,b)=>a.cost-b.cost),best=rank[0],second=rank[1];
  if(!best){this.hold('人物を確認中 / 配置を保持');if(stamp-this.lastMatch>this.limits.recoverMs)this.lose('人物を見失いました');return false;}
  if(best.cost>.8||best.person.scale/prev.scale<.65||best.person.scale/prev.scale>1.55){this.hold('人物の動きを確認中 / 配置を保持');return false;}
  if(second&&second.cost-best.cost<.3||this.people.some(p=>p!==best.person&&dist(p.center,best.person.center,aspect)<.7*Math.min(p.scale,best.person.scale))){this.hold('人物の対応を確認中 / 配置を保持');return false;}
  if(this.state==='holding'){
   // A valid geometric match is evidence the same player is still present, even before re-arming.
   this.lastMatch=stamp;this.recoverySince??=stamp;this.recoverySamples++;
   if(stamp-this.recoverySince<this.limits.confirmMs||this.recoverySamples<this.limits.confirmSamples){this.reason='同じ人物の復帰を確認中';return false;}
   this.state=this.holdFrom==='pending'?'pending':'locked';this.epoch++;this.reason='人物を再確認 / 指を一度開いて再操作';this.selectedAt=stamp;this.samples=1;
  }else this.samples++;
  this.selected={...best.person,id:prev.id};this.lastMatch=stamp;return true;
 }
 activateAutomatic(p,now){
  if(!this.choose(p.id,now))return false;
  this.selectedAt=p.seenSince;this.samples=p.observations;
  if(!this.confirm(now))return false;
  this.automatic=true;this.newSelection=true;this.autoIntent=null;this.reason='✓ 自動でプレイヤー固定 / 手を開いて3秒';
  return true;
 }
 offerSelectionHands(hands,stamp,now=stamp){
  if(!this.limits.autoSelect||!['unselected','lost'].includes(this.state)||!this.fresh(now)||!Number.isFinite(stamp)||stamp>now||now-stamp>this.inputTiming.handAgeMs||this.atCapacity){this.autoIntent=null;return false;}
  const owners=new Set();
  for(const h of hands){if(!h.open||!h.wrist)continue;
   const rank=this.people.map(p=>({p,d:Math.min(...p.wrists.filter(Boolean).map(w=>dist(h.wrist,w,this.aspect)))})).sort((a,b)=>a.d-b.d),best=rank[0];
   if(best&&best.d<Math.max(.06,best.p.scale*.5)&&(!rank[1]||rank[1].d-best.d>Math.max(.035,best.p.scale*.15))&&h.wrist.y<best.p.center.y+best.p.scale*.9)owners.add(best.p.id);
  }
  if(owners.size!==1){if(!hands.length&&this.autoIntent&&now-this.autoIntent.last<=this.inputTiming.intentGapMs)return false;this.autoIntent=null;return false;}
  const id=[...owners][0],p=this.people.find(p=>p.id===id);
  if(!this.autoIntent||this.autoIntent.id!==id||now-this.autoIntent.last>this.inputTiming.intentGapMs)this.autoIntent={id,since:now,last:now,samples:0};
  this.autoIntent.last=now;this.autoIntent.samples++;this.reason='掌を開いた人を確認中 / そのまま…';
  if(now-this.autoIntent.since<(this.state==='lost'?1500:this.limits.autoIntentMs)||this.autoIntent.samples<3||p.observations<3)return false;
  return this.activateAutomatic(p,now);
 }
 choose(id,now){const p=this.people.find(p=>p.id===id);if(!p||!this.fresh(now)||this.atCapacity)return false;if(this.people.some(q=>q!==p&&dist(p.center,q.center,this.aspect)<.7*Math.min(p.scale,q.scale))){this.reason='人物が重なっています / 離れてから選択';return false;}this.handHistory.clear();this.automatic=false;this.epoch++;this.selected={...p};this.state='pending';this.selectedAt=now;this.lastMatch=now;this.samples=1;this.reason='選択中 / 枠を確認して「この人に決定」';return true;}
 canConfirm(now){return this.state==='pending'&&this.fresh(now)&&!this.atCapacity&&now-this.selectedAt>=this.limits.confirmMs&&this.samples>=this.limits.confirmSamples;}
 confirm(now){if(!this.canConfirm(now))return false;this.state='locked';this.epoch++;this.reason='プレイヤー固定 / 指を一度開いて操作';return true;}
 expire(now){if(this.suspended)return;if(['locked','pending'].includes(this.state)&&!this.fresh(now))this.hold('人物確認の更新待ち / 配置を保持');if(this.state==='holding'&&now-this.lastMatch>this.limits.recoverMs)this.lose('人物確認が長く途切れました');}
 filterHands(result,stamp,now=stamp){
  this.handAtCapacity=(result.landmarks||[]).length>=this.limits.maxHands;
  const empty=reason=>({landmarks:[],handedness:[],ownerSlots:[],reason});
  if(!this.ready(now)||!Number.isFinite(stamp)||!Number.isFinite(now)||stamp>now||now-stamp>this.inputTiming.handAgeMs||Math.abs(stamp-this.lastPose)>this.poseAgeBudget())return empty(this.reason||'人物確認の更新待ち');
  const me=this.selected,others=this.people.filter(p=>p.index!==me.index),candidates=[];
  for(const [index,hand]of(result.landmarks||[]).entries()){
   if(!handInsideAnalysis(hand))continue;const wrist=hand[0],rank=me.wrists.map((p,slot)=>{const history=this.handHistory.get(slot),continuous=p&&history&&stamp-history.time<=this.inputTiming.continuityMs&&dist(wrist,history.wrist,this.aspect)<Math.max(.05,me.scale*.35);return {slot,d:p?Math.min(dist(wrist,p,this.aspect),continuous?dist(wrist,history.wrist,this.aspect)+.015:Infinity):Infinity};}).sort((a,b)=>a.d-b.d),best=rank[0];
   if(!Number.isFinite(best.d)||best.d>Math.max(.06,me.scale*.5)||rank[1].d-best.d<Math.max(.025,me.scale*.13))continue;
   const margin=Math.max(.03,me.scale*.15);
   const other=others.some(p=>p.wrists.some(w=>w&&dist(wrist,w,this.aspect)<=best.d+margin)||p.wrists.some(w=>!w)&&dist(wrist,p.center,this.aspect)<p.scale*1.6)||this.unknownWrists.some(w=>dist(wrist,w,this.aspect)<=best.d+margin);
   if(!other)candidates.push({index,slot:best.slot});
  }
  const accepted=candidates.filter(c=>candidates.filter(q=>q.slot===c.slot).length===1).sort((a,b)=>a.slot-b.slot);
  const active=new Set(accepted.map(c=>c.slot));for(const slot of this.handHistory.keys())if(!active.has(slot))this.handHistory.delete(slot);for(const c of accepted)this.handHistory.set(c.slot,{wrist:{x:result.landmarks[c.index][0].x,y:result.landmarks[c.index][0].y},time:stamp});
  return {landmarks:accepted.map(c=>result.landmarks[c.index]),handedness:accepted.map(c=>result.handedness?.[c.index]||[]),ownerSlots:accepted.map(c=>c.slot),reason:accepted.length?'':'選択した人の手を確認中'};
 }
 snapshot(now){return {state:this.state,suspended:this.suspended,epoch:this.epoch,ready:this.ready(now),reason:this.reason,candidates:this.people.length,rawPoses:this.rawPoses,duplicatePoses:this.duplicatePoses,automatic:this.automatic,selectionSamples:this.samples,inputTiming:{...this.inputTiming,poseAgeMs:this.poseAgeBudget(),poseProcessingMs:this.poseProcessingMs,poseLatencyMs:this.poseLatencyMs,poseGapMs:this.poseGapMs},atCapacity:this.atCapacity,handAtCapacity:this.handAtCapacity,ageMs:Number.isFinite(this.lastPose)?Math.max(0,Math.round(now-this.lastPose)):null};}
}
export class PlayerHandRoles{
 constructor(){this.reset();}
 reset(){this.main=null;this.openSince=new Map();this.enabled=new Set();this.lastSeen=new Map();}
 requireRelease(){this.openSince.clear();this.enabled.clear();}
 update(hands,time){
  const present=new Set(hands.map(h=>h.ownerSlot));
  for(const slot of this.lastSeen.keys())if(!present.has(slot)){this.enabled.delete(slot);this.openSince.delete(slot);}
  const out=[];for(const h of hands){
   const slot=h.ownerSlot;this.lastSeen.set(slot,time);
   if(!this.enabled.has(slot)){if(h.pinch>=.46&&!h.brakeCandidate){if(!this.openSince.has(slot))this.openSince.set(slot,time);if(time-this.openSince.get(slot)>=PLAYER_LIMITS.neutralMs)this.enabled.add(slot);}else this.openSince.delete(slot);}
   if(!this.enabled.has(slot))continue;if(this.main===null&&h.open)this.main=slot;if(this.main===null)continue;
   out.push({...h,personSlot:slot===this.main?'main':'aux',trackKey:'selected-wrist-'+slot});
  }
  return out.sort((a,b)=>(a.personSlot==='main'?-1:1)-(b.personSlot==='main'?-1:1));
 }
}
