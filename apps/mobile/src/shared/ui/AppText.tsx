import type { ComponentProps } from 'react';
import { Text, useWindowDimensions } from 'react-native';

export function AppText(props: ComponentProps<typeof Text>) {
  const { fontScale } = useWindowDimensions();
  // RN 0.86 сохраняет старую раскладку при Dynamic Type: пересоздаём только Text.
  // Удалить key после upstream-фикса и проверки смены размера без перезапуска.
  return <Text {...props} key={fontScale} />;
}
