export type FrameMetrics = {
  readonly capacity: number;
  readonly timestampsMs: Float64Array;
  readonly inferenceMs: Float64Array;
  count: number;
  nextIndex: number;
};

export type FrameSummary = {
  count: number;
  avgMs: number | null;
  p95Ms: number | null;
  fps: number | null;
};

export function createFrameMetrics(capacity = 120): FrameMetrics {
  'worklet';

  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new RangeError('Frame metrics capacity must be a positive integer');
  }
  return {
    capacity,
    timestampsMs: new Float64Array(capacity),
    inferenceMs: new Float64Array(capacity),
    count: 0,
    nextIndex: 0,
  };
}

export function recordFrame(
  metrics: FrameMetrics,
  timestampMs: number,
  inferenceMs: number,
): void {
  'worklet';

  if (!Number.isFinite(timestampMs) || timestampMs < 0 ||
      !Number.isFinite(inferenceMs) || inferenceMs < 0) return;

  if (metrics.count > 0) {
    const previousIndex = (metrics.nextIndex + metrics.capacity - 1) % metrics.capacity;
    const elapsedMs = timestampMs - metrics.timestampsMs[previousIndex];
    // Отбрасываем весь отсчёт: неверное время не должно влиять и на latency.
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || !Number.isFinite(1000 / elapsedMs)) return;
  }

  metrics.timestampsMs[metrics.nextIndex] = timestampMs;
  metrics.inferenceMs[metrics.nextIndex] = inferenceMs;
  metrics.nextIndex = (metrics.nextIndex + 1) % metrics.capacity;
  metrics.count = Math.min(metrics.count + 1, metrics.capacity);
}

export function summarizeFrames(metrics: FrameMetrics): FrameSummary {
  'worklet';

  const { count, capacity, nextIndex } = metrics;
  if (count === 0) return { count: 0, avgMs: null, p95Ms: null, fps: null };

  // Снимок и сортировка нужны только для сводки, не для покадровой записи.
  const sorted = new Float64Array(count);
  let avgMs = 0;
  for (let i = 0; i < count; i += 1) {
    const value = metrics.inferenceMs[i];
    sorted[i] = value;
    // Для неотрицательных значений разность конечна, в отличие от общей суммы.
    avgMs += (value - avgMs) / (i + 1);
  }
  sorted.sort();

  const oldestIndex = count === capacity ? nextIndex : 0;
  const newestIndex = (nextIndex + capacity - 1) % capacity;
  const elapsedMs = metrics.timestampsMs[newestIndex] - metrics.timestampsMs[oldestIndex];
  return {
    count,
    avgMs,
    p95Ms: sorted[Math.ceil(count * 0.95) - 1],
    fps: count < 2 ? null : ((count - 1) * 1000) / elapsedMs,
  };
}
