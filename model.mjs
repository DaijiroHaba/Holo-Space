import * as THREE from './vendor/three.module.js';
import {GLTFLoader} from './vendor/three-r160/loaders/GLTFLoader.js';
import {DRACOLoader} from './vendor/three-r160/loaders/DRACOLoader.js';
const systems=['muscular','skeletal','visceral','cardiovascular','joints'];
const layerSystems={whole:['muscular','skeletal','joints'],skeleton:['skeletal','joints'],organs:['visceral','cardiovascular']};
export function createScene(container,onProgress=()=>{}){
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setClearColor(0,0);renderer.autoClear=false;
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;container.append(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(42,1,.1,50);camera.position.set(0,0,5.8);
  scene.add(new THREE.HemisphereLight(0xe5f4ff,0x343b48,2));
  for(const [color,power,position]of[[0xfff0e2,3.5,[-2,3,5]],[0xc4e8ff,1.2,[3,1,2]],[0x60bcda,2,[2,2,-3]]]){const l=new THREE.DirectionalLight(color,power);l.position.set(...position);scene.add(l);}
  const room=new THREE.Group();scene.add(room);
  const grid=new THREE.GridHelper(22,32,0x56bdcc,0x245567);grid.position.set(0,-1.85,-5);grid.material.transparent=true;grid.material.opacity=.25;grid.material.depthWrite=false;room.add(grid);
  const base=new THREE.Group(),instances={},meta={ready:false,error:null,meshCount:0,triangles:0,source:'Z-Anatomy / BodyParts3D'};
  const decoder=new DRACOLoader();decoder.setDecoderPath('./vendor/three-r160/draco/');decoder.setWorkerLimit(2);
  const loader=new GLTFLoader();loader.setDRACOLoader(decoder);let complete=0,width=1,height=1,lastModels={},lastSelected=null,lastRenderKey='',viewport={x:0,y:0,width:1,height:1};
  const panelCanvas=document.createElement('canvas');panelCanvas.width=960;panelCanvas.height=700;
  const pc=panelCanvas.getContext('2d'),texture=new THREE.CanvasTexture(panelCanvas);texture.colorSpace=THREE.SRGBColorSpace;
  const panelRoot=new THREE.Group(),panelMaterial=new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide});
  const panelFace=new THREE.Mesh(new THREE.PlaneGeometry(2.12,1.55),panelMaterial);panelRoot.add(panelFace);scene.add(panelRoot);panelRoot.visible=false;
  const panelButtons=[{id:'summon-whole',text:'筋肉',icon:'◈',x:.045,y:.29,w:.29,h:.29},{id:'summon-skeleton',text:'骨格',icon:'╋',x:.355,y:.29,w:.29,h:.29},{id:'summon-organs',text:'臓器',icon:'♡',x:.665,y:.29,w:.29,h:.29},{id:'center-body',text:'人体を中央へ',x:.045,y:.70,w:.44,h:.19},{id:'open-menu',text:'メニューへ',x:.515,y:.70,w:.44,h:.19}];
  instances.panel={root:panelRoot,view:camera.clone(),materials:[],bounds:new THREE.Box3(new THREE.Vector3(-1.06,-.775,-.01),new THREE.Vector3(1.06,.775,.01)),layer:'panel',glow:null};
  let paintedPanel='';
  function paintPanel(glow){
    if(paintedPanel===glow)return;paintedPanel=glow;const c=pc,w=960,h=700;
    c.fillStyle='#071e2a';c.fillRect(0,0,w,h);c.strokeStyle=glow==='grab'?'#ffb3ea':glow==='selected'?'#ffe1a0':'#67ded9';c.lineWidth=8;c.strokeRect(4,4,w-8,h-8);
    c.fillStyle='#123c4c';c.fillRect(14,14,w-28,135);c.fillStyle='#d5fffa';c.font='600 35px "Yu Gothic UI",sans-serif';c.textAlign='center';c.fillText('⋮⋮ ここをつまんでパネルを移動',w/2,74);c.font='23px "Yu Gothic UI",sans-serif';c.fillStyle='#89c1cd';c.fillText('ANATOMY / 手を離すと、その場所に',w/2,119);
    for(const b of panelButtons){const x=b.x*w,y=b.y*h,bw=b.w*w,bh=b.h*h;c.fillStyle='#153d50';c.fillRect(x,y,bw,bh);c.strokeStyle='#417184';c.lineWidth=2;c.strokeRect(x,y,bw,bh);c.fillStyle='#e0fbfa';c.font='32px "Yu Gothic UI",sans-serif';if(b.icon){c.font='49px "Yu Gothic UI",sans-serif';c.fillText(b.icon,x+bw/2,y+76);c.font='34px "Yu Gothic UI",sans-serif';}c.fillText(b.text,x+bw/2,y+bh*(b.icon?.80:.60));}
    texture.needsUpdate=true;
  }
  const panelRay=new THREE.Raycaster();
  const ready=Promise.all(systems.map(async name=>{
    const gltf=await loader.loadAsync(`./models/anatomy/${name}.glb`);gltf.scene.updateMatrixWorld(true);
    const group=new THREE.Group();group.name=name;const meshes=[];gltf.scene.traverse(o=>{if(o.isMesh)meshes.push(o);});
    const matrices=meshes.map(m=>m.matrixWorld.clone());
    meshes.forEach((mesh,i)=>{
      mesh.removeFromParent();mesh.matrix.copy(matrices[i]);mesh.matrix.decompose(mesh.position,mesh.quaternion,mesh.scale);mesh.matrixAutoUpdate=false;
      mesh.userData.anatomyName=mesh.userData.za_name||mesh.name;mesh.userData.system=name;
      mesh.visible=!(name==='muscular'&&/fascia|bursa/i.test(mesh.userData.anatomyName))&&!(name==='visceral'&&/omentum|peritoneum|mesenter/i.test(mesh.userData.anatomyName));
      for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
        m.metalness=0;m.roughness=.64;
        if(m.name.startsWith('Bone')||m.name==='Teeth')m.color.set('#e8d9bd');
        if(name==='muscular'&&!/Tendon|Ligament|Cartilage|Fascia|Bursa|capsule/i.test(m.name))m.color.set('#a94740');
      }
      group.add(mesh);meta.meshCount++;meta.triangles+=(mesh.geometry.index?.count||mesh.geometry.attributes.position.count)/3;
    });base.add(group);onProgress(++complete,5);
  })).then(()=>{
    const bounds=new THREE.Box3().setFromObject(base),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
    if(!Number.isFinite(size.y)||size.y<.1)throw new Error('Invalid anatomy bounds');
    const factor=3.45/size.y;base.scale.setScalar(factor);base.position.copy(center).multiplyScalar(-factor);
    for(const id of ['single','muscle','skeleton','organs']){
      const root=new THREE.Group(),anatomy=base.clone(true),materials=new Map();root.add(anatomy);root.visible=false;scene.add(root);
      anatomy.traverse(o=>{if(!o.isMesh)return;const clone=m=>{if(!materials.has(m)){const c=m.clone();c.userData.baseEmissive=c.emissive?.clone()||new THREE.Color();materials.set(m,c);}return materials.get(m);};o.material=Array.isArray(o.material)?o.material.map(clone):clone(o.material);});
      const view=camera.clone();instances[id]={root,anatomy,view,materials:[...materials.values()],layer:null,glow:null,bounds:null};
    }
    meta.ready=true;decoder.dispose();return meta;
  }).catch(e=>{meta.error=String(e.message||e);decoder.dispose();throw e;});
  function resize(){width=Math.max(1,container.clientWidth);height=Math.max(1,container.clientHeight);renderer.setSize(width,height);}
  resize();
  function applyLayer(i,layer){
    if(i.layer===layer)return;i.layer=layer;
    for(const g of i.anatomy.children)g.visible=layerSystems[layer].includes(g.name);
    // Bounds include only the displayed anatomical structures, in root space.
    i.anatomy.updateMatrixWorld(true);const box=new THREE.Box3(),inverse=i.root.matrixWorld.clone().invert();
    for(const g of i.anatomy.children)if(g.visible)g.traverse(o=>{if(o.isMesh&&o.visible){if(!o.geometry.boundingBox)o.geometry.computeBoundingBox();box.union(o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,o.matrixWorld)));}});
    i.bounds=box;
  }
  function render(models,selected,phase,hovered){
    lastModels=models;lastSelected=selected;
    const renderKey=JSON.stringify([models,selected,['drag','zoom','dual','dual-uncertain','dual-depth','inspect','inspect-uncertain','hold-one'].includes(phase),hovered,width,height,meta.ready,container.parentElement.classList.contains('immersive')]);
    if(renderKey===lastRenderKey)return;lastRenderKey=renderKey;
    renderer.setViewport(0,0,width,height);renderer.clear();
    const compact=width<=760&&!container.parentElement.classList.contains('immersive');
    viewport=compact?{x:0,y:120,width,height:Math.max(160,height-255)}:{x:0,y:0,width,height};
    camera.aspect=viewport.width/viewport.height;
    camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(21*Math.PI/180)*(Object.keys(models).filter(id=>id!=='panel').length>1?Math.max(1,1.25/camera.aspect):1)));
    camera.updateProjectionMatrix();renderer.setViewport(viewport.x,height-viewport.y-viewport.height,viewport.width,viewport.height);
    for(const i of Object.values(instances))i.root.visible=false;
    room.visible=true;renderer.render(scene,camera);room.visible=false;
    for(const [id,s]of Object.entries(models).filter(([,s])=>s.visible).sort((a,b)=>a[1].z-b[1].z)){
      const i=instances[id];if(!i||!meta.ready)continue;
      // Independent projection magnification keeps 64x anatomy clear of the
      // near plane. XY compensation keeps each model's screen anchor fixed.
      i.root.position.set(s.x/s.scale,s.y/s.scale,s.z);i.root.rotation.set(id==='panel'?0:s.tilt,id==='panel'?0:s.rotation,id==='panel'?0:s.roll||0);i.root.updateMatrixWorld(true);
      if(id!=='panel')applyLayer(i,s.layer);i.view.zoom=s.scale;i.view.aspect=camera.aspect;i.view.fov=camera.fov;i.view.updateProjectionMatrix();i.view.updateMatrixWorld(true);
      const glow=selected===id?(['drag','zoom','dual','dual-uncertain','dual-depth','inspect','inspect-uncertain','hold-one'].includes(phase)?'grab':'selected'):hovered===id?'hover':'none';
      if(i.glow!==glow){i.glow=glow;for(const m of i.materials)if(m.emissive){m.emissive.copy(m.userData.baseEmissive);if(glow!=='none')m.emissive.add(new THREE.Color(glow==='grab'?0x280928:glow==='selected'?0x201704:0x052020));}}
      if(id==='panel')paintPanel(glow);
      i.root.visible=true;renderer.render(scene,i.view);i.root.visible=false;
    }
  }
  function projections(){
    const result={};
    for(const [id,s]of Object.entries(lastModels)){
      const i=instances[id];if(!s.visible||!i?.bounds)continue;
      const b=i.bounds,points=[];
      for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){const p=new THREE.Vector3(x,y,z).applyMatrix4(i.root.matrixWorld).project(i.view);points.push({x:viewport.x+(p.x+1)*viewport.width/2,y:viewport.y+(1-p.y)*viewport.height/2});}
      const left=Math.min(...points.map(p=>p.x)),right=Math.max(...points.map(p=>p.x)),top=Math.min(...points.map(p=>p.y)),bottom=Math.max(...points.map(p=>p.y));
      const p=i.root.position.clone().project(i.view);
      result[id]={left,right,top,bottom,x:viewport.x+(p.x+1)*viewport.width/2,y:viewport.y+(1-p.y)*viewport.height/2,z:s.z,visible:right>0&&left<width&&bottom>0&&top<height};
    }return result;
  }
  function hit(x,y){
    const candidates=Object.entries(projections()).filter(([,b])=>b.visible&&x>=b.left-44&&x<=b.right+44&&y>=b.top-36&&y<=b.bottom+36);
    candidates.sort((a,b)=>b[1].z-a[1].z||Math.abs(x-a[1].x)-Math.abs(x-b[1].x));return candidates[0]?.[0]||null;
  }
  function panelActionAt(x,y){
    if(!lastModels.panel?.visible||hit(x,y)!=='panel')return null;
    const i=instances.panel;panelRay.setFromCamera(new THREE.Vector2((x-viewport.x)/viewport.width*2-1,1-(y-viewport.y)/viewport.height*2),i.view);
    const intersection=panelRay.intersectObject(panelFace,false)[0];if(!intersection)return null;
    const u=intersection.uv.x,v=1-intersection.uv.y;return panelButtons.find(b=>u>=b.x&&u<=b.x+b.w&&v>=b.y&&v<=b.y+b.h)?.id||null;
  }
  function motionScale(z,vw,vh){const h=2*(camera.position.z-z)*Math.tan(camera.fov*Math.PI/360),factor=Math.min(width/vw,height/vh);return {worldPerX:h*camera.aspect*vw*factor/viewport.width,worldPerY:h*vh*factor/viewport.height};}
  function getRenderState(){return {models:structuredClone(lastModels),selected:lastSelected,projection:projections(),independentMagnification:true,fixedView:true};}
  return {ready,meta,render,resize,hit,panelActionAt,projections,motionScale,getRenderState,renderer};
}


