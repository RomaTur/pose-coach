// Monorepo watchFolders/resolver setup comes from expo/metro-config automatically
// (SDK 52+, research.md R-007) — do not hand-roll it.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// MoveNet ships as a .tflite file bundled via require(); Metro must treat it
// as a binary asset instead of trying to parse it as source (phase 0.3).
config.resolver.assetExts.push('tflite');

module.exports = config;
