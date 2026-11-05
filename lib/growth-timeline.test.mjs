import test from 'node:test';
import assert from 'node:assert/strict';
import {ageAtProgress, progressAtAge, advanceGrowth, selectGrowthAge, springObservation,observationStages} from './growth-timeline.ts';
import {dateLabel,getSpecies} from './species.ts';

test('presentation timeline is monotone and reversible across species age ranges', () => {
  for (const max of [2, 5, 40, 80]) {
    let previous = -1;
    for (let i = 0; i <= 1000; i++) {
      const progress = i / 1000, age = ageAtProgress(progress, max);
      assert.ok(age >= previous && age <= max);
      assert.ok(Math.abs(progressAtAge(age, max) - progress) < 1e-12);
      previous = age;
    }
    assert.equal(ageAtProgress(-1, max), 0);
    assert.equal(ageAtProgress(2, max), max);
  }
});
test('seed restart, stage selection, growth and pause preserve season and wind time', () => {
  for (const day of [1, 120, 305, 365]) {
    let scene = {age: 18, day, windSeconds: 17, seed: 42};
    for (const age of [0, .005, .06, .5, 8, 45]) {
      scene = {...scene, ...selectGrowthAge(age)};
      for (const clock of ['life', 'age']) {
        const next = {...scene, ...advanceGrowth(scene, clock, .12, 80)};
        assert.equal(next.day, day);
        assert.equal(next.windSeconds, 17);
        assert.equal(next.seed, 42);
        assert.deepEqual({...scene, ...advanceGrowth(scene, clock, 0, 80)}, scene);
      }
    }
  }
});
test('season playback wraps continuously and preserves age and wind seconds', () => {
  const scene = {age: 18, day: 365, windSeconds: 42};
  for (const elapsed of [0, .01, .12, 1, 20, 4000]) {
    const next = {...scene, ...advanceGrowth(scene, 'day', elapsed, 80)};
    assert.ok(next.day >= 1 && next.day < 366);
    assert.equal(next.age, scene.age);
    assert.equal(next.windSeconds, scene.windSeconds);
  }
  assert.deepEqual(advanceGrowth(scene, 'day', 1, 80), {day: 11});
});
test('age playback stops at species limit and spring preset changes only the day', () => {
  for (const clock of ['life', 'age']) {
    assert.deepEqual(advanceGrowth({age: 79, day: 305}, clock, 1000, 80), {age: 80});
    assert.deepEqual(advanceGrowth({age: 80, day: 305}, clock, 1, 80), {age: 80});
  }
  assert.deepEqual({...{age: 8, day: 305, windSeconds: 9}, ...springObservation()}, {age: 8, day: 120, windSeconds: 9});
});

test('season playback is independent of update partitioning', () => {
 const initial={age:18,day:364.5};
 const whole=advanceGrowth(initial,'day',1.2,80);
 let split=initial;
 for(let i=0;i<10;i++) split={...split,...advanceGrowth(split,'day',.12,80)};
 assert.ok(Math.abs(whole.day-split.day)<1e-10);
});
test('observation anchors follow implemented establishment rather than uniformly dividing a species lifespan',()=>{
 for(const [id,points]of Object.entries(observationStages)){
  assert.ok(points.length>=4);let previous=-1;
  for(const [label,age]of points){assert.ok(label&&age>previous&&age<=getSpecies(id).maxAge);previous=age;}
 }
 assert.match(observationStages.iris[0][0],/根茎/);
 assert.match(observationStages.oxalis[0][0],/茎节/);
 assert.match(observationStages.ophiopogon[0][0],/营养繁殖/);
 assert.ok(observationStages.osmanthus[2][1]<1);
 assert.equal(dateLabel(365.9),'12月31日');assert.equal(dateLabel(1),'1月1日');
});
