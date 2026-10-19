// Reuse the existing local Pose Lite model. No image recording or network transfer.
let task;
self.onmessage=async({data})=>{try{
 if(data.type==='init'){
  const {FilesetResolver,PoseLandmarker}=await import('./vendor/vision_bundle.mjs');
  const files=await FilesetResolver.forVisionTasks(new URL('./vendor/wasm',self.location.href).href);
  const options={baseOptions:{modelAssetPath:new URL('./models/anatomy/pose-landmarker-lite.task',self.location.href).href,delegate:data.delegate==='GPU'?'GPU':'CPU'},runningMode:'VIDEO',numPoses:4,minPoseDetectionConfidence:.5,minPosePresenceConfidence:.5,minTrackingConfidence:.5,outputSegmentationMasks:false};
  try{task=await PoseLandmarker.createFromOptions(files,options);}catch(e){if(options.baseOptions.delegate==='CPU')throw e;options.baseOptions.delegate='CPU';task=await PoseLandmarker.createFromOptions(files,options);}
  self.postMessage({type:'ready',delegate:options.baseOptions.delegate});
 }else if(data.type==='frame'){
  try{if(!task)throw Error('Pose not ready');const start=performance.now(),r=task.detectForVideo(data.bitmap,data.time);self.postMessage({type:'poses',time:data.time,inferenceMs:performance.now()-start,landmarks:r.landmarks});}finally{data.bitmap?.close();}
 }
}catch(e){self.postMessage({type:'error',message:String(e.name||'PoseError')});}};
