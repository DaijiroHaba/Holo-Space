// Normalized screen-space observations only. No recording or persistent identifiers.
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const distance = (a, b, aspect = 1) => Math.hypot((a.x-b.x)*aspect, a.y-b.y);
export function describeHand(points, aspect = 1) {
  if (!Array.isArray(points) || points.length !== 21 || !points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
  const size = Math.max(distance(points[0],points[9],aspect), distance(points[5],points[17],aspect));
  if (size < .012) return null;
  const extended = [[8,6],[12,10],[16,14],[20,18]].filter(([tip,pip]) => distance(points[tip],points[0],aspect)>distance(points[pip],points[0],aspect)*1.1).length;
  const pinch = distance(points[4],points[8],aspect)/size;
  const palm=[0,5,9,13,17];
  const vector=i=>({x:(points[i].x-points[0].x)*aspect,y:points[i].y-points[0].y,z:Number.isFinite(points[i].z)&&Number.isFinite(points[0].z)?(points[i].z-points[0].z)*aspect:0});
  const a=vector(5),b=vector(17),normal={x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x};
  const hasDepth=[0,5,17].every(i=>Number.isFinite(points[i].z));
  const depthQuality=hasDepth?Math.abs(normal.z)/Math.max(1e-8,Math.hypot(normal.x,normal.y,normal.z)):0;
  const depthSize=Math.sqrt(distance(points[5],points[17],aspect)*distance(points[0],points[9],aspect));
  const faceSign=Math.sign(normal.z)||1;
  const extendedPalmFingers=[[12,10],[16,14],[20,18]].filter(([tip,pip])=>distance(points[tip],points[0],aspect)>distance(points[pip],points[0],aspect)*1.1).length;
  const palmOpen=extendedPalmFingers>=2;
  return {extended,palmOpen,brakeCandidate:extendedPalmFingers<2,closedPalm:extendedPalmFingers===0,palmYaw:Math.atan2(normal.x*faceSign,Math.abs(normal.z)),palmPitch:Math.atan2(normal.y*faceSign,Math.abs(normal.z)),palmRoll:Math.atan2(-(points[9].x-points[0].x)*aspect,points[0].y-points[9].y),x:1-points[8].x,y:points[8].y,px:1-palm.reduce((n,i)=>n+points[i].x,0)/5,py:palm.reduce((n,i)=>n+points[i].y,0)/5,wx:1-points[0].x,wy:points[0].y,pinch,open:extended>=3&&pinch>.38,fist:extended===0&&pinch>.55,size,depthSize,depthQuality,depthShape:distance(points[5],points[17],aspect)/Math.max(.001,distance(points[0],points[9],aspect))};
}
export function containedPoint(x,y,videoWidth,videoHeight,width,height) {
  if (![x,y,videoWidth,videoHeight,width,height].every(Number.isFinite) || Math.min(videoWidth,videoHeight,width,height)<=0) return null;
  const scale = Math.min(width/videoWidth,height/videoHeight);
  return {x:(width-videoWidth*scale)/2+x*videoWidth*scale,y:(height-videoHeight*scale)/2+y*videoHeight*scale};
}
export class GestureEngine {
  constructor({graceMs=0}={}){this.graceMs=graceMs;this.reset();}
  reset(){this.tracks=[];this.nextID=1;this.lastTime=null;this.lastRelease=null;this.summonAt=-Infinity;}
  update(observations,time,phase='model') {
    const events=[];
    if (!Number.isFinite(time)) return {hands:[],events};
    if (this.lastTime!==null && (time<=this.lastTime || time-this.lastTime>300)) this.reset();
    this.lastTime=time;
    const valid=observations.filter(h=>h&&[h.x,h.y,h.wx,h.wy,h.pinch].every(Number.isFinite)).slice(0,2);
    // Observation state never overrides tracker-owned latches.
    const remaining=valid.map(({id,down,armed,openSince,downSince,palmSince,missingSince,...observation})=>observation), next=[], retained=[];
    const d=(a,b)=>a.handLabel&&b.handLabel&&a.handLabel!==b.handLabel?Infinity:Math.hypot(a.wx-b.wx,a.wy-b.wy);
    // A global two-hand assignment avoids detector array-order swaps.
    let old=[...this.tracks];
    // One visible hand must match the closest previous hand, not the first
    // detector slot. Ambiguous one-of-two observations freeze rather than swap.
    if(old.length>=2&&remaining.length===1){
      old.sort((a,b)=>d(a,remaining[0])-d(b,remaining[0]));
      if(Math.abs(d(old[0],remaining[0])-d(old[1],remaining[0]))<.025)remaining.length=0;
    }
    if(old.length===2 && remaining.length===2){
      
      const assignments=[[0,1],[1,0]].filter(([a,b])=>d(old[0],remaining[a])<.32&&d(old[1],remaining[b])<.32);
      assignments.sort((a,b)=>d(old[0],remaining[a[0]])+d(old[1],remaining[a[1]])-d(old[0],remaining[b[0]])-d(old[1],remaining[b[1]]));
      if(assignments.length){next.push({...old[0],...remaining[assignments[0][0]]},{...old[1],...remaining[assignments[0][1]]});remaining.length=0;old=[];}
    }
    for(const t of old){
      let index=-1,best=.32;
      remaining.forEach((h,i)=>{const delta=d(t,h);if(delta<best){best=delta;index=i;}});
      if(index<0){const missingSince=t.missingSince??time;if(time-missingSince<this.graceMs){retained.push({...t,missingSince});events.push({type:'missing',id:t.id});}else events.push({type:'lost',id:t.id});continue;}
      const h=remaining.splice(index,1)[0];
      next.push({...t,...h});
    }
    for(const h of remaining) next.push({...h,id:this.nextID++,down:false,armed:false,openSince:null,downSince:null,palmSince:null});
    if(this.tracks.length && ![...next,...retained].some(h=>h.id===this.tracks[0].id)){this.lastRelease=null;events.push({type:'cancel'});}
    this.tracks=[...next,...retained];
    for(const h of next){
      if(h.missingSince!==undefined){events.push({type:'reacquired',id:h.id});delete h.missingSince;}
      const isPrimary=h===next[0];
      if(h.pinch>=.46){
        if(h.openSince===null) h.openSince=time;
        if(time-h.openSince>=40) h.armed=true;
        if(h.down){
          const duration=time-h.downSince; h.down=false; events.push({type:'release',id:h.id});
          if(isPrimary&&phase==='idle'&&duration>=60&&duration<=700){
            if(this.lastRelease!==null&&time-this.lastRelease<=900&&time-this.summonAt>1200){events.push({type:'summon'});this.summonAt=time;this.lastRelease=null;}
            else this.lastRelease=time;
          }
        }
      }else{
        h.openSince=null;
        if(h.pinch<.38 && h.armed && !h.down){
          h.down=true;h.downSince=time;h.armed=false;events.push({type:'pinch',id:h.id});
        }
      }
      if(h.open&&isPrimary&&phase==='idle'){
        if(h.palmSince===null) h.palmSince=time;
        if(time-h.palmSince>=750&&time-this.summonAt>1200){events.push({type:'summon'});this.summonAt=time;h.palmSince=null;}
      }else h.palmSince=null;
    }
    return {hands:next.map(h=>({...h})),events};
  }
}




// ROI is sampled from raw video, never the rendered floor/model/overlay.
export function handCropRects(pose,width,height,slot=null){
 if(!Array.isArray(pose)||width<=0||height<=0)return [];
 const valid=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&(p.visibility??1)>=.45;
 if(!valid(pose[11])||!valid(pose[12]))return [];
 const shoulder=Math.hypot((pose[11].x-pose[12].x)*width,(pose[11].y-pose[12].y)*height),side=Math.min(width,height,clamp(shoulder*1.7,Math.min(width,height)*.16,Math.min(width,height)*.5));
 return [15,16].filter(i=>(!slot||i===(slot==='Left'?15:16))&&valid(pose[i])).map(i=>({left:clamp(pose[i].x*width-side/2,0,width-side),top:clamp(pose[i].y*height-side/2,0,height-side),width:side,height:side,wrist:i}));
}
export function remapHandResult(result,rect,width,height){
 return {landmarks:(result.landmarks||[]).map(points=>points.map(p=>({...p,x:(rect.left+p.x*rect.width)/width,y:(rect.top+p.y*rect.height)/height,z:(p.z??0)*rect.width/width}))),handedness:result.handedness||[]};
}
export function mergeHandResults(results,width,height){
 const output={landmarks:[],handedness:[]};
 for(const result of results)for(const [i,points] of (result.landmarks||[]).entries()){
  if(points.length!==21||!points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)))continue;
  if(output.landmarks.some(old=>Math.hypot((old[0].x-points[0].x)*width,(old[0].y-points[0].y)*height)<Math.max(10,Math.min(width,height)*.02)))continue;
  output.landmarks.push(points);output.handedness.push(result.handedness?.[i]||[]);
 }
 return output;
}
