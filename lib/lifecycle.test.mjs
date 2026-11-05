import test from 'node:test';
import assert from 'node:assert/strict';
import {ginkgoStages,getGinkgoStage,ginkgoLifecycleLimitations} from './lifecycle.ts';
test('ginkgo stage age intervals are adjacent, ordered and half-open',()=>{
 assert.equal(ginkgoStages.length,6);
 for(let i=0;i<ginkgoStages.length;i++){
  const s=ginkgoStages[i];assert.ok(s.ageStart<s.ageEnd);assert.equal(getGinkgoStage(s.ageStart).id,s.id);
  if(i)assert.equal(ginkgoStages[i-1].ageEnd,s.ageStart);
  assert.ok(s.evidence.note.includes('工程先验'));assert.ok(s.evidence.sources.length);
 }
});
test('cotyledons remain below ground; old age does not falsely claim implemented senescence',()=>{
 assert.ok(ginkgoStages.find(s=>s.id==='germination').description.includes('不画成出土绿子叶'));
 assert.equal(ginkgoStages.at(-1).implemented,false);assert.equal(getGinkgoStage(800).id,'old');
 assert.equal(getGinkgoStage(NaN).id,'seed');assert.equal(getGinkgoStage(-1).id,'seed');
});

test('stage availability never claims a completed biological life-cycle solver',()=>{assert.ok(ginkgoLifecycleLimitations.includes('不能称已完成真实全生命周期'));assert.ok(ginkgoStages.every(s=>s.evidence.note.includes('几何阶段代理')));});
