import test from'node:test';import assert from'node:assert/strict';import{buildAdditionalPlant}from'./additional-species.ts';
test('new Ophiopogon leaves cannot reroll an established flower scape',()=>{
 const scape=age=>{const m=buildAdditionalPlant('ophiopogon',{age,day:190,seed:42,density:1});const flower=m.branches[0].pivot.children.find(o=>o.userData.organ==='flower');assert.ok(flower);const stem=flower.children.find(o=>o.isMesh&&!o.isInstancedMesh);const vertices=Array.from(stem.geometry.attributes.position.array);m.dispose();return vertices;};
 for(const leaf of [55,63,75,83]){const birth=.025+leaf*.019;assert.deepEqual(scape(birth-1e-6),scape(birth+1e-6));}
});
