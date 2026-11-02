export interface ModelTensor {
  dataType: string;
  shape: readonly number[];
}

// Проверяем реальный контракт артефакта до первого обращения к его буферам.
export function isMoveNetContract(model: {
  inputs: readonly ModelTensor[];
  outputs: readonly ModelTensor[];
}): boolean {
  if (model.inputs.length !== 1 || model.outputs.length !== 1) return false;
  const input = model.inputs[0];
  const output = model.outputs[0];
  return input.dataType === 'uint8' && output.dataType === 'float32'
    && input.shape.length === 4 && output.shape.length === 4
    && input.shape.every((size, index) => size === [1, 192, 192, 3][index])
    && output.shape.every((size, index) => size === [1, 1, 17, 3][index]);
}
