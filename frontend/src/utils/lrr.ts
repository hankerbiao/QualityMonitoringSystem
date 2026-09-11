export function displayMaterialNumber(materialNumber: string): string {
  return materialNumber.length > 8 ? materialNumber.slice(-8) : materialNumber;
}
