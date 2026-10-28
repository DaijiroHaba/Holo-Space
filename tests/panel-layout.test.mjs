import test from 'node:test';import assert from 'node:assert/strict';import {fitFloatingPanel} from '../panel-layout.mjs';
const screen={width:1440,height:960,panelWidth:240,panelHeight:360};
test('all four corners are available with only an eight-pixel visibility margin',()=>{for(const p of[{x:8,y:8},{x:1192,y:8},{x:8,y:592},{x:1192,y:592}])assert.deepEqual(fitFloatingPanel(p,screen),p);});
test('out-of-screen movement clamps to visible edges rather than central body bounds',()=>{assert.deepEqual(fitFloatingPanel({x:-500,y:5000},screen),{x:8,y:592});assert.deepEqual(fitFloatingPanel({x:5000,y:-500},screen),{x:1192,y:8});});
test('resize preserves an in-bounds placement and recovers an off-screen placement',()=>{const size={...screen,width:1000,height:820};assert.deepEqual(fitFloatingPanel({x:40,y:100},size),{x:40,y:100});assert.deepEqual(fitFloatingPanel({x:1192,y:592},size),{x:752,y:452});});
test('default placement is at the display edge, independent of camera aspect or body position',()=>{assert.equal(fitFloatingPanel(null,screen).x,1192);assert.equal(fitFloatingPanel(null,{...screen,width:3840}).x,3592);});
test('invalid geometry never produces NaN CSS coordinates',()=>{for(const size of[screen,{width:NaN,height:0,panelWidth:1000,panelHeight:1000}]){const r=fitFloatingPanel({x:NaN,y:Infinity},size);assert.ok(Number.isFinite(r.x)&&Number.isFinite(r.y));}});
