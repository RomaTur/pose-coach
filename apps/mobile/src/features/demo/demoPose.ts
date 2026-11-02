export const DEMO_WIDTH = 480;
export const DEMO_HEIGHT = 640;

// Синтетическое движение для демонстрации UI, не результат камеры или ML.
export function demoPoseAt(timeMs: number): Float32Array {
  const time = Math.max(0, Number.isFinite(timeMs) ? timeMs : 0) % 4000;
  const depth = time < 1000 ? 0 : time < 1700 ? (time - 1000) / 700
    : time < 2500 ? 1 : time < 3200 ? 1 - (time - 2500) / 700 : 0;
  const angle = (170 - depth * 90) * Math.PI / 180;
  const points = new Float32Array(51);
  const put = (joint: number, x: number, y: number) => {
    points[joint * 3] = x; points[joint * 3 + 1] = y; points[joint * 3 + 2] = 0.99;
  };
  const hipX = 0.5 - depth * 0.13;
  const hipY = 0.46 + depth * 0.2;
  for (let face = 0; face < 5; face++) put(face, hipX + (face - 2) * 0.012, hipY - 0.32);
  for (let side = 0; side < 2; side++) {
    const offset = side * 0.1 - 0.05;
    put(5 + side, hipX + offset, hipY - 0.23);
    put(7 + side, hipX + offset + 0.08, hipY - 0.14);
    put(9 + side, hipX + offset + 0.16, hipY - 0.18);
    put(11 + side, hipX + offset, hipY);
    const kneeX = 0.58 + offset;
    const kneeY = 0.68;
    put(13 + side, kneeX, kneeY);
    const thighDirection = Math.atan2((hipY - kneeY) * DEMO_HEIGHT,
      (hipX + offset - kneeX) * DEMO_WIDTH);
    put(15 + side, kneeX + Math.cos(thighDirection - angle) * 95 / DEMO_WIDTH,
      kneeY + Math.sin(thighDirection - angle) * 95 / DEMO_HEIGHT);
  }
  return points;
}
