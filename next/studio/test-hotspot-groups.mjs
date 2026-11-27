import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {groupHotspots,iconMarkup} from './icons.mjs';
const source=JSON.parse(await readFile(new URL('../private-studio/source-catalog.json',import.meta.url),'utf8'));
let scenes=0,valid=0;for(const c of [...source.courses,...source.unlinked.tours])for(const scene of c.scenes){const before=JSON.stringify(scene.hotspots);const grouped=groupHotspots(scene.hotspots);const expected=scene.hotspots.filter(h=>Number.isFinite(h.pitch)&&Number.isFinite(h.yaw));assert.deepEqual(grouped.flatMap(g=>g.items).map(x=>x.id).sort(),expected.map(x=>x.id).sort());assert.equal(JSON.stringify(scene.hotspots),before);scenes++;valid+=expected.length;}
assert.equal(groupHotspots([{id:'info',pitch:1,yaw:2,kind:'info'},{id:'sound',pitch:1,yaw:2,kind:'audio'}]).length,1);
assert.equal(groupHotspots([{id:'first',pitch:1,yaw:2},{id:'nearby',pitch:1.0001,yaw:2}]).length,2);
assert.ok(iconMarkup('audio').includes('/icons/sound.png'));assert.ok(!iconMarkup('<script>').includes('<script>'));
console.log(JSON.stringify({scenesChecked:scenes,positionedItemsPreserved:valid,samePointFunctionsGrouped:true,nearbyPointsRemainDistinct:true,sourceDataUnchanged:true}));
