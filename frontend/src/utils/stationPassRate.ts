export interface StationRateValue {
  passRate: number;
}

export function combinedStationPassRate(
  stationRows: ReadonlyMap<string, StationRateValue>,
  stationCodes: readonly string[],
): number | null {
  if (!stationCodes.length) return null;

  let rate = 1;
  for (const stationCode of stationCodes) {
    const station = stationRows.get(stationCode);
    if (!station) return null;
    rate *= station.passRate / 100;
  }
  return rate * 100;
}
