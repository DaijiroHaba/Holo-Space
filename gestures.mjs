// Normalized screen-space observations only. No recording or persistent identifiers.
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const distance = (a, b, aspect = 1) => Math.hypot((a.x-b.x)*aspect, a.y-b.y);
export function describeHand(points, aspect = 1) {
  if (!Array.isArray(points) || points.length !== 21 || !points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
  const size = Math.max(distance(points[0],points[9],aspect), distance(points[5],points[17],aspect));
  if (size < .03) return null;
  const extended = [[8,6],[12,10],[16,14],[20,18]].filter(([tip,pip]) => distance(points[tip],points[0],aspect)>distance(points[pip],points[0],aspect)*1.1).length;
  const pinch = distance(points[4],points[8],aspect)/size;
  const palm=[0,5,9,13,17];
  const vector=i=>({x:(points[i].x-points[0].x)*aspect,y:points[i].y-points[0].y,z:Number.isFinite(points[i].z)&&Number.isFinite(points[0].z)?(points[i].z-points[0].z)*aspect:0});
  const a=vector(5),b=vector(17),normal={x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x};
  const hasDepth=[0,5,17].every(i=>Number.isFinite(points[i].z));
  const depthQuality=hasDepth?Math.abs(normal.z)/Math.max(1e-8,Math.hypot(normal.x,normal.y,normal.z)):0;
  const depthSize=Math.sqrt(distance(points[5],points[17],aspect)*distance(points[0],points[9],aspect));
  return {x:1-points[8].x,y:points[8].y,px:1-palm.reduce((n,i)=>n+points[i].x,0)/5,py:palm.reduce((n,i)=>n+points[i].y,0)/5,wx:1-points[0].x,wy:points[0].y,pinch,open:extended>=3&&pinch>.38,fist:extended===0&&pinch>.55,size,depthSize,depthQuality,depthShape:distance(points[5],points[17],aspect)/Math.max(.001,distance(points[0],points[9],aspect))};
}
export function containedPoint(x,y,videoWidth,videoHeight,width,height) {
  if (![x,y,videoWidth,videoHeight,width,height].every(Number.isFinite) || Math.min(videoWidth,videoHeight,width,height)<=0) return null;
  const scale = Math.min(width/videoWidth,height/videoHeight);
  return {x:(width-videoWidth*scale)/2+x*videoWidth*scale,y:(height-videoHeight*scale)/2+y*videoHeight*scale};
}
export class GestureEngine {
  constructor(){this.reset();}
  reset(){this.tracks=[];this.nextID=1;this.lastTime=null;this.lastRelease=null;this.summonAt=-Infinity;}
  update(observations,time,phase='model') {
    const events=[];
    if (!Number.isFinite(time)) return {hands:[],events};
    if (this.lastTime!==null && (time<=this.lastTime || time-this.lastTime>300)) this.reset();
    this.lastTime=time;
    const valid=observations.filter(h=>h&&[h.x,h.y,h.wx,h.wy,h.pinch].every(Number.isFinite)).slice(0,2);
    const remaining=[...valid], next=[];
    // A global two-hand assignment avoids detector array-order swaps.
    let old=this.tracks;
    if(old.length===2 && remaining.length===2){
      const d=(a,b)=>Math.hypot(a.wx-b.wx,a.wy-b.wy);
      const assignments=[[0,1],[1,0]].filter(([a,b])=>d(old[0],remaining[a])<.32&&d(old[1],remaining[b])<.32);
      assignments.sort((a,b)=>d(old[0],remaining[a[0]])+d(old[1],remaining[a[1]])-d(old[0],remaining[b[0]])-d(old[1],remaining[b[1]]));
      if(assignments.length){next.push({...old[0],...remaining[assignments[0][0]]},{...old[1],...remaining[assignments[0][1]]});remaining.length=0;old=[];}
    }
    for(const t of old){
      let index=-1,best=.32;
      remaining.forEach((h,i)=>{const d=Math.hypot(t.wx-h.wx,t.wy-h.wy);if(d<best){best=d;index=i;}});
      if(index<0){events.push({type:'lost',id:t.id});continue;}
      const h=remaining.splice(index,1)[0];
      next.push({...t,...h});
    }
    for(const h of remaining) next.push({...h,id:this.nextID++,down:false,armed:false,openSince:null,downSince:null,palmSince:null});
    if(this.tracks.length && !next.some(h=>h.id===this.tracks[0].id)){this.lastRelease=null;events.push({type:'cancel'});}
    this.tracks=next;
    for(const h of next){
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


