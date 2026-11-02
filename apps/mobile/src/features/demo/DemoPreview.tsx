import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { colors } from '../../shared/ui/coachUi';
import { AppText as Text } from '../../shared/ui/AppText';
import { coachStore } from '../coach/model/coachStore';
import type { PoseSnapshot } from '../pose/inference/usePosePipeline';
import { getKneeAngle } from '../pose/model/poseGeometry';
import { PoseOverlay } from '../pose/overlay/PoseOverlay';
import { DEMO_HEIGHT, DEMO_WIDTH, demoPoseAt } from './demoPose';

export function DemoPreview({ isActive, viewportHeight }: { isActive: boolean; viewportHeight: number }) {
  const pose = useSharedValue<PoseSnapshot | null>(null);
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!isActive) { pose.set(null); return; }
    const start = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      const points = demoPoseAt(now - start);
      pose.set({ points, width: DEMO_WIDTH, height: DEMO_HEIGHT, timestampMs: now, receivedAt: now });
      coachStore.getState().dispatch({ type: 'pose', bodyVisible: true,
        angle: getKneeAngle(points, DEMO_WIDTH, DEMO_HEIGHT) });
    }, 80);
    return () => { clearInterval(timer); pose.set(null); };
  }, [isActive, pose]);
  return <View>
    {/* Измеряем только область позы: подпись растёт отдельной строкой ниже. */}
    <View style={{ height: viewportHeight }} onLayout={event => setLayout(event.nativeEvent.layout)}>
      <PoseOverlay pose={pose} width={layout.width} height={layout.height} mirrored={false} />
    </View>
    <Text style={styles.label}>Синтетическая поза · камера выключена</Text>
  </View>;
}

const styles = StyleSheet.create({
  label: { paddingVertical: 12, paddingHorizontal: 16, color: colors.muted, fontSize: 13, textAlign: 'center' },
});
