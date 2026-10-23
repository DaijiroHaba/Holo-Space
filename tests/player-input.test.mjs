import test from 'node:test';
import assert from 'node:assert/strict';
import {PlayerSession,PlayerHandRoles,handInsideAnalysis,sanitizeHands,describePlayer} from '../player-input.mjs';
import {remapHandResult,containedPoint} from '../gestures.mjs';
const pose=(x=.30,y=.30)=>{const p=Array.from({length:33},()=>({x,y,visibility:0,presence:1}));for(const [i,dx,dy]of [[0,0,-.15],[11,-.08,0],[12,.08,0],[13,-.10,.12],[14,.10,.12],[15,-.12,.27],[16,.12,.27],[23,-.075,.32],[24,.075,.32]])p[i]={x:x+dx,y:y+dy,visibility:1,presence:1};return p;};
const hand=(x,y)=>Array.from({length:21},(_,i)=>({x:x+(i%4)*.003,y:y-i*.001,z:0}));
function lock(poses=[pose()]){const p=new PlayerSession();p.update(poses,0);assert.ok(p.choose(p.people[0].id,1));for(const t of [250,500,750])p.update(poses,t);assert.ok(p.confirm(751));return p;}
const result=hs=>({landmarks:hs,handedness:hs.map(()=>[{categoryName:'Right',score:1}])});
test('explicit selection and at least three stable poses over 500ms',()=>{const p=new PlayerSession();p.update([pose()],0);assert.equal(p.ready(0),false);p.choose(p.people[0].id,1);assert.equal(p.confirm(501),false);p.update([pose()],250);p.update([pose()],500);assert.equal(p.confirm(501),true);});
test('invalid and too-small shoulders cannot enroll',()=>{const p=pose();p[11].visibility=.1;assert.equal(describePlayer(p,0),null);p[11]=p[12];assert.equal(describePlayer(p,0),null);});
test('permutation of people, hands, and handedness never changes owner wrists',()=>{const a=pose(.28),b=pose(.76),p=lock([a,b]),id=p.selected.id;p.update([b,a],1000);assert.equal(p.selected.id,id);assert.equal(p.selected.index,1);const hs=[hand(.64,.57),hand(.40,.57),hand(.88,.57),hand(.16,.57)];const out=p.filterHands(result(hs),1020);assert.deepEqual(out.ownerSlots,[0,1]);assert.deepEqual(out.landmarks,[hs[3],hs[1]]);assert.equal(p.handAtCapacity,true);});
test('only bystander hands cannot call, pinch or clap',()=>{const p=lock([pose(.28),pose(.76)]);assert.equal(p.filterHands(result([hand(.64,.57),hand(.88,.57)]),760).landmarks.length,0);});
test('never combine own hand with another person hand',()=>{const p=lock([pose(.28),pose(.76)]);const out=p.filterHands(result([hand(.16,.57),hand(.64,.57)]),760);assert.deepEqual(out.ownerSlots,[0]);});
test('other wrist near selected wrist withholds that hand',()=>{const a=pose(.28),b=pose(.76);b[15]={...a[15]};const p=lock([a,b]);assert.equal(p.filterHands(result([hand(.16,.57)]),760).landmarks.length,0);});
test('visible competitor wrist remains a competitor even with missing shoulders',()=>{const a=pose(.28),p=lock([a]),b=pose(.76);b[11].visibility=0;b[15]={...a[15]};p.update([a,b],1000);assert.equal(p.filterHands(result([hand(.16,.57)]),1010).landmarks.length,0);});
test('crossing own wrists and duplicate detections do not yield two hands',()=>{const a=pose();a[16]={...a[15],x:a[15].x+.005};const p=lock([a]);assert.equal(p.filterHands(result([hand(a[15].x,a[15].y)]),760).landmarks.length,0);const q=lock();assert.equal(q.filterHands(result([hand(.18,.57),hand(.181,.57)]),760).landmarks.length,0);});
test('body overlap holds input and preserves the player until stable recovery',()=>{const p=lock([pose(.28),pose(.76)]);p.update([pose(.30),pose(.32)],1000);assert.equal(p.state,'holding');p.update([pose(.28),pose(.76)],1250);assert.equal(p.ready(1260),false);});
test('replacement at different location and long gap require reselection',()=>{const p=lock();p.update([pose(.80)],1000);assert.equal(p.state,'lost');const q=lock();q.update([pose()],4000);assert.equal(q.state,'lost');});
test('short missing poses hold placement then require stable recovery',()=>{const p=lock();p.update([],1000);assert.equal(p.state,'holding');assert.equal(p.filterHands(result([hand(.18,.57)]),1010).landmarks.length,0);p.update([pose()],1250);p.update([pose()],1500);assert.equal(p.ready(1501),false);p.update([pose()],1750);assert.equal(p.ready(1751),true);});
test('stale, future, out-of-order results never enable input',()=>{const p=lock();const before=p.selected;p.update([pose(.8)],700);assert.equal(p.selected,before);assert.equal(p.update([pose()],900,16/9,2000),false);assert.equal(p.filterHands(result([hand(.18,.57)]),760,2000).landmarks.length,0);assert.equal(p.filterHands(result([hand(.18,.57)]),800,790).landmarks.length,0);p.expire(1700);assert.equal(p.ready(1700),false);p.expire(3100);assert.equal(p.state,'lost');});
test('capacity does not prove absence of more people',()=>{const p=lock();p.update([pose(.15),pose(.35),pose(.6),pose(.85)],1000);assert.equal(p.state,'lost');assert.equal(p.choose(p.people[0].id,1010),false);});
test('missing selected wrist withholds only that wrist',()=>{const a=pose();a[15].visibility=0;const p=lock([a]);assert.deepEqual(p.filterHands(result([hand(.18,.57),hand(.42,.57)]),760).ownerSlots,[1]);});
test('each gesture joint must be inside analysis crop BEFORE remapping',()=>{for(let i=0;i<21;i++)for(const x of [-.01,1.02,NaN]){const h=hand(.5,.5);h[i].x=x;assert.equal(handInsideAnalysis(h),false);const clean=sanitizeHands(result([h]));assert.equal(clean.landmarks.length,0);if(Number.isFinite(x))assert.ok(remapHandResult(result([h]),{left:100,top:100,width:300,height:300},1000,1000).landmarks[0][i].x<1);}});
test('full landmarks and coordinates remain unchanged for accepted hands',()=>{const h=hand(.18,.57),p=lock(),out=p.filterHands(result([h]),760);assert.equal(out.landmarks[0],h);assert.equal(out.landmarks[0].length,21);});
const obs=(slot,pinch=.8)=>({ownerSlot:slot,pinch,open:pinch>.46,brakeCandidate:false});
test('main and auxiliary enroll sequentially and keep anatomical slot under reordering',()=>{const r=new PlayerHandRoles();r.update([obs(1)],0);assert.equal(r.update([obs(1)],101)[0].personSlot,'main');r.update([obs(0),obs(1)],150);const hs=r.update([obs(0),obs(1)],251);assert.equal(hs[0].ownerSlot,1);assert.deepEqual(hs.map(h=>h.personSlot),['main','aux']);});
test('pinched reacquisition never arms; release and new pinch required',()=>{const r=new PlayerHandRoles();r.update([obs(1)],0);r.update([obs(1)],101);r.requireRelease();for(const t of [200,400,800])assert.equal(r.update([obs(1,.1)],t).length,0);r.update([obs(1)],1000);assert.equal(r.update([obs(1)],1101).length,1);assert.equal(r.update([obs(1,.1)],1200).length,1);});
test('single wrist occlusion cannot assign auxiliary as main',()=>{const r=new PlayerHandRoles();r.update([obs(0),obs(1)],0);r.update([obs(0),obs(1)],101);r.update([obs(1)],200);assert.equal(r.main,0);assert.equal(r.update([obs(1)],400)[0].personSlot,'aux');assert.equal(r.update([obs(0,.1),obs(1)],500).length,1);});
test('mirrored and unmirrored raw to display transforms share contain geometry',()=>{for(const [w,h]of [[1440,900],[900,1440],[1920,1080]])for(const mirror of[false,true]){const x=.28,y=.57,p=containedPoint(mirror?1-x:x,y,1280,720,w,h),scale=Math.min(w/1280,h/720);assert.ok(Math.abs(p.x-((w-1280*scale)/2+(mirror?1-x:x)*1280*scale))<1e-7);}});
test('repeat 50 sequences: select, reject other, hold, recover, rearm',()=>{for(let i=0;i<50;i++){const p=lock([pose(.28),pose(.76)]);assert.equal(p.filterHands(result([hand(.64,.57)]),760).landmarks.length,0);p.update([],1000);p.update([pose(.28),pose(.76)],1250);p.update([pose(.28),pose(.76)],1500);p.update([pose(.28),pose(.76)],1750);assert.deepEqual(p.filterHands(result([hand(.16,.57),hand(.4,.57)]),1760).ownerSlots,[0,1]);}});

test('current Hand continuity bridges low-rate Pose wrist lag without extrapolated control',()=>{const p=lock();let x=.18;for(let t=760;t<990;t+=30){const h=hand(x,.57),out=p.filterHands(result([h]),t);assert.equal(out.landmarks[0],h);x+=.022;}p.update([],1000);assert.equal(p.filterHands(result([hand(x,.57)]),1010).landmarks.length,0);});

test('recovery requires consecutive matching observations after every missing frame',()=>{
 const p=lock();p.update([],1000);p.update([pose()],1250);p.update([],1500);
 assert.equal(p.recoverySince,null);assert.equal(p.recoverySamples,0);
 p.update([pose()],1750);p.update([pose()],2000);assert.equal(p.ready(2001),false);
 p.update([pose()],2250);assert.equal(p.ready(2251),true);
});
test('overlapping candidates cannot enter pending selection',()=>{
 const p=new PlayerSession();p.update([pose(.30),pose(.32)],0);
 assert.equal(p.choose(p.people[0].id,1),false);assert.equal(p.state,'unselected');
 assert.equal(p.selected,null);assert.match(p.reason,/重な/);
 p.update([pose(.28),pose(.76)],250);assert.equal(p.choose(p.people[0].id,251),true);
});
test('visible bystander wrist near recent Hand history is rejected even with stale own Pose',()=>{
 const a=pose(.28),b=pose(.76);b[15]={...b[15],x:.23,y:.57};
 const p=lock([a,b]);assert.deepEqual(p.filterHands(result([hand(.16,.57)]),760).ownerSlots,[0]);
 assert.equal(p.filterHands(result([hand(.23,.57)]),790).landmarks.length,0);
 assert.equal(p.handHistory.has(0),false);
});
