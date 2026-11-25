import assert from 'node:assert/strict';
import {fitMap,mapPoint} from './canvas-geometry.mjs';
let checks=0;const same=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
// Landscape and portrait maps fit inside the usable viewport without distortion.
same(fitMap(1000,600,2000,1000),{width:904,height:452});
same(fitMap(1000,600,1000,2000),{width:252,height:504});
same(fitMap(768,500,6000,3000),{width:672,height:336});
same(fitMap(700,1000,0,0),{width:604,height:604});
same(fitMap(50,50,2000,1000),{width:1,height:1});
same(mapPoint(350,250,{left:100,top:100,width:1000,height:600}),{x:.25,y:.25});
// Zooming or scrolling changes the rendered rectangle, not persisted coordinates.
same(mapPoint(700,400,{left:200,top:100,width:2000,height:1200}),{x:.25,y:.25});
same(mapPoint(200,220,{left:-300,top:-80,width:2000,height:1200}),{x:.25,y:.25});
same(mapPoint(0,0,{left:0,top:0,width:100,height:100}),{x:0,y:0});
same(mapPoint(100,100,{left:0,top:0,width:100,height:100}),{x:1,y:1});
same(mapPoint(-1,50,{left:0,top:0,width:100,height:100}),null);
same(mapPoint(101,50,{left:0,top:0,width:100,height:100}),null);
same(mapPoint(50,-1,{left:0,top:0,width:100,height:100}),null);
same(mapPoint(50,101,{left:0,top:0,width:100,height:100}),null);
same(mapPoint(0,0,{left:0,top:0,width:0,height:100}),null);
same(mapPoint(0,0,{left:0,top:0,width:100,height:0}),null);
same(mapPoint(1,2,{left:0,top:0,width:3,height:3}),{x:.3333,y:.6667});
console.log(`${checks} canvas geometry checks passed`);
