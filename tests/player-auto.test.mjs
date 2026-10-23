import test from 'node:test';import assert from 'node:assert/strict';import{PlayerSession,sameBodyPrediction,describePlayer,PlayerHandRoles}from'../player-input.mjs';
const pose=(x=.3)=>{const p=Array.from({length:33},()=>({x,y:.3,visibility:0,presence:1}));for(const[i,dx,dy]of[[0,0,-.15],[11,-.08,0],[12,.08,0],[13,-.1,.12],[14,.1,.12],[15,-.12,.1],[16,.12,.1],[23,-.075,.32],[24,.075,.32]])p[i]={x:x+dx,y:.3+dy,visibility:1,presence:1};return p;};
const feed=(p,people,ts)=>ts.forEach(t=>p.update(people,t));
test('single stable person locks without any mouse or hand gesture',()=>{const p=new PlayerSession({autoSelect:true});feed(p,[pose()],[0,250,500]);assert.equal(p.state,'unselected');p.update([pose()],750);assert.equal(p.state,'locked');assert.equal(p.automatic,true);});
test('same skeleton duplicate does not become a second player or competing wrist',()=>{const a=pose(),b=pose(.303),p=new PlayerSession({autoSelect:true});feed(p,[a,b],[0,250,500,750]);assert.equal(p.people.length,1);assert.equal(p.duplicatePoses,1);assert.equal(p.state,'locked');const hand=Array.from({length:21},()=>({x:.18,y:.4,z:0}));assert.equal(p.filterHands({landmarks:[hand]},760).landmarks.length,1);});
test('nearby different heads are not merged based on body overlap',()=>{assert.equal(sameBodyPrediction(describePlayer(pose(.3),0),describePlayer(pose(.32),1)),false);const p=new PlayerSession({autoSelect:true});feed(p,[pose(.3),pose(.32)],[0,250,500,750]);assert.equal(p.state,'unselected');assert.equal(p.people.length,2);});
test('two people never auto-select by array order alone',()=>{const p=new PlayerSession({autoSelect:true});feed(p,[pose(.28),pose(.76)],[0,250,500,750]);assert.equal(p.state,'unselected');const ids=p.people.map(x=>x.id);p.update([pose(.76),pose(.28)],1000);assert.deepEqual(p.people.map(x=>x.id),ids.reverse());});
test('multiple people: one unique chest-height open palm explicitly selects hands-free',()=>{const p=new PlayerSession({autoSelect:true}),people=[pose(.28),pose(.76)];feed(p,people,[0,250,500,750]);for(const t of[800,1050,1300,1550,1800]){p.update(people,t);p.offerSelectionHands([{open:true,wrist:people[0][15]}],t);}assert.equal(p.state,'locked');assert.equal(p.selected.center.x,.28);});
test('open palms from different people do not select either person',()=>{const p=new PlayerSession({autoSelect:true}),people=[pose(.28),pose(.76)];feed(p,people,[0,250,500,750]);for(const t of[800,1050,1300,1550,1800]){p.update(people,t);p.offerSelectionHands(people.map(a=>({open:true,wrist:a[15]})),t);}assert.equal(p.state,'unselected');});
test('transient overlapping predictions stop input without deleting selected player',()=>{const p=new PlayerSession({autoSelect:true});feed(p,[pose(.3)],[0,250,500,750]);const id=p.selected.id;p.update([pose(.3),pose(.32)],1000);assert.equal(p.state,'holding');assert.equal(p.selected.id,id);feed(p,[pose(.3)],[1250,1500,1750]);assert.equal(p.state,'locked');assert.equal(p.selected.id,id);});
test('automatic reacquisition never arms a pinched hand',()=>{const r=new PlayerHandRoles();assert.equal(r.update([{ownerSlot:0,pinch:.1,open:false}],0).length,0);assert.equal(r.update([{ownerSlot:0,pinch:.1,open:false}],1000).length,0);r.update([{ownerSlot:0,pinch:.8,open:true}],1200);assert.equal(r.update([{ownerSlot:0,pinch:.8,open:true}],1301).length,1);});
test('lost operator does not silently change to a new lone person',()=>{const p=new PlayerSession({autoSelect:true});feed(p,[pose(.3)],[0,250,500,750]);p.expire(3100);assert.equal(p.state,'lost');feed(p,[pose(.7)],[3250,3500,3750,4000,4250]);assert.equal(p.state,'lost');});
test('raw four-person capacity remains fail-closed even for duplicate predictions',()=>{const p=new PlayerSession({autoSelect:true});feed(p,[pose(.3),pose(.301),pose(.302),pose(.303)],[0,250,500,750]);assert.equal(p.atCapacity,true);assert.equal(p.state,'unselected');});

test('slow but valid reacquisition does not expire while matching observations arrive',()=>{
 const p=new PlayerSession({autoSelect:true});feed(p,[pose()],[0,250,500,750]);p.expire(1700);
 p.update([pose()],1900);p.expire(2300);p.update([pose()],2500);p.expire(2900);
 assert.notEqual(p.state,'lost');p.update([pose()],3100);assert.equal(p.state,'locked');
});
test('candidate stability survives a scheduler pause without operating on old coordinates',()=>{
 const p=new PlayerSession({autoSelect:true});feed(p,[pose()],[0,600,1800]);assert.equal(p.state,'locked');
 p.expire(2800);assert.equal(p.ready(2800),false);assert.equal(p.state,'holding');
});

test('different wrists prevent deduplication even for nearly aligned heads',()=>{
 const a=pose(.3),b=pose(.303);b[15].x=.75;
 assert.equal(sameBodyPrediction(describePlayer(a,0),describePlayer(b,1)),false);
});

test('background tab suspension retains player but never uses stale frames after return',()=>{
 const p=new PlayerSession({autoSelect:true});feed(p,[pose()],[0,250,500,750]);const id=p.selected.id;
 p.suspend(1000);p.expire(10000);assert.equal(p.state,'holding');assert.equal(p.ready(10000),false);
 p.resume(10100);assert.equal(p.update([pose()],10000,16/9,10150),false);
 feed(p,[pose()],[10200,10500,10800]);assert.equal(p.state,'locked');assert.equal(p.selected.id,id);
});
