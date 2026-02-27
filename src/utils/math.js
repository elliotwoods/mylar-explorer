export const TAU = Math.PI * 2;
export const DEG2RAD = Math.PI / 180;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothStep01(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export function rms(values) {
  if (!values.length) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) sum += values[i] * values[i];
  return Math.sqrt(sum / values.length);
}

export function estimateFrequencyFromZeroCrossings(samples, dt) {
  if (samples.length < 4) return 0;
  const crossings = [];
  for (let i = 1; i < samples.length; i += 1) {
    if (samples[i - 1] <= 0 && samples[i] > 0) crossings.push(i);
  }
  if (crossings.length < 2) return 0;
  const periods = [];
  for (let i = 1; i < crossings.length; i += 1) {
    periods.push((crossings[i] - crossings[i - 1]) * dt);
  }
  const avgPeriod = periods.reduce((a, b) => a + b, 0) / periods.length;
  return avgPeriod > 0 ? 1 / avgPeriod : 0;
}
