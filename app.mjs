import {createScene} from './model.mjs?v=0.11';
import {GestureEngine,describeHand,containedPoint,clamp} from './gestures.mjs?v=0.11';
import {Manipulator} from './manipulation.mjs?v=0.11';
import {SummonGate,TapRouter,RotationHandoff,routeHandTargets} from './interaction-flow.mjs?v=0.11';
const $=id=>document.getElementById(id),lab=$('lab'),video=$('camera'),overlay=$('hand-overlay'),ctx=overlay.getContext('2d');
const names={single:'人体模型',muscle:'筋肉',skeleton:'骨格',organs:'臓器',panel:'浮遊パネル'},layerNames={whole:'筋肉',skeleton:'骨格',organs:'臓器'};
const base=(layer='whole',x=0,scale=1)=>({x,y:0,z:0,scale,rotation:-.15,tilt:0,roll:0,visible:true,layer});
const initial=()=>({single:base('whole',-.4),muscle:base('whole',-1.65,.78),skeleton:base('skeleton',0,.78),organs:base('organs',1.65,.78),panel:{...base('panel',1.55,.8),y:.65,z:-.6,rotation:0}});
let operationPaused=false,rotationProgress=0;
let objects=initial(),compare=false,selected=null,hovered=null,phase='lobby',mode='preview',immersive=false,stage='lobby',menu=false,operation='place',lastBody='single';
let stream=null,detector=null,detectorPromise=null,cameraToken=0,lastInference=0,lastVideoTime=-1,tracked=[],pointerDrag=null,grip=null,hoverButton=null,summonProgress=0,fistSince=null;
const gesture=new GestureEngine({graceMs:180}),summon=new SummonGate(),tap=new TapRouter(),handoff=new RotationHandoff(),manipulator=new Manipulator();
const smoothing=new Map(),aims=new Map();let smoothTime=0,palmOwner=null,palmSample=null,palmQuietSince=0,scene,controlsDrag=null,controlsPointer=null,controlsPosition=null;
const timing={inferenceMs:[],intervalMs:[],updateMs:[]};const recordTime=(key,value)=>{timing[key].push(value);if(timing[key].length>180)timing[key].shift();};
try{scene=createScene($('scene'),(n,total)=>$('model-progress').textContent=`読み込み ${n} / ${total}`);}catch(e){$('error').hidden=false;$('error').textContent='3D表示を開始できません。ブラウザのハードウェアアクセラレーションを確認してください。';throw e;}
const bodyIds=()=>compare?['muscle','skeleton','organs']:['single'];
const activeIds=()=>[...bodyIds(),'panel'];
const activeObjects=()=>Object.fromEntries(activeIds().map(id=>[id,{...objects[id],visible:stage==='workspace'&&objects[id].visible}]));
const label=id=>id==='single'?`人体 · ${layerNames[objects.single.layer]}`:names[id];
const hints={lobby:'開いた手を3秒かざす → メニュー → 1回タップ',menu:'アイコンに指先を合わせ、つけて離すと決定',unselected:'光る枠内でつまむと、そのままつかめます',placed:'配置しました / 枠内をつまむと、また動かせます',drag:'つかめました / 手に追従して移動・離すと配置',zoom:'両手でつかんでいます / 間隔で拡大・縮小',rotate:'回転中 / こぶしで固定',ready:'操作パネルでモードを選択 / 光る枠内をつまんで移動',calibrating:'押し引き準備 / 手のひらを正面に向け、一瞬静止',near:'手と一緒に手前へ / 離すと配置',far:'手と一緒に奥へ / 離すと配置',dual:'両手で操作中 / 前後差で回転・間隔で拡大・離して配置','dual-uncertain':'奥行き・倍率を保留 / 掌を正面に向けて一瞬静止','dual-depth':'前後を操作中 / 間隔ズームは一時保留','depth-hold':'奥行き操作 / 止めるには下の「操作を停止」','depth-uncertain':'押し引きには手のひらを正面に向けて一瞬静止',paused:'手を確認中 / 模型の配置を保持しています',reacquire:'手をゆっくり戻してください / 配置を保持',stopped:'停止中 / モードのボタンを選び直すと再開',ui:'指先でアイコンをタップ / つけて離すと決定',pinch:'つまみを認識 / 光る枠内からつかんでください'};
Object.assign(hints,{'palm-ready':'掌を正面にして動かす / 横向きにして戻すと構え直し','palm-clutch':'構え直し / 掌を横向きのまま戻し、正面で再開'});
Object.assign(hints,{'rotation-prepare':'回転準備 / 両掌をそのまま','braking':'ブレーキ / 握ると固定','fixed':'固定 / 片手ずつつまんで移動・拡大','hold-one':'片手で保持 / もう片手をつまむ','inspect':'両手で移動・拡大 / 角度固定','inspect-uncertain':'角度固定 / 奥行きと倍率は掌を正面へ'});
const badges={lobby:'SUMMON',menu:'TAP',unselected:'GRAB AREA',placed:'PLACED',drag:'GRABBED',zoom:'2 HANDS',rotate:'ROTATE',ready:'READY',calibrating:'DEPTH',near:'NEAR',far:'FAR',dual:'2 HANDS · SPACE','dual-uncertain':'2 HANDS · HOLD','dual-depth':'2 HANDS · DEPTH','depth-hold':'DEPTH','depth-uncertain':'HAND FRONT',paused:'WAIT',reacquire:'WAIT',stopped:'STOPPED',ui:'TAP',pinch:'PINCH'};
Object.assign(badges,{'rotation-prepare':'回転準備',braking:'ブレーキ',fixed:'固定','hold-one':'片手で保持',inspect:'両手で移動・拡大','inspect-uncertain':'角度固定'});
function status(message){if($('status-text').textContent!==message)$('status-text').textContent=message;}
function setPhase(value,message){phase=value;$('phase-badge').textContent=badges[value]||value;status(message||hints[value]||hints.ready);}
function cancelPointer(){if(pointerDrag){const id=pointerDrag.id;pointerDrag=null;try{if(scene.renderer.domElement.hasPointerCapture(id))scene.renderer.domElement.releasePointerCapture(id);}catch{}}}
function releaseMotion(){manipulator.reset();palmOwner=null;palmSample=null;palmQuietSince=0;grip=null;controlsDrag=null;cancelPointer();}
function resetInput(){if(stage==='workspace'&&selected!=='panel'&&(operation==='rotate'||grip)){if(['place','dual'].includes(operation))operationPaused=true;else{operation='inspect';operationPaused=false;}handoff.lock('tracking',performance.now());}gesture.reset();tap.reset();summon.reset();releaseMotion();tracked=[];smoothing.clear();aims.clear();smoothTime=0;hovered=null;fistSince=null;summonProgress=0;setHover(null);$('tap-cursor').hidden=true;}
function select(id,{preserveTap=false}={}){if(id&&(!activeIds().includes(id)||!objects[id].visible))return;selected=id;if(id&&id!=='panel')lastBody=id;releaseMotion();if(!preserveTap)tap.guard(performance.now());setPhase(id?'ready':'unselected');refresh();}
function fixBody(time,reason){releaseMotion();const preserve=reason==='tracking'&&['place','dual'].includes(operation);if(!preserve)operation='inspect';operationPaused=preserve;handoff.lock(reason,time);tap.guard(time,65);rotationProgress=0;setPhase('fixed',preserve?'固定 / 選んだモードをタップして再開':undefined);refresh();}
function stopMotion(){if(selected&&selected!=='panel'){fixBody(performance.now(),'stop');return;}operationPaused=true;releaseMotion();tap.reset();manipulator.stop();setPhase('stopped');refresh();}
function refresh(){
 $('summon-menu').hidden=!menu;$('summon-guide').hidden=stage!=='lobby'||menu;
 $('compare').setAttribute('aria-pressed',String(compare));$('compare').textContent=compare?'◧ 1体表示に戻る':'◫ 3体比較表示';$('layers').hidden=compare;$('model-count').textContent=compare?'3 MODELS':'1 MODEL';
 $('model-list').replaceChildren(...activeIds().map(id=>{const row=document.createElement('div');row.className='model-row';const b=document.createElement('button');b.className='choose';b.dataset.model=id;b.dataset.action=`select-${id}`;b.textContent=label(id);b.setAttribute('aria-pressed',String(selected===id));b.disabled=!objects[id].visible;const v=document.createElement('button');v.className='visibility';v.dataset.action=`visibility-${id}`;v.dataset.visibility=id;v.textContent=objects[id].visible?'表示中':'非表示';v.setAttribute('aria-label',`${label(id)}を${objects[id].visible?'隠す':'表示'}`);row.append(b,v);return row;}));
 document.querySelectorAll('[data-layer]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.layer===objects.single.layer)));
 $('selected-name').textContent=selected?label(selected):'未選択';$('selected-help').textContent=operation==='rotate'?'掌で回転 / こぶしで固定・つまんで引き継ぐ':operation==='inspect'?'角度固定 / 片手ずつつまんで移動・拡大':operation==='dual'?'自由操作 / 片手ずつつまんで保持':operation==='depth'?'掌に合わせて上下左右・奥行き移動':'光る枠内をつまんで直接つかむ';
 $('mode-controls').hidden=stage!=='workspace'||menu||!$('settings-panel').hidden;for(const op of ['place','rotate','inspect','dual']){$('mode-'+op).setAttribute('aria-pressed',String(operation===op));$('mode-'+op).disabled=!selected;}
 $('toggle-panel').textContent=objects.panel.visible?'浮遊パネルを隠す':'浮遊パネルを表示';$('depth-mode').setAttribute('aria-pressed',String(operation==='depth'));
 for(const id of ['zoom-in','zoom-out','depth-near','depth-far','depth-mode','deselect'])$(id).disabled=!selected;$('reset').disabled=stage!=='workspace';$('close-menu').textContent=stage==='workspace'?'空間へ戻る':'かざす画面へ戻る';
}
function openMenu(){menu=true;summon.reset();summonProgress=0;releaseMotion();tap.guard(performance.now(),450);setHover(null);refresh();setPhase('menu');}
function closeMenu(){menu=false;releaseMotion();tap.guard(performance.now(),350);refresh();setPhase(stage==='workspace'?'placed':'lobby');}
function showBody(layer){compare=false;objects.single.layer=layer;objects.single.visible=true;stage='workspace';menu=false;select('single');refresh();}
function setImmersive(value){immersive=value;lab.classList.toggle('immersive',value);$('restore-ui').hidden=!value;releaseMotion();tap.guard(performance.now(),400);setPhase('placed',value?'没入表示 / 下のボタンは手のタップでも使えます':'操作画面を戻しました / そのまま手で操作できます');}
function adjust(fn){if(!selected)return;releaseMotion();fn(objects[selected]);setPhase('placed');}
function point(x,y){return containedPoint(x,y,video.videoWidth||1280,video.videoHeight||720,lab.clientWidth,lab.clientHeight);}
function grabBounds(b){
 const pad=['dual','inspect'].includes(operation)?100:44;
 return {left:Math.max(10,Math.min(b.left-pad,(b.left+b.right)/2-160)),right:Math.min(lab.clientWidth-10,Math.max(b.right+pad,(b.left+b.right)/2+160)),top:Math.max(82,b.top-50),bottom:Math.min(lab.clientHeight-155,b.bottom+50)};
}
function bodyHit(p){if(['dual','inspect'].includes(operation)&&selected&&selected!=='panel'){const b=scene.projections()[selected];if(b?.visible){const r=grabBounds(b);if(p.x>=r.left&&p.x<=r.right&&p.y>=r.top&&p.y<=r.bottom)return selected;}}return scene.hit(p.x,p.y);}
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
 if(!action||!scene.meta.ready)return;const previousOperation=operation;tap.guard(performance.now(),source==='hand'?300:120);releaseMotion();operation=previousOperation;
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
  case 'mode-place':operationPaused=false;handoff.manual('place',performance.now());operation='place';setPhase('ready');break;
  case 'mode-rotate':operationPaused=false;handoff.manual('rotate',performance.now());operation='rotate';setPhase('ready','掌で回転 / 手を開いて動かす・停止で止まる');break;
  case 'mode-inspect':operationPaused=false;handoff.manual('inspect',performance.now());operation='inspect';setPhase('fixed');break;
  case 'mode-dual':operationPaused=false;handoff.manual('dual',performance.now());operation='dual';setPhase('ready','両手で自由操作 / 枠内で片手をつかみ、もう片手もつまむ');break;
  case 'depth-mode':operationPaused=false;operation='depth';setPhase('calibrating','掌を正面へ / 近づけると模型も手前へ');break;
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
 const aspect=(video.videoWidth||1280)/(video.videoHeight||720),observations=(result.landmarks||[]).map((points,i)=>{const h=describeHand(points,aspect),side=result.handedness?.[i]?.[0];return h?{...h,points,handLabel:side?.score>=.8?side.categoryName:null}:null;});
 const data=gesture.update(observations,time,'model'),dt=smoothTime?Math.min(100,time-smoothTime):30;smoothTime=time;
 tracked=data.hands.map(h=>{const old=smoothing.get(h.id),alpha=old?1-Math.exp(-dt/18):1,v={px:old&&Math.abs(h.px-old.px)>.00015?old.px+(h.px-old.px)*alpha:h.px,py:old&&Math.abs(h.py-old.py)>.00015?old.py+(h.py-old.py)*alpha:h.py};smoothing.set(h.id,v);const p=point(h.x,h.y),handle=controlHandleAt(p);let button=handle?null:actionableAt(p),actionId=button?.dataset.action||(!handle&&!overControls(p)&&!menu&&stage==='workspace'?scene.panelActionAt(p.x,p.y):null);const aim=aims.get(h.id);if(data.events.some(e=>e.type==='pinch'&&e.id===h.id)&&!handle&&aim&&time-aim.time<240&&Math.hypot(h.px-aim.px,h.py-aim.py)<.07&&(!aim.button||(!aim.button.disabled&&aim.button.getClientRects().length>0))){button=aim.button;actionId=aim.actionId;}if(!h.down&&h.pinch>=.46&&actionId)aims.set(h.id,{time,px:h.px,py:h.py,button,actionId});return {...h,...v,button,actionId,hoverId:handle?'controls':!button&&!overControls(p)&&!menu&&stage==='workspace'?bodyHit(p):null};});
 for(const id of smoothing.keys())if(!tracked.some(h=>h.id===id)){smoothing.delete(id);aims.delete(id);}
 $('hand-count').textContent=`検出 ${tracked.length} 手`;hovered=tracked[0]?.hoverId||null;
 const g=summon.update(tracked,time,stage==='lobby'&&!menu);summonProgress=g.progress;$('summon-ring').style.strokeDashoffset=String(326.73*(1-g.progress));$('summon-number').textContent=g.progress?`${Math.max(1,Math.ceil(3-g.progress*3))}`:'3';$('summon-title').textContent=g.progress?'手を認識しています。そのまま…':'手を開いて、3秒かざす';
 if(g.ready){openMenu();return;}
 const flow=handoff.update(tracked,data.events,time,{enabled:!operationPaused&&stage==='workspace'&&!menu&&!!selected&&selected!=='panel'&&!pointerDrag&&!controlsPointer&&!controlsDrag,operation:operationPaused?'paused':operation,owner:palmOwner,heldIds:grip?[...grip.ids.keys()]:[],uiBusy:!!tap.press});
 rotationProgress=flow.progress||0;
 if(flow.type==='fixed'){fixBody(time,flow.reason);return;}
 if(flow.type==='braking'){manipulator.reset();tap.reset();setPhase('braking');return;}
 if(flow.type==='rebase'){manipulator.reset();tap.reset();setPhase('palm-ready');return;}
 if(flow.type==='preparing'){manipulator.reset();tap.reset();setPhase('rotation-prepare');return;}
 if(flow.type==='rotate'){releaseMotion();operation='rotate';operationPaused=false;palmOwner=flow.owner;tap.guard(time,250);setPhase('palm-ready');refresh();return;}
 // Captured objects keep exclusive ownership. Missing observations freeze motion.
 if(grip){
  for(const e of data.events)if(e.type==='release'||e.type==='lost')grip.ids.delete(e.id);
  
  if(!grip.ids.size){if(operation==='inspect'){fixBody(time,'release');return;}grip=null;manipulator.reset();tap.guard(time,180);}
 }
 if(operation==='rotate'&&!grip&&!menu&&selected){
  const owner=tracked.find(h=>h.id===palmOwner)||(!palmOwner?tracked.find(h=>!h.actionId&&h.hoverId!=='controls'):null);
  if(owner){palmOwner=owner.id;const moved=!palmSample||Math.hypot(owner.px-palmSample.px,owner.py-palmSample.py)>.002||Math.abs((owner.palmRoll||0)-(palmSample.palmRoll||0))>.01;if(moved)palmQuietSince=time;palmSample=owner;}
  else if(palmOwner&&!data.events.some(e=>e.type==='missing'&&e.id===palmOwner)){palmOwner=null;palmSample=null;manipulator.reset();}
 }
 const palmMissing=operation==='rotate'&&palmOwner!==null&&!tracked.some(h=>h.id===palmOwner);
 const capture=!!grip||!!controlsDrag||palmMissing, palmBusy=operation==='rotate'&&palmOwner!==null&&time-palmQuietSince<180;
 const routed=routeHandTargets(tracked,{operation,owner:palmOwner,capture,palmBusy,canGrab:h=>handoff.canGrab(h,time)});
 const actions=tap.update(routed,capture?data.events.filter(e=>e.type!=='pinch'):data.events,time),uiPress=tap.press?.kind==='ui',primary=tracked.find(h=>h.id===tap.press?.id)||routed.find(h=>h.actionId)||tracked.find(h=>h.id===palmOwner)||tracked[0],p=primary?point(primary.x,primary.y):null;
 setHover(operation==='rotate'&&primary?.id===palmOwner?null:primary?.button||null);hoverButton?.classList.toggle('hand-pressed',!!uiPress);
 $('tap-cursor').hidden=!p;if(p){$('tap-cursor').style.left=`${p.x}px`;$('tap-cursor').style.top=`${p.y}px`;$('tap-cursor').classList.toggle('pressed',!!primary.down);$('tap-cursor-label').textContent=operation==='rotate'&&primary.id===palmOwner?'掌で操作 / こぶしで固定':primary.pinch<.38&&!primary.down?'いったん指を開く':uiPress?'離すと決定':primary.actionId?'1回タップで選択':grip?'つかめています':primary.hoverId?'ここをつまんで移動':'枠内をつまむ';}
 for(const event of actions){
  if(event.type==='tap'){runAction(event.target,'hand');return;}
  if(event.type==='grab'&&operation!=='rotate'&&!menu&&stage==='workspace'&&!grip&&!controlsDrag){if(event.target==='controls'){releaseMotion();const hand=tracked.find(h=>h.id===event.id),r=$('mode-controls').getBoundingClientRect();controlsDrag={id:hand.id,px:hand.px,py:hand.py,x:r.left,y:r.top};refresh();}else if(!operationPaused){const op=operation;select(event.target,{preserveTap:true});grip={target:event.target,ids:new Map([[event.id,(tracked.find(h=>h.id===event.id)?.px||0)<.5?'左側':'右側']])};tap.reset();operation=op;refresh();}}
 }
 if(grip&&['dual','inspect'].includes(operation))for(const e of data.events)if(e.type==='pinch'&&grip.ids.size<2&&!grip.ids.has(e.id)){
  const h=tracked.find(h=>h.id===e.id),other=tracked.find(h=>grip.ids.has(h.id));
  if(h&&other?.down&&(operation!=='inspect'||handoff.canGrab(h,time))){grip.ids.set(other.id,other.px<=h.px?'左側':'右側');grip.ids.set(h.id,other.px<=h.px?'右側':'左側');}
 }
 if(menu){releaseMotion();setPhase('menu');return;}
 if(stage==='lobby'){setPhase('lobby',g.progress?'手を認識 / 光の円が満ちるまで、そのままかざす':undefined);return;}
 if(pointerDrag||controlsPointer)return;
 if(uiPress){releaseMotion();setPhase('ui');return;}
 if(operationPaused){setPhase('stopped');return;}
 if(controlsDrag){const hand=tracked.find(h=>h.id===controlsDrag.id);if(!hand?.down){controlsDrag=null;setPhase('placed','操作パネルを配置しました');}else{const a=point(controlsDrag.px,controlsDrag.py),b=point(hand.px,hand.py);moveControls(controlsDrag.x+b.x-a.x,controlsDrag.y+b.y-a.y);setPhase('drag','操作パネルを移動中 / 離すと配置');}return;}
 if(grip&&data.events.some(e=>(e.type==='missing'||e.type==='reacquired')&&grip.ids.has(e.id))){manipulator.reset();setPhase('reacquire','手の追跡を待っています / 保持した配置を固定');return;}
 if(data.events.some(e=>e.type==='lost'||e.type==='cancel')){manipulator.reset();tap.reset();setPhase('reacquire');return;}

 if(!['rotate','inspect'].includes(operation)&&!grip&&tracked.length===1&&primary.fist){fistSince??=time;releaseMotion();if(time-fistSince>=140)stopMotion();else setPhase('paused');return;}fistSince=null;
 if(palmMissing){manipulator.reset();setPhase('reacquire','同じ掌の復帰を待っています / 回転を固定');return;}
 if(!tracked.length){releaseMotion();setPhase(operation==='inspect'?'fixed':'placed');return;}
 if(!['rotate','inspect'].includes(operation)&&!grip&&primary.pinch<.38&&!primary.down){manipulator.reset();setPhase('pinch','つまみを認識 / 一度指を開いてから、枠内でつまんでください');return;}
 if(grip&&!tracked.some(h=>h.down)){grip=null;manipulator.reset();setPhase('placed');}
 if(!grip&&!palmBusy&&(uiPress||routed.some(h=>h.actionId)||operation!=='rotate'&&primary.hoverId==='controls')){manipulator.reset();setPhase('ui');return;}
 if(operation!=='rotate'&&!grip&&primary.down){manipulator.reset();setPhase(operation==='inspect'?'fixed':'pinch');return;}
 if(!grip&&(operation==='place'||operation==='dual'||operation==='inspect'||!selected)){if(!manipulator.stopped)manipulator.reset();setPhase(manipulator.stopped?'stopped':operation==='inspect'?'fixed':selected?'ready':'unselected');return;}
 const operating=grip?tracked.filter(h=>grip.ids.has(h.id)):operation==='rotate'?tracked.filter(h=>h.id===palmOwner):tracked;
 const outcome=manipulator.update(operating,time,{state:objects[selected],key:selected,aspect,...scene.motionScale(objects[selected].z,video.videoWidth||1280,video.videoHeight||720),operation,maxScale:selected==='panel'?3:64,minScale:selected==='panel'?.35:.2});
 if(outcome.state)objects[selected]=outcome.state;setPhase(outcome.phase,grip&&['dual','inspect'].includes(operation)&&grip.ids.size===1?[...grip.ids.values()][0]+'の手を保持 / もう片手は画面内でつまむ':undefined);
}
const edges=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
function drawFeedback(){
 ctx.clearRect(0,0,overlay.width,overlay.height);
 if(!menu)for(const [id,b]of Object.entries(scene.projections())){
  if(!b.visible)continue;const chosen=selected===id,over=hovered===id,grabbing=grip?.target===id;const color=grabbing?'#fface5':chosen&&phase==='fixed'?'#a1d8ff':chosen?'#ffe1a0':over?'#97fff0':'#71b8ba';ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=chosen||over?2:1;
  const bounds=['dual','inspect'].includes(operation)&&chosen?grabBounds(b):{left:Math.max(10,b.left-44),right:Math.min(overlay.width-10,b.right+44),top:Math.max(82,b.top-36),bottom:Math.min(overlay.height-155,b.bottom+36)};const {left:l,right:r,top:t,bottom:bot}=bounds,d=20;
  if(r>l&&bot>t){ctx.globalAlpha=chosen||over?.5:.22;ctx.setLineDash([5,9]);ctx.strokeRect(l,t,r-l,bot-t);ctx.setLineDash([]);ctx.globalAlpha=1;ctx.shadowColor=color;ctx.shadowBlur=chosen||over?10:0;for(const [x,y,sx,sy]of[[l,t,1,1],[r,t,-1,1],[l,bot,1,-1],[r,bot,-1,-1]]){ctx.beginPath();ctx.moveTo(x+d*sx,y);ctx.lineTo(x,y);ctx.lineTo(x,y+d*sy);ctx.stroke();}}
  if(id!=='panel'&&['dual','inspect'].includes(operation)&&r>l&&bot>t){for(const x of [l,r]){ctx.beginPath();ctx.arc(x,(t+bot)/2,13,0,Math.PI*2);ctx.lineWidth=2;ctx.stroke();ctx.beginPath();ctx.arc(x,(t+bot)/2,4,0,Math.PI*2);ctx.fill();}}
  ctx.shadowBlur=0;ctx.font='12px "Yu Gothic UI",sans-serif';ctx.textAlign='center';ctx.fillText(`${label(id)} · ${grabbing?'つかめています':id==='panel'?'上の帯をつまんで移動':chosen&&operation==='rotate'?'掌を動かす・横向きで構え直し':'枠内をつまんで移動'}`,clamp((b.left+b.right)/2,100,overlay.width-100),clamp(t-12,82,overlay.height-172));ctx.restore();
 }
 for(const h of tracked){
  if((operation==='rotate'||phase==='rotation-prepare')&&!menu&&(!h.actionId||h.id===palmOwner)&&!controlsDrag){
   const p=point(h.px,h.py),active=h.id===palmOwner&&phase==='rotate',available=(h.palmOpen??h.open)&&h.depthQuality>=.6,color=active?'#fface5':available?'#78f6e4':'#ffe1a0';ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=active?20:10;ctx.lineWidth=active?4:2;if(rotationProgress){ctx.beginPath();ctx.arc(p.x,p.y,34,-Math.PI/2,-Math.PI/2+rotationProgress*Math.PI*2);ctx.stroke();}ctx.beginPath();ctx.ellipse(p.x,p.y,26,Math.max(9,26*h.depthQuality),h.palmRoll||0,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=.13;ctx.beginPath();for(const [j,i]of[0,5,9,13,17].entries()){const q=point(1-h.points[i].x,h.points[i].y);j?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);}ctx.closePath();ctx.fill();ctx.globalAlpha=1;ctx.shadowBlur=0;ctx.font='12px "Yu Gothic UI"';ctx.fillText(operationPaused?'停止中 / モードで再開':phase==='rotation-prepare'?'回転準備':phase==='braking'?'ブレーキ':active?'回転中 / こぶしで固定':available?'掌を動かす / こぶしで固定':'構え直し・掌を正面へ',p.x+32,p.y);ctx.restore();continue;
  }
  const grabbed=(!!grip?.ids.has(h.id)||controlsDrag?.id===h.id)&&h.down&&!menu,pinched=h.down||h.pinch<.38,color=grabbed?'#fface5':pinched?'#ffe1a0':'#78f6e4',pts=h.points.map(p=>point(1-p.x,p.y));ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.globalAlpha=.5;ctx.lineWidth=1.1;
  for(const [a,b]of edges){ctx.beginPath();ctx.moveTo(pts[a].x,pts[a].y);ctx.lineTo(pts[b].x,pts[b].y);ctx.stroke();}ctx.globalAlpha=1;ctx.shadowColor=color;ctx.shadowBlur=h.down?20:9;
  if(h.down||h.pinch<.38){ctx.lineWidth=grabbed?5:3;ctx.beginPath();ctx.moveTo(pts[4].x,pts[4].y);ctx.lineTo(pts[8].x,pts[8].y);ctx.stroke();}
  for(const i of [4,8]){ctx.beginPath();ctx.arc(pts[i].x,pts[i].y,h.down?6:4,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(pts[i].x,pts[i].y,grabbed?15:10,0,Math.PI*2);ctx.lineWidth=1;ctx.stroke();}
  ctx.shadowBlur=0;ctx.font='11px "Yu Gothic UI",sans-serif';ctx.fillText(grabbed?'◆ '+(grip?.ids.get(h.id)||'')+'の手を保持':pinched?'● つまみ認識':'○ 手を検出',pts[4].x+16,pts[4].y+23);ctx.restore();
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
new ResizeObserver(()=>{scene.resize();overlay.width=lab.clientWidth;overlay.height=lab.clientHeight;resetInput();}).observe(lab);
$('start').onclick=startCamera;$('camera-device').onchange=()=>{if(mode==='camera'){stopCamera();startCamera();}};
document.addEventListener('click',e=>{const b=e.target.closest('button[data-action]');if(b&&!b.disabled)runAction(b.dataset.action);});
const modeHandle=$('mode-handle');
modeHandle.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('button'))return;releaseMotion();tap.reset();const r=$('mode-controls').getBoundingClientRect();controlsPointer={id:e.pointerId,x:e.clientX,y:e.clientY,left:r.left,top:r.top};modeHandle.setPointerCapture(e.pointerId);refresh();e.preventDefault();});
modeHandle.addEventListener('pointermove',e=>{if(!controlsPointer)return;const p=controlsPointer;moveControls(p.left+e.clientX-p.x,p.top+e.clientY-p.y);});
for(const event of ['pointerup','pointercancel','lostpointercapture'])modeHandle.addEventListener(event,()=>{controlsPointer=null;});
const canvas=scene.renderer.domElement;
canvas.addEventListener('pointerdown',e=>{if(e.button!==0||menu||stage!=='workspace')return;const box=lab.getBoundingClientRect(),x=e.clientX-box.left,y=e.clientY-box.top,action=scene.panelActionAt(x,y);if(action){runAction(action);return;}const id=scene.hit(x,y);if(!id)return;select(id);canvas.setPointerCapture(e.pointerId);pointerDrag={id:e.pointerId,x:e.clientX,y:e.clientY,state:{...objects[id]},move:e.shiftKey||id==='panel',depth:e.altKey};});
canvas.addEventListener('pointermove',e=>{if(!pointerDrag||!selected)return;const p=pointerDrag,dx=e.clientX-p.x,dy=e.clientY-p.y,s=objects[selected];if(p.depth){s.z=clamp(p.state.z-dy*.012,-8,1.6);setPhase('push');}else if(p.move){const m=scene.motionScale(s.z,lab.clientWidth,lab.clientHeight);s.x=clamp(p.state.x+dx/lab.clientWidth*m.worldPerX,-14,14);s.y=clamp(p.state.y-dy/lab.clientHeight*m.worldPerY,-10,10);setPhase('drag');}else{s.rotation=p.state.rotation+dx*.006;s.tilt=p.state.tilt+dy*.006;setPhase('rotate');}});
for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>{if(pointerDrag){pointerDrag=null;manipulator.reset();setPhase('placed');}});
canvas.addEventListener('wheel',e=>{e.preventDefault();if(!selected||menu)return;adjust(s=>{if(e.altKey)s.z=clamp(s.z-e.deltaY*.004,-8,1.6);else s.scale=clamp(s.scale*Math.exp(-e.deltaY*.0018),selected==='panel'?.35:.2,selected==='panel'?3:64);});},{passive:false});
addEventListener('keydown',e=>{if(e.target.matches('input,select,textarea'))return;if(e.key==='Escape'){if(menu)closeMenu();else if(immersive)setImmersive(false);else stopMotion();}if(e.key.toLowerCase()==='i'&&!e.ctrlKey&&!e.metaKey)setImmersive(!immersive);if(e.code==='Space'&&!e.target.matches('button,a')){e.preventDefault();stopMotion();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(mode==='camera'||mode==='loading'))stopCamera();});addEventListener('pagehide',()=>{stream?.getTracks().forEach(t=>t.stop());detector?.close();});
scene.ready.then(()=>{$('model-loading').hidden=true;$('start').disabled=false;status('カメラで手を3秒かざす / マウスならメニューを開く');}).catch(e=>{$('model-loading').querySelector('strong').textContent='解剖モデルを読み込めませんでした';$('model-progress').textContent='起動用ファイルから再読み込みしてください';console.error(e);});
refresh();requestAnimationFrame(frame);
Object.defineProperty(window,'holoSnapshot',{value:()=>({version:'0.11',mode,stage,menu,compare,selected,hovered,phase,operation,immersive,summonProgress,palmOwner,rotationProgress,handoffState:handoff.state,handoffReason:handoff.reason,gripping:grip?.target||(controlsDrag?'controls':null),controlsPosition:controlsPosition?{...controlsPosition}:null,objects:structuredClone(objects),stopped:operationPaused||manipulator.stopped,anatomy:{...scene.meta},trackedHands:tracked.length,handFeedback:tracked.map(h=>({id:h.id,pinched:h.down,armed:h.armed,hoverId:h.hoverId,actionId:h.actionId,grabbed:!!grip?.ids.has(h.id)&&h.down,palmFeedback:operation==='rotate'&&h.id===palmOwner,heldSide:grip?.ids.get(h.id)||null})),tapTarget:tap.press?{kind:tap.press.kind,target:tap.press.target}:null,cameraActive:!!stream,detectorReady:!!detector,timing:Object.fromEntries(Object.entries(timing).map(([k,v])=>{const a=[...v].sort((a,b)=>a-b);return [k,{samples:a.length,median:a[Math.floor(a.length*.5)]||0,p95:a[Math.floor(a.length*.95)]||0}];})),renderSpace:scene.getRenderState()}),writable:false});





