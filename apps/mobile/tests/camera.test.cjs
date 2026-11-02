const assert = require('node:assert/strict');
const { test } = require('node:test');
const { shouldActivateCamera } = require('../src/features/camera/cameraPolicy.ts');

const ready = {
  hasPermission: true, hasDevice: true, isFocused: true,
  appState: 'active', isPaused: false, hasError: false,
};

test('starts only with permission, a device and a visible foreground screen', () => {
  assert.equal(shouldActivateCamera(ready), true);
});

for (const patch of [
  { hasPermission: false }, { hasDevice: false }, { isFocused: false },
  { appState: 'background' }, { appState: 'inactive' }, { appState: null },
  { isPaused: true }, { hasError: true },
]) {
  test(`stops camera when ${JSON.stringify(patch)}`, () => {
    assert.equal(shouldActivateCamera({ ...ready, ...patch }), false);
  });
}
