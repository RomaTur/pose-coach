import type { ScreenPoint } from '../model/types';

export function frameToScreen(
  x: number,
  y: number,
  frameWidth: number,
  frameHeight: number,
  viewWidth: number,
  viewHeight: number,
  mirrored: boolean,
): ScreenPoint {
  'worklet';

  // Ориентация уже учтена вызывающим кодом; здесь только cover и зеркало.
  const scale = Math.max(viewWidth / frameWidth, viewHeight / frameHeight);
  const width = frameWidth * scale;
  const height = frameHeight * scale;
  const screenX = x * width + (viewWidth - width) / 2;
  return {
    x: mirrored ? viewWidth - screenX : screenX,
    y: y * height + (viewHeight - height) / 2,
  };
}
