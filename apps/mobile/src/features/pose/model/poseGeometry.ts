function isValidPose(pose: Float32Array, width: number, height: number): boolean {
  'worklet';

  if (pose.length !== 51 || !Number.isFinite(width) || width <= 0 ||
      !Number.isFinite(height) || height <= 0) return false;
  for (let i = 0; i < 51; i += 1) {
    if (!Number.isFinite(pose[i])) return false;
  }
  return true;
}

export function unletterboxPose(pose: Float32Array, width: number, height: number): boolean {
  'worklet';

  // Весь вход проверяется до первой записи: отказ не должен оставлять полупозу.
  if (!isValidPose(pose, width, height)) return false;

  const longest = Math.max(width, height);
  const scaleX = width / longest;
  const scaleY = height / longest;
  const padX = (1 - scaleX) / 2;
  const padY = (1 - scaleY) / 2;
  // Проверяем и представимость результата в Float32, сохраняя атомарность отказа.
  for (let i = 0; i < 51; i += 3) {
    const x = (pose[i] - padX) / scaleX;
    const y = (pose[i + 1] - padY) / scaleY;
    if (!Number.isFinite(Math.fround(x)) || !Number.isFinite(Math.fround(y))) return false;
  }
  for (let i = 0; i < 51; i += 3) {
    const x = (pose[i] - padX) / scaleX;
    const y = (pose[i + 1] - padY) / scaleY;
    pose[i] = x;
    pose[i + 1] = y;
    // Точки в полях не превращаем в фиктивные суставы на краю исходного кадра.
    if (x < 0 || x > 1 || y < 0 || y > 1) pose[i + 2] = 0;
  }
  return true;
}

function legConfidence(pose: Float32Array, hipIndex: number, threshold: number): number {
  'worklet';

  let confidence = Infinity;
  for (let joint = hipIndex; joint <= hipIndex + 4; joint += 2) {
    const offset = joint * 3;
    const x = pose[offset];
    const y = pose[offset + 1];
    const score = pose[offset + 2];
    if (x < 0 || x > 1 || y < 0 || y > 1 || score < threshold) return -1;
    confidence = Math.min(confidence, score);
  }
  return confidence;
}

export function getKneeAngle(
  pose: Float32Array,
  width: number,
  height: number,
  threshold = 0.4,
): number | null {
  'worklet';

  if (!isValidPose(pose, width, height) || !Number.isFinite(threshold) ||
      threshold < 0 || threshold > 1) return null;

  const leftConfidence = legConfidence(pose, 11, threshold);
  const rightConfidence = legConfidence(pose, 12, threshold);
  if (leftConfidence < 0 && rightConfidence < 0) return null;
  const hip = (leftConfidence >= rightConfidence ? 11 : 12) * 3;
  const knee = hip + 6;
  const ankle = hip + 12;

  // Общий масштаб сокращён: пропорции пикселей сохранены без больших произведений.
  const longest = Math.max(width, height);
  const scaleX = width / longest;
  const scaleY = height / longest;
  const hipX = (pose[hip] - pose[knee]) * scaleX;
  const hipY = (pose[hip + 1] - pose[knee + 1]) * scaleY;
  const ankleX = (pose[ankle] - pose[knee]) * scaleX;
  const ankleY = (pose[ankle + 1] - pose[knee + 1]) * scaleY;
  const hipLength = Math.hypot(hipX, hipY);
  const ankleLength = Math.hypot(ankleX, ankleY);
  if (hipLength === 0 || ankleLength === 0) return null;

  const cosine = (hipX / hipLength) * (ankleX / ankleLength) +
    (hipY / hipLength) * (ankleY / ankleLength);
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * (180 / Math.PI);
}

export function isBodyVisible(pose: Float32Array, threshold = 0.4): boolean {
  'worklet';

  if (pose.length !== 51 || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) return false;
  for (let joint = 0; joint < 17; joint += 1) {
    const offset = joint * 3;
    const x = pose[offset];
    const y = pose[offset + 1];
    const score = pose[offset + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(score)) return false;
    // COCO17: оба плеча и все суставы ног; лицо и руки для этой подсказки необязательны.
    const required = joint === 5 || joint === 6 || joint >= 11;
    if (required && (x < 0 || x > 1 || y < 0 || y > 1 || score < threshold)) return false;
  }
  return true;
}
