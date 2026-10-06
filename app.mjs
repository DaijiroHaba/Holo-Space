import {createScene} from './model.mjs';
import {GestureEngine,describeHand,containedPoint,clamp} from './gestures.mjs';
import {Manipulator} from './manipulation.mjs';
import {SummonGate,TapRouter} from './interaction-flow.mjs';
const $=id=>document.getElementById(id),lab=$('lab'),video=$('camera'),overlay=$('hand-overlay'),ctx=overlay.getContext('2d');
const names={single:'人体模型',muscle:'筋肉',skeleton:'骨格',organs:'臓器',panel:'浮遊パネル'},layerNames={whole:'筋肉',skeleton:'骨格',organs:'臓器'};
const base=(layer='whole',x=0,scale=1)=>({x,y:0,z:0,scale,rotation:-.15,tilt:0,roll:0,visible:true,layer});
const initial=()=>({single:base('whole',-.4),muscle:base('whole',-1.65,.78),skeleton:base('skeleton',0,.78),organs:base('organs',1.65,.78),panel:{...base('panel',1.55,.8),y:.65,z:-.6,rotation:0}});
let objects=initial(),compare=false,selected=null,hovered=null,phase='lobby',mode='preview',immersive=false,stage='lobby',menu=false,operation='place',lastBody='single';
let stream=null,detector=null,detectorPromise=null,cameraToken=0,lastInference=0,lastVideoTime=-1,tracked=[],pointerDrag=null,grip=null,hoverButton=null,summonProgress=0,fistSince=null;
const gesture=new GestureEngine(),summon=new SummonGate(),tap=new TapRouter(),manipulator=new Manipulator({reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches});
const smoothing=new Map(),aims=new Map();let smoothTime=0,scene,controlsDrag=null,controlsPointer=null,controlsPosition=null;
const timing={inferenceMs:[],intervalMs:[],updateMs:[]};const recordTime=(key,value)=>{timing[key].push(value);if(timing[key].length>180)timing[key].shift();};
try{scene=createScene($('scene'),(n,total)=>$('model-progress').textContent=`読み込み ${n} / ${total}`);}catch(e){$('error').hidden=false;$('error').textContent='3D表示を開始できません。ブラウザのハードウェアアクセラレーションを確認してください。';throw e;}
const bodyIds=()=>compare?['muscle','skeleton','organs']:['single'];
const activeIds=()=>[...bodyIds(),'panel'];
const activeObjects=()=>Object.fromEntries(activeIds().map(id=>[id,{...objects[id],visible:stage==='workspace'&&objects[id].visible}]));
const label=id=>id==='single'?`人体 · ${layerNames[objects.single.layer]}`:names[id];
const hints={lobby:'開いた手を3秒かざす → メニュー → 1回タップ',menu:'アイコンに指先を合わせ、つけて離すと決定',unselected:'光る枠内でつまむと、そのままつかめます',placed:'配置しました / 枠内をつまむと、また動かせます',drag:'つかめました / 手に追従して移動・離すと配置',zoom:'両手でつかんでいます / 間隔で拡大・縮小',rotate:'回転中 / つまむ・握る・停止ボタンで止まります',coasting:'慣性で回転中 / 停止ボタン・握る・つまむで停止',ready:'操作パネルでモードを選択 / 光る枠内をつまんで移動',calibrating:'押し引き準備 / 手のひらを正面に向け、一瞬静止',near:'手と一緒に手前へ / 離すと配置',far:'手と一緒に奥へ / 離すと配置',dual:'両手で操作中 / 前後差で回転・間隔で拡大・離して配置','dual-uncertain':'奥行き・倍率を保留 / 掌を正面に向けて一瞬静止','dual-depth':'前後を操作中 / 間隔ズームは一時保留','depth-hold':'奥行き操作 / 止めるには下の「操作を停止」','depth-uncertain':'押し引きには手のひらを正面に向けて一瞬静止',paused:'手を確認中 / 模型の配置を保持しています',reacquire:'手をゆっくり戻してください / 配置を保持',stopped:'止めました / 枠内をつまめば、そのまま再操作',ui:'指先でアイコンをタップ / つけて離すと決定',pinch:'つまみを認識 / 光る枠内からつかんでください'};
const badges={lobby:'SUMMON',menu:'TAP',unselected:'GRAB AREA',placed:'PLACED',drag:'GRABBED',zoom:'2 HANDS',rotate:'ROTATE',coasting:'SLOWING',ready:'READY',calibrating:'DEPTH',near:'NEAR',far:'FAR',dual:'2 HANDS · SPACE','dual-uncertain':'2 HANDS · HOLD','dual-depth':'2 HANDS · DEPTH','depth-hold':'DEPTH','depth-uncertain':'HAND FRONT',paused:'WAIT',reacquire:'WAIT',stopped:'STOPPED',ui:'TAP',pinch:'PINCH'};
function status(message){if($('status-text').textContent!==message)$('status-text').textContent=message;}
function setPhase(value,message){phase=value;$('phase-badge').textContent=badges[value]||value;status(message||hints[value]||hints.ready);}
function cancelPointer(){if(pointerDrag){const id=pointerDrag.id;pointerDrag=null;try{if(scene.renderer.domElement.hasPointerCapture(id))scene.renderer.domElement.releasePointerCapture(id);}catch{}}}
function releaseMotion(){manipulator.reset();grip=null;controlsDrag=null;cancelPointer();}
function resetInput(){gesture.reset();tap.reset();summon.reset();releaseMotion();tracked=[];smoothing.clear();aims.clear();smoothTime=0;hovered=null;fistSince=null;summonProgress=0;setHover(null);$('tap-cursor').hidden=true;}
function select(id,{preserveTap=false}={}){if(id&&(!activeIds().includes(id)||!objects[id].visible))return;selected=id;if(id&&id!=='panel')lastBody=id;releaseMotion();operation='place';if(!preserveTap)tap.guard(performance.now());setPhase(id?'ready':'unselected');refresh();}
function stopMotion(){releaseMotion();operation='place';tap.reset();manipulator.stop();setPhase('stopped');refresh();}
function refresh(){
 $('summon-menu').hidden=!menu;$('summon-guide').hidden=stage!=='lobby'||menu;
 $('compare').setAttribute('aria-pressed',String(compare));$('compare').textContent=compare?'◧ 1体表示に戻る':'◫ 3体比較表示';$('layers').hidden=compare;$('model-count').textContent=compare?'3 MODELS':'1 MODEL';
 $('model-list').replaceChildren(...activeIds().map(id=>{const row=document.createElement('div');row.className='model-row';const b=document.createElement('button');b.className='choose';b.dataset.model=id;b.dataset.action=`select-${id}`;b.textContent=label(id);b.setAttribute('aria-pressed',String(selected===id));b.disabled=!objects[id].visible;const v=document.createElement('button');v.className='visibility';v.dataset.action=`visibility-${id}`;v.dataset.visibility=id;v.textContent=objects[id].visible?'表示中':'非表示';v.setAttribute('aria-label',`${label(id)}を${objects[id].visible?'隠す':'表示'}`);row.append(b,v);return row;}));
 document.querySelectorAll('[data-layer]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.layer===objects.single.layer)));
 $('selected-name').textContent=selected?label(selected):'未選択';$('selected-help').textContent=operation==='rotate'?'回転モード / つまむと停止して移動':operation==='dual'?'両手で自由操作 / 2本のつまみで保持':operation==='depth'?'掌に合わせて上下左右・奥行き移動':'光る枠内をつまんで直接つかむ';
 $('mode-controls').hidden=stage!=='workspace'||menu||!$('settings-panel').hidden;for(const op of ['place','rotate','dual']){$('mode-'+op).setAttribute('aria-pressed',String(operation===op));$('mode-'+op).disabled=!selected;}
 $('toggle-panel').textContent=objects.panel.visible?'浮遊パネルを隠す':'浮遊パネルを表示';$('depth-mode').setAttribute('aria-pressed',String(operation==='depth'));
 for(const id of ['zoom-in','zoom-out','depth-near','depth-far','depth-mode','deselect'])$(id).disabled=!selected;$('reset').disabled=stage!=='workspace';$('close-menu').textContent=stage==='workspace'?'空間へ戻る':'かざす画面へ戻る';
}
function openMenu(){menu=true;summon.reset();summonProgress=0;releaseMotion();operation='place';tap.guard(performance.now(),450);setHover(null);refresh();setPhase('menu');}
function closeMenu(){menu=false;releaseMotion();operation='place';tap.guard(performance.now(),350);refresh();setPhase(stage==='workspace'?'placed':'lobby');}
function showBody(layer){compare=false;objects.single.layer=layer;objects.single.visible=true;stage='workspace';menu=false;select('single');refresh();}
function setImmersive(value){immersive=value;lab.classList.toggle('immersive',value);$('restore-ui').hidden=!value;releaseMotion();operation='place';tap.guard(performance.now(),400);setPhase('placed',value?'没入表示 / 下のボタンは手のタップでも使えます':'操作画面を戻しました / そのまま手で操作できます');}
function adjust(fn){if(!selected)return;releaseMotion();operation='place';fn(objects[selected]);setPhase('placed');}
function point(x,y){return containedPoint(x,y,video.videoWidth||1280,video.videoHeight||720,lab.clientWidth,lab.clientHeight);}
function actionableAt(p){
 const exact=document.elementFromPoint(p.x,p.y)?.closest('button[data-action]');if(exact&&!exact.disabled)return exact;
 const buttons=[...document.querySelectorAll('button[data-action]')].filter(b=>!b.disabled&&b.getClientRects().length&&(!menu||b.closest('#summon-menu,#safety-controls')));
 return buttons.map(b=>{const r=b.getBoundingClientRect();return {b,d:Math.hypot(p.x-clamp(p.x,r.left,r.right),p.y-clamp(p.y,r.top,r.bottom))};}).filter(v=>v.d<=24).sort((a,b)=>a.d-b.d)[0]?.b||null;
}
function controlHandleAt(p){const r=$('mode-handle').getBoundingClientRect();return !$('mode-controls').hidden&&p.x>=r.left&&p.x<=r.right-42&&p.y>=r.top-8&&p.y<=r.bottom+5;}
function overControls(p){const r=$('mode-controls').getBoundingClientRect();return !$('mode-controls').hidden&&p.x>=r.left&&p.x<=r.right&&p.y>=r.top&&p.y<=r.bottom;}
function moveControls(x,y){controlsPosition={x,y};fitHandControls();}
function setHover(button){if(hoverButton===button)return;hoverButton?.classList.remove('hand-hover','hand-pressed');hoverButton=button;hoverButton?.classList.add('hand-hover');}
function runAction(action,source='mouse'){
 if(!action||!scene.meta.ready)return;const previousOperation=operation;tap.guard(performance.now(),source==='hand'?300:120);releaseMotion();operation=action==='settings-toggle'?previousOperation:'place';
 if(action.startsWith('summon-'))showBody(action.slice(7));
 else if(action.startsWith('select-')){stage='workspace';select(action.slice(7));}
 else if(action.startsWith('visibility-')){const id=action.slice(11);objects[id].visible=!objects[id].visible;if(selected===id)select(null);refresh();}
 else switch(action){
  case 'open-menu':openMenu();break;
  case 'close-menu':closeMenu();break;
  case 'stop':stopMotion();break;
  case 'reset':{const id=selected||lastBody;if(stage==='workspace'&&id){const layer=objects[id].layer;objects[id]={...initial()[id],layer};select(id);setPhase('placed','中央へ戻しました / 枠内をつまんで再操作');}break;}
  case 'center-body':{const id=bodyIds().includes(lastBody)?lastBody:bodyIds()[0];objects[id]={...initial()[id],layer:objects[id].layer};select(id);setPhase('placed','人体を中央へ戻しました');break;}
  case 'settings-toggle':$('settings-panel').hidden=!$('settings-panel').hidden;setPhase('ui','設定のボタンも指先の1回タップで操作できます');break;
  case 'compare':compare=!compare;stage='workspace';select(null);break;
  case 'show-panel':objects.panel.visible=true;stage='workspace';menu=false;select('panel');break;
  case 'toggle-panel':objects.panel.visible=!objects.panel.visible;if(selected==='panel'&&!objects.panel.visible)select(null);refresh();break;
  case 'controls-home':controlsPosition=null;fitHandControls();setPhase('placed','操作パネルを端へ戻しました');break;
  case 'mode-place':operation='place';setPhase('ready');break;
  case 'mode-rotate':operation='rotate';setPhase('ready','掌で回転 / 手を開いて動かす・停止で止まる');break;
  case 'mode-dual':operation='dual';setPhase('ready','両手で自由操作 / 枠内で片手をつかみ、もう片手もつまむ');break;
  case 'depth-mode':operation='depth';setPhase('calibrating','掌を正面へ / 近づけると模型も手前へ');break;
  case 'zoom-in':adjust(s=>s.scale=clamp(s.scale*1.35,.2,selected==='panel'?3:64));break;
  case 'zoom-out':adjust(s=>s.scale=clamp(s.scale/1.35,selected==='panel'?.35:.2,selected==='panel'?3:64));break;
  case 'depth-far':adjust(s=>s.z=clamp(s.z-.6,-8,1.6));break;
  case 'depth-near':adjust(s=>s.z=clamp(s.z+.6,-8,1.6));break;
  case 'deselect':select(null);break;
  case 'immersive':setImmersive(true);break;
  case 'restore-ui':setImmersive(false);break;
  case 'stop-camera':stopCamera();break;
  case 'fullscreen':(document.fullscreenElement?document.exitFullscreen():lab.requestFullscreen()).catch(()=>status('全画面表示を開始できませんでした'));break;
 }
 refresh();
}
function updateHands(time,result){
 const aspect=(video.videoWidth||1280)/(video.videoHeight||720),observations=(result.landmarks||[]).map(points=>{const h=describeHand(points,aspect);return h?{...h,points}:null;});
 const data=gesture.update(observations,time,'model'),dt=smoothTime?Math.min(100,time-smoothTime):30;smoothTime=time;
 tracked=data.hands.map(h=>{const old=smoothing.get(h.id),alpha=old?1-Math.exp(-dt/18):1,v={px:old?old.px+(h.px-old.px)*alpha:h.px,py:old?old.py+(h.py-old.py)*alpha:h.py};smoothing.set(h.id,v);const p=point(h.x,h.y),handle=controlHandleAt(p);let button=handle?null:actionableAt(p),actionId=button?.dataset.action||(!handle&&!overControls(p)&&!menu&&stage==='workspace'?scene.panelActionAt(p.x,p.y):null);const aim=aims.get(h.id);if(data.events.some(e=>e.type==='pinch'&&e.id===h.id)&&!handle&&aim&&time-aim.time<240&&Math.hypot(h.px-aim.px,h.py-aim.py)<.07&&(!aim.button||(!aim.button.disabled&&aim.button.getClientRects().length>0))){button=aim.button;actionId=aim.actionId;}if(!h.down&&h.pinch>=.46&&actionId)aims.set(h.id,{time,px:h.px,py:h.py,button,actionId});return {...h,...v,button,actionId,hoverId:handle?'controls':!button&&!overControls(p)&&!menu&&stage==='workspace'?scene.hit(p.x,p.y):null};});
 for(const id of smoothing.keys())if(!tracked.some(h=>h.id===id)){smoothing.delete(id);aims.delete(id);}
 $('hand-count').textContent=`検出 ${tracked.length} 手`;hovered=tracked[0]?.hoverId||null;
 const g=summon.update(tracked,time,stage==='lobby'&&!menu);summonProgress=g.progress;$('summon-ring').style.strokeDashoffset=String(326.73*(1-g.progress));$('summon-number').textContent=g.progress?`${Math.max(1,Math.ceil(3-g.progress*3))}`:'3';$('summon-title').textContent=g.progress?'手を認識しています。そのまま…':'手を開いて、3秒かざす';
 if(g.ready){openMenu();return;}
 const actions=tap.update(tracked,data.events,time),uiPress=tap.press?.kind==='ui',primary=tracked.find(h=>h.id===tap.press?.id)||tracked.find(h=>h.actionId)||tracked[0],p=primary?point(primary.x,primary.y):null;
 setHover(primary?.button||null);hoverButton?.classList.toggle('hand-pressed',!!uiPress);
 $('tap-cursor').hidden=!p;if(p){$('tap-cursor').style.left=`${p.x}px`;$('tap-cursor').style.top=`${p.y}px`;$('tap-cursor').classList.toggle('pressed',!!primary.down);$('tap-cursor-label').textContent=primary.pinch<.38&&!primary.down?'いったん指を開く':uiPress?'離すと決定':primary.actionId?'1回タップで選択':grip?'つかめています':primary.hoverId?'ここをつまんで移動':'枠内をつまむ';}
 for(const event of actions){
  if(event.type==='tap'){runAction(event.target,'hand');return;}
  if(event.type==='grab'&&!menu&&stage==='workspace'&&!grip&&!controlsDrag){if(event.target==='controls'){releaseMotion();operation='place';const hand=tracked.find(h=>h.id===event.id),r=$('mode-controls').getBoundingClientRect();controlsDrag={id:hand.id,px:hand.px,py:hand.py,x:r.left,y:r.top};refresh();}else{const op=operation;select(event.target,{preserveTap:true});grip={target:event.target};operation=op==='dual'?'dual':'place';refresh();}}
 }
 if(menu){releaseMotion();setPhase('menu');return;}
 if(stage==='lobby'){setPhase('lobby',g.progress?'手を認識 / 光の円が満ちるまで、そのままかざす':undefined);return;}
 if(pointerDrag||controlsPointer)return;
 if(uiPress){releaseMotion();setPhase('ui');return;}
 if(controlsDrag){const hand=tracked.find(h=>h.id===controlsDrag.id);if(!hand?.down){controlsDrag=null;setPhase('placed','操作パネルを配置しました');}else{const a=point(controlsDrag.px,controlsDrag.py),b=point(hand.px,hand.py);moveControls(controlsDrag.x+b.x-a.x,controlsDrag.y+b.y-a.y);setPhase('drag','操作パネルを移動中 / 離すと配置');}return;}
 if(data.events.some(e=>e.type==='lost'||e.type==='cancel')){releaseMotion();tap.reset();setPhase('reacquire');return;}

 if(!grip&&tracked.length===1&&primary.fist){fistSince??=time;releaseMotion();if(time-fistSince>=140)stopMotion();else setPhase('paused');return;}fistSince=null;
 if(!tracked.length){releaseMotion();setPhase('placed');return;}
 if(!grip&&primary.pinch<.38&&!primary.down){manipulator.reset();setPhase('pinch','つまみを認識 / 一度指を開いてから、枠内でつまんでください');return;}
 if(grip&&!tracked.some(h=>h.down)){grip=null;manipulator.reset();setPhase('placed');}
 if(!grip&&(uiPress||tracked.some(h=>h.actionId)||primary.hoverId==='controls')){manipulator.reset();setPhase('ui');return;}
 if(!grip&&primary.down){manipulator.reset();setPhase('pinch');return;}
 if(!grip&&(operation==='place'||operation==='dual'||!selected)){if(!manipulator.stopped)manipulator.reset();setPhase(manipulator.stopped?'stopped':selected?'ready':'unselected');return;}
 const outcome=manipulator.update(tracked,time,{state:objects[selected],key:selected,aspect,...scene.motionScale(objects[selected].z,video.videoWidth||1280,video.videoHeight||720),operation,maxScale:selected==='panel'?3:64,minScale:selected==='panel'?.35:.2});
 if(outcome.state)objects[selected]=outcome.state;setPhase(outcome.phase,outcome.phase==='ready'&&operation==='rotate'?'掌で回転 待機中 / 手を開いて動かす':undefined);
}
const edges=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
function drawFeedback(){
 ctx.clearRect(0,0,overlay.width,overlay.height);
 if(!menu)for(const [id,b]of Object.entries(scene.projections())){
  if(!b.visible)continue;const chosen=selected===id,over=hovered===id,grabbing=grip?.target===id;const color=grabbing?'#fface5':chosen?'#ffe1a0':over?'#97fff0':'#71b8ba';ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=chosen||over?2:1;
  const l=Math.max(10,b.left-44),r=Math.min(overlay.width-10,b.right+44),t=Math.max(82,b.top-36),bot=Math.min(overlay.height-155,b.bottom+36),d=20;
  if(r>l&&bot>t){ctx.globalAlpha=chosen||over?.5:.22;ctx.setLineDash([5,9]);ctx.strokeRect(l,t,r-l,bot-t);ctx.setLineDash([]);ctx.globalAlpha=1;ctx.shadowColor=color;ctx.shadowBlur=chosen||over?10:0;for(const [x,y,sx,sy]of[[l,t,1,1],[r,t,-1,1],[l,bot,1,-1],[r,bot,-1,-1]]){ctx.beginPath();ctx.moveTo(x+d*sx,y);ctx.lineTo(x,y);ctx.lineTo(x,y+d*sy);ctx.stroke();}}
  if(id!=='panel'&&operation==='dual'&&r>l&&bot>t){for(const x of [l,r]){ctx.beginPath();ctx.arc(x,(t+bot)/2,13,0,Math.PI*2);ctx.lineWidth=2;ctx.stroke();ctx.beginPath();ctx.arc(x,(t+bot)/2,4,0,Math.PI*2);ctx.fill();}}
  ctx.shadowBlur=0;ctx.font='12px "Yu Gothic UI",sans-serif';ctx.textAlign='center';ctx.fillText(`${label(id)} · ${grabbing?'つかめています':id==='panel'?'上の帯をつまんで移動':chosen&&operation==='rotate'?'手を払って回転':'枠内をつまんで移動'}`,clamp((b.left+b.right)/2,100,overlay.width-100),clamp(t-12,82,overlay.height-172));ctx.restore();
 }
 for(const h of tracked){
  const grabbed=(!!grip||controlsDrag?.id===h.id)&&h.down&&!menu,pinched=h.down||h.pinch<.38,color=grabbed?'#fface5':pinched?'#ffe1a0':'#78f6e4',pts=h.points.map(p=>point(1-p.x,p.y));ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.globalAlpha=.5;ctx.lineWidth=1.1;
  for(const [a,b]of edges){ctx.beginPath();ctx.moveTo(pts[a].x,pts[a].y);ctx.lineTo(pts[b].x,pts[b].y);ctx.stroke();}ctx.globalAlpha=1;ctx.shadowColor=color;ctx.shadowBlur=h.down?20:9;
  if(h.down||h.pinch<.38){ctx.lineWidth=grabbed?5:3;ctx.beginPath();ctx.moveTo(pts[4].x,pts[4].y);ctx.lineTo(pts[8].x,pts[8].y);ctx.stroke();}
  for(const i of [4,8]){ctx.beginPath();ctx.arc(pts[i].x,pts[i].y,h.down?6:4,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(pts[i].x,pts[i].y,grabbed?15:10,0,Math.PI*2);ctx.lineWidth=1;ctx.stroke();}
  ctx.shadowBlur=0;ctx.font='11px "Yu Gothic UI",sans-serif';ctx.fillText(grabbed?'◆ つかめています':pinched?'● つまみ認識':'○ 手を検出',pts[4].x+16,pts[4].y+23);ctx.restore();
 }
}
async function getDetector(){
  if(detector)return detector;
  if(!detectorPromise)detectorPromise=(async()=>{const {FilesetResolver,HandLandmarker}=await import('./vendor/vision_bundle.mjs');const files=await FilesetResolver.forVisionTasks('./vendor/wasm');const options={baseOptions:{modelAssetPath:'./models/hand_landmarker.task',delegate:'GPU'},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.5,minHandPresenceConfidence:.5,minTrackingConfidence:.5};try{return await HandLandmarker.createFromOptions(files,options);}catch{options.baseOptions.delegate='CPU';return await HandLandmarker.createFromOptions(files,options);}})().then(d=>{detector=d;return d;}).catch(e=>{detectorPromise=null;throw e;});return detectorPromise;
}
async function startCamera(){
  if(mode==='camera'||mode==='loading'||!scene.meta.ready)return;const token=++cameraToken;mode='loading';$('start').disabled=true;$('start').textContent='カメラを準備中…';$('stop-camera').hidden=false;$('error').hidden=true;status('カメラの使用許可を確認してください');let acquired=null;
  try{
    const device=$('camera-device').value;acquired=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},frameRate:{ideal:60,max:60},...(device?{deviceId:{exact:device}}:{facingMode:'user'})},audio:false});
    if(token!==cameraToken){acquired.getTracks().forEach(t=>t.stop());return;}
    stream=acquired;video.srcObject=stream;await video.play();await getDetector();if(token!==cameraToken)return;
    mode='camera';resetInput();lastVideoTime=-1;lastInference=performance.now();lab.classList.add('camera-on');$('mode-tag').textContent='CAMERA · LOCAL';$('start').hidden=true;refresh();setPhase(stage==='lobby'?'lobby':selected?'ready':'unselected');
    stream.getVideoTracks().forEach(t=>t.addEventListener('ended',()=>{if(mode==='camera')cameraFailure('カメラの接続が切れました。もう一度開始してください。');},{once:true}));
    try{const devices=await navigator.mediaDevices.enumerateDevices();if(token!==cameraToken)return;$('camera-device').replaceChildren(...devices.filter(d=>d.kind==='videoinput').map((d,i)=>{const o=document.createElement('option');o.value=d.deviceId;o.textContent=d.label||`カメラ ${i+1}`;return o;}));$('camera-device').value=stream.getVideoTracks()[0].getSettings().deviceId;$('camera-device-label').hidden=false;}catch{}
  }catch(e){acquired?.getTracks().forEach(t=>t.stop());if(token!==cameraToken)return;cameraFailure(e.name==='NotAllowedError'?'カメラが許可されていません。ブラウザのカメラ設定から許可してください。':e.name==='NotReadableError'?'カメラを使用できません。他のアプリの使用状況を確認してください。':'カメラまたは手の認識を開始できませんでした。接続を確認して再試行してください。');console.warn('Camera initialization:',e.name);}
  finally{if(token===cameraToken){$('start').disabled=false;$('start').textContent='◉ カメラで体験';}}
}
function stopCamera(){++cameraToken;mode='preview';stream?.getTracks().forEach(t=>t.stop());stream=null;video.pause();video.srcObject=null;resetInput();lab.classList.remove('camera-on');$('start').hidden=false;$('start').disabled=!scene.meta.ready;$('start').textContent='◉ カメラで体験';$('stop-camera').hidden=true;$('hand-count').textContent='検出 0 手';$('mode-tag').textContent='PREVIEW';setPhase('placed','カメラを停止 / すべての配置を保持しています');}
function cameraFailure(message){stopCamera();$('error').hidden=false;$('error').textContent=message;}

function fitHandControls(){const lo=mode==='camera'?point(0,0):{x:0,y:80},hi=mode==='camera'?point(1,1):{x:lab.clientWidth,y:lab.clientHeight};const bottom=Math.max(immersive?20:34,lab.clientHeight-hi.y+16);lab.style.setProperty('--dock-bottom',bottom+'px');lab.style.setProperty('--feedback-bottom',(bottom+64)+'px');const panel=$('mode-controls'),w=panel.offsetWidth||240,h=panel.offsetHeight||262,minX=lo.x+8,maxX=Math.max(minX,hi.x-w-8),minY=Math.max(86,lo.y+8),maxY=Math.max(minY,hi.y-h-88);const desired=controlsPosition||{x:maxX,y:lab.clientHeight*.58};const x=clamp(desired.x,minX,maxX),y=clamp(desired.y,minY,maxY);panel.style.left=x+'px';panel.style.top=y+'px';if(controlsPosition)controlsPosition={x,y};}
function frame(time){
 requestAnimationFrame(frame);
 if(mode==='camera'&&video.readyState>=2&&time-lastInference>=20&&video.currentTime!==lastVideoTime){recordTime('intervalMs',time-lastInference);lastInference=time;lastVideoTime=video.currentTime;try{const started=performance.now(),result=detector.detectForVideo(video,time),detected=performance.now();recordTime('inferenceMs',detected-started);updateHands(time,result);recordTime('updateMs',performance.now()-detected);}catch(e){cameraFailure('手の認識が中断しました。カメラを再開してください。');console.error(e);}}
 else if(mode==='camera'&&time-lastInference>350){resetInput();setPhase('paused','映像を待っています / 動きを停止して配置を保持');}
 fitHandControls();scene.render(activeObjects(),selected,phase,hovered);drawFeedback();
 const s=selected?objects[selected]:null;$('scale-value').textContent=s?`${s.scale.toFixed(2)} ×`:'—';$('depth-value').textContent=s?(Math.abs(s.z)<.05?'基準位置':`${s.z<0?'奥':'手前'} ${Math.abs(s.z).toFixed(1)}`):'—';
}
new ResizeObserver(()=>{scene.resize();overlay.width=lab.clientWidth;overlay.height=lab.clientHeight;resetInput();operation='place';}).observe(lab);
$('start').onclick=startCamera;$('camera-device').onchange=()=>{if(mode==='camera'){stopCamera();startCamera();}};
document.addEventListener('click',e=>{const b=e.target.closest('button[data-action]');if(b&&!b.disabled)runAction(b.dataset.action);});
const modeHandle=$('mode-handle');
modeHandle.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('button'))return;releaseMotion();operation='place';tap.reset();const r=$('mode-controls').getBoundingClientRect();controlsPointer={id:e.pointerId,x:e.clientX,y:e.clientY,left:r.left,top:r.top};modeHandle.setPointerCapture(e.pointerId);refresh();e.preventDefault();});
modeHandle.addEventListener('pointermove',e=>{if(!controlsPointer)return;const p=controlsPointer;moveControls(p.left+e.clientX-p.x,p.top+e.clientY-p.y);});
for(const event of ['pointerup','pointercancel','lostpointercapture'])modeHandle.addEventListener(event,()=>{controlsPointer=null;});
const canvas=scene.renderer.domElement;
canvas.addEventListener('pointerdown',e=>{if(e.button!==0||menu||stage!=='workspace')return;const box=lab.getBoundingClientRect(),x=e.clientX-box.left,y=e.clientY-box.top,action=scene.panelActionAt(x,y);if(action){runAction(action);return;}const id=scene.hit(x,y);if(!id)return;select(id);canvas.setPointerCapture(e.pointerId);pointerDrag={id:e.pointerId,x:e.clientX,y:e.clientY,state:{...objects[id]},move:e.shiftKey||id==='panel',depth:e.altKey};});
canvas.addEventListener('pointermove',e=>{if(!pointerDrag||!selected)return;const p=pointerDrag,dx=e.clientX-p.x,dy=e.clientY-p.y,s=objects[selected];if(p.depth){s.z=clamp(p.state.z-dy*.012,-8,1.6);setPhase('push');}else if(p.move){const m=scene.motionScale(s.z,lab.clientWidth,lab.clientHeight);s.x=clamp(p.state.x+dx/lab.clientWidth*m.worldPerX,-14,14);s.y=clamp(p.state.y-dy/lab.clientHeight*m.worldPerY,-10,10);setPhase('drag');}else{s.rotation=p.state.rotation+dx*.006;s.tilt=p.state.tilt+dy*.006;setPhase('rotate');}});
for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>{if(pointerDrag){pointerDrag=null;manipulator.reset();operation='place';setPhase('placed');}});
canvas.addEventListener('wheel',e=>{e.preventDefault();if(!selected||menu)return;adjust(s=>{if(e.altKey)s.z=clamp(s.z-e.deltaY*.004,-8,1.6);else s.scale=clamp(s.scale*Math.exp(-e.deltaY*.0018),selected==='panel'?.35:.2,selected==='panel'?3:64);});},{passive:false});
addEventListener('keydown',e=>{if(e.target.matches('input,select,textarea'))return;if(e.key==='Escape'){if(menu)closeMenu();else if(immersive)setImmersive(false);else stopMotion();}if(e.key.toLowerCase()==='i'&&!e.ctrlKey&&!e.metaKey)setImmersive(!immersive);if(e.code==='Space'&&!e.target.matches('button,a')){e.preventDefault();stopMotion();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(mode==='camera'||mode==='loading'))stopCamera();});addEventListener('pagehide',()=>{stream?.getTracks().forEach(t=>t.stop());detector?.close();});
scene.ready.then(()=>{$('model-loading').hidden=true;$('start').disabled=false;status('カメラで手を3秒かざす / マウスならメニューを開く');}).catch(e=>{$('model-loading').querySelector('strong').textContent='解剖モデルを読み込めませんでした';$('model-progress').textContent='起動用ファイルから再読み込みしてください';console.error(e);});
refresh();requestAnimationFrame(frame);
Object.defineProperty(window,'holoSnapshot',{value:()=>({version:'0.8',mode,stage,menu,compare,selected,hovered,phase,operation,immersive,summonProgress,gripping:grip?.target||(controlsDrag?'controls':null),controlsPosition:controlsPosition?{...controlsPosition}:null,objects:structuredClone(objects),stopped:manipulator.stopped,anatomy:{...scene.meta},trackedHands:tracked.length,handFeedback:tracked.map(h=>({id:h.id,pinched:h.down,armed:h.armed,hoverId:h.hoverId,actionId:h.actionId,grabbed:!!grip&&h.down})),tapTarget:tap.press?{kind:tap.press.kind,target:tap.press.target}:null,cameraActive:!!stream,detectorReady:!!detector,timing:Object.fromEntries(Object.entries(timing).map(([k,v])=>{const a=[...v].sort((a,b)=>a-b);return [k,{samples:a.length,median:a[Math.floor(a.length*.5)]||0,p95:a[Math.floor(a.length*.95)]||0}];})),renderSpace:scene.getRenderState()}),writable:false});





