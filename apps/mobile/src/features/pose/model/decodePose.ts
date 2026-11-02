export function decodePose(output: Float32Array, target: Float32Array): boolean {
  'worklet';

  if (output.length !== 51 || target.length !== 51) return false;

  // Проверяем весь выход до записи, чтобы не оставить частично обновлённую позу.
  for (let i = 0; i < 51; i += 1) {
    if (!Number.isFinite(output[i])) return false;
  }

  // При сдвиге вправо в общем буфере читаем с конца, не затирая следующие тройки.
  const backwards = output.buffer === target.buffer && target.byteOffset > output.byteOffset;
  const step = backwards ? -3 : 3;
  for (let i = backwards ? 48 : 0; i >= 0 && i < 51; i += step) {
    const y = output[i];
    const x = output[i + 1];
    const score = output[i + 2];
    target[i] = x;
    target[i + 1] = y;
    target[i + 2] = score;
  }
  return true;
}
