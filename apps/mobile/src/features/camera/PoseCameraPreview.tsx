import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import type { TfliteModel } from 'react-native-fast-tflite';
import { Camera, type CameraDevice } from 'react-native-vision-camera';

import { usePosePipeline, type PoseSummary } from '../pose/inference/usePosePipeline';
import { PoseOverlay } from '../pose/overlay/PoseOverlay';

function CaptureAwake() {
  useKeepAwake('pose-coach-camera', { suppressDeactivateWarnings: true });
  return null;
}

export function PoseCameraPreview({ device, isActive, model, onError, onPipelineError, onSummary, onSample }: {
  device: CameraDevice;
  isActive: boolean;
  model: TfliteModel | undefined;
  onError: (error: Error) => void;
  onPipelineError: (message: string) => void;
  onSummary: (summary: PoseSummary) => void;
  onSample: (angle: number | null, bodyVisible: boolean) => void;
}) {
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const pipeline = usePosePipeline(model, isActive, onSummary, onSample);
  const outputs = useMemo(() => [pipeline.output], [pipeline.output]);
  useEffect(() => {
    if (pipeline.error != null) onPipelineError(pipeline.error);
  }, [pipeline.error, onPipelineError]);

  return <View style={StyleSheet.absoluteFill}
    onLayout={event => setLayout(event.nativeEvent.layout)}>
    {isActive && <CaptureAwake />}
    <Camera style={StyleSheet.absoluteFill} device={device} isActive={isActive}
      outputs={outputs} resizeMode="cover" orientationSource="interface" onError={onError} />
    {isActive && pipeline.isReady && <PoseOverlay pose={pipeline.pose}
      width={layout.width} height={layout.height} mirrored={device.position === 'front'} />}
  </View>;
}
