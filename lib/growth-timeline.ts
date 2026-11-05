/** Interaction timing only; these rates are uncalibrated presentation choices. */
export type GrowthClock = 'life' | 'age' | 'day';
const keys = [0, .012, .04, .12, .5, 2, 8, 20, 60, 80];
export function ageAtProgress(progress: number, max = 80) {
  const t = Math.max(0, Math.min(1, progress)) * (keys.length - 1);
  const i = Math.min(keys.length - 2, Math.floor(t));
  return (keys[i] + (keys[i + 1] - keys[i]) * (t - i)) * max / 80;
}
export function progressAtAge(age: number, max = 80) {
  const a = age * 80 / max;
  const i = keys.findIndex((key, j) => j < keys.length - 1 && a >= key && a <= keys[j + 1]);
  return i < 0 ? (a >= 80 ? 1 : 0) : (i + (a - keys[i]) / (keys[i + 1] - keys[i])) / (keys.length - 1);
}
/** Return only the active clock's patch so age, season and wind seconds stay independent. */
export function advanceGrowth(time: {age: number; day: number}, clock: GrowthClock, elapsedSeconds: number, maxAge: number) {
  const elapsed = Math.max(0, elapsedSeconds);
  if (clock === 'day') return {day: 1 + ((time.day - 1 + elapsed * 11) % 365)};
  return {age: clock === 'life'
    ? ageAtProgress(Math.min(1, progressAtAge(time.age, maxAge) + elapsed / 40), maxAge)
    : Math.min(maxAge, time.age + maxAge * elapsed / 52)};
}
export function selectGrowthAge(age: number) { return {age}; }
/** Explicit observation preset, not a campus measurement or germination requirement. */
export function springObservation() { return {day: 120}; }

/** Observation anchors matched to implemented organ cohorts, not measured ages. */
export const observationStages:Record<string,readonly (readonly [string,number])[]>={
 ginkgo:[['种子',.005],['胚根 / 芽',.06],['真叶幼苗',.5],['幼树',8],['成年树冠',45]],
 osmanthus:[['种子',0],['胚根与芽',.04],['对生真叶',.25],['分枝幼株',1.5],['常绿冠层',12]],
 iris:[['根茎分株',0],['首叶展开',.08],['二列叶扇',.4],['新分株形成',1.5]],
 oxalis:[['带根茎节',0],['三出复叶',.05],['匍匐新节',.3],['群落扩展',.8]],
 camphor:[['种子建立',0],['主轴出苗',.15],['互生叶建立',.6],['侧枝形成',3],['开展冠层',24]],
 acer:[['种子建立',0],['弯钩出苗',.04],['子叶与真叶',.12],['后续对生叶',.5],['细枝分化',3],['层状冠',18]],
 ophiopogon:[['营养繁殖起点',0],['首批狭叶',.15],['基生叶丛',.8],['根茎与子株',3]],
};
