import {PLAYER_LIMITS} from './player-input.mjs';
export class PlayerPoseSource{
 constructor(onResult,onState){this.onResult=onResult;this.onState=onState;this.worker=null;this.generation=0;this.busy=false;this.ready=false;this.last=-Infinity;this.inferenceMs=0;}
 stop(){this.generation++;clearTimeout(this.watchdog);this.worker?.terminate();this.worker=null;this.busy=false;this.ready=false;this.last=-Infinity;}
 start(delegate='CPU'){
  this.stop();const generation=this.generation;this.onState('loading',null);
  return new Promise((resolve,reject)=>{let initialized=false;
   const fail=()=>{if(generation!==this.generation)return;this.stop();this.onState('failed',null);if(!initialized)reject(Error('PoseWorkerUnavailable'));};
   try{
    const worker=this.worker=new Worker(new URL('./player-pose-worker.mjs?v=0.17',import.meta.url));this.watchdog=setTimeout(fail,20000);
    worker.onerror=fail;worker.onmessage=({data})=>{
     if(generation!==this.generation)return;
     if(data.type==='ready'){clearTimeout(this.watchdog);initialized=true;this.ready=true;this.delegate=data.delegate;this.onState('ready',data.delegate);resolve(this);return;}
     if(data.type==='error'){fail();return;}
     if(data.type==='poses'){clearTimeout(this.watchdog);this.busy=false;this.inferenceMs=data.inferenceMs;try{this.onResult(data);}catch{fail();}}
    };worker.postMessage({type:'init',delegate});
   }catch{fail();}
  });
 }
 async tick(video,time){
  if(!this.ready||this.busy||video.readyState<2||time-this.last<Math.max(PLAYER_LIMITS.poseIntervalMs,Math.min(PLAYER_LIMITS.poseMaxIntervalMs,this.inferenceMs*(this.delegate==='CPU'?4:3))))return;
  this.busy=true;this.last=time;const worker=this.worker,generation=this.generation;
  let bitmap;try{const width=Math.min(640,video.videoWidth),height=Math.max(1,Math.round(width*video.videoHeight/video.videoWidth));bitmap=await createImageBitmap(video,{resizeWidth:width,resizeHeight:height});
   if(generation!==this.generation||worker!==this.worker){bitmap.close();return;}
   this.watchdog=setTimeout(()=>{if(generation===this.generation){this.stop();this.onState('failed',null);}},3000);worker.postMessage({type:'frame',bitmap,time},[bitmap]);bitmap=null;
  }catch{bitmap?.close();if(generation===this.generation){this.stop();this.onState('failed',null);}}
 }
}
