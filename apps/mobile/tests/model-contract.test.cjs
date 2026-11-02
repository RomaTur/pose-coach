const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isMoveNetContract } = require('../src/features/pose/inference/modelContract.ts');

const valid = () => ({
  inputs: [{ dataType: 'uint8', shape: [1, 192, 192, 3] }],
  outputs: [{ dataType: 'float32', shape: [1, 1, 17, 3] }],
});

test('accepts the exact bundled Lightning uint8 NHWC contract', () => {
  assert.equal(isMoveNetContract(valid()), true);
});
test('rejects signed/float input, wrong order or another model resolution', () => {
  for (const input of [
    { dataType: 'int8', shape: [1, 192, 192, 3] },
    { dataType: 'float32', shape: [1, 192, 192, 3] },
    { dataType: 'uint8', shape: [1, 3, 192, 192] },
    { dataType: 'uint8', shape: [1, 256, 256, 3] },
  ]) assert.equal(isMoveNetContract({ ...valid(), inputs: [input] }), false);
});
test('rejects missing/additional tensors and incompatible output', () => {
  const model = valid();
  for (const invalid of [
    { ...model, inputs: [] }, { ...model, outputs: [] },
    { ...model, inputs: [...model.inputs, ...model.inputs] },
    { ...model, outputs: [...model.outputs, ...model.outputs] },
    { ...model, outputs: [{ dataType: 'uint8', shape: [1, 1, 17, 3] }] },
    { ...model, outputs: [{ dataType: 'float32', shape: [17, 3] }] },
  ]) assert.equal(isMoveNetContract(invalid), false);
});
