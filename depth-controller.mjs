// Relative monocular control cue, never a physical distance measurement.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const DEPTH_LIMITS=Object.freeze({minZ:-8,maxZ:1.6});
export function applyDepth(z,logDelta){return clamp(5.8-(5.8-z)*Math.exp(-logDelta),-8,1.6);}
export class PalmDepthCue {
 constructor(){this.reset();}
 reset(){this.last=null;this.anchor=null;this.filtered=null;this.accepted=0;}
 update(h,time){
  const q=h.depthQuality,shape=h.depthShape||1;
  if(!Number.isFinite(q)||q<.84||q>1||!Number.isFinite(h.depthSize)||h.depthSize<=0||!Number.isFinite(shape)||shape<=0){this.reset();return {valid:false,delta:0,value:0};}
  const log=Math.log(h.depthSize)-.5*Math.log(q),prev=this.last;
  if(prev&&(h.id!==prev.id||time<=prev.time||time-prev.time>200||Math.abs(log-prev.log)>.16||Math.abs(q-prev.q)>.08||Math.abs(Math.log(shape/prev.shape))>.13)){this.reset();return {valid:false,delta:0,value:0};}
  if(this.anchor&&Math.abs(Math.log(shape/this.anchor.shape))>.24){this.reset();return {valid:false,delta:0,value:0};}
  this.last={id:h.id,time,log,q,shape};
  if(!this.anchor){this.anchor={log,shape,time};this.filtered=log;this.accepted=0;return {valid:false,delta:0,value:0};}
  if(time-this.anchor.time<120){this.anchor.log=log;this.filtered=log;return {valid:false,delta:0,value:0};}
  const alpha=1-Math.exp(-Math.min(80,time-prev.time)/28);this.filtered+=(log-this.filtered)*alpha;
  const value=this.filtered-this.anchor.log,delta=value-this.accepted;
  if(Math.abs(delta)<.006)return {valid:true,delta:0,value:this.accepted};
  this.accepted=value;return {valid:true,delta,value};
 }
}
export class DepthController {
 constructor(){this.cue=new PalmDepthCue();}
 reset(){this.cue.reset();}
 update(hands,time,{enabled=true,active=false,state}={}){
  if(!enabled||!active||!state||hands.length!==1){this.reset();return {phase:'paused',state:null};}
  const c=this.cue.update(hands[0],time);
  return {phase:!c.valid?'depth-uncertain':c.delta>0?'near':c.delta<0?'far':'depth-hold',state:c.valid&&c.delta?{...state,z:applyDepth(state.z,c.delta)}:null};
 }
}
