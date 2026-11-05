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
