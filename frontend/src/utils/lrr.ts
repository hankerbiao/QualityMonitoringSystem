export function displayMaterialNumber(materialNumber: string): string {
  return materialNumber.length > 8 ? materialNumber.slice(-8) : materialNumber;
}

export interface PlannedDateRange {
  plannedDateFrom: string;
  plannedDateTo: string;
}

function formatDateInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function recentPlannedRange(monthCount: number, today = new Date()): PlannedDateRange {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end.getFullYear(), end.getMonth() - monthCount + 1, 1);
  return { plannedDateFrom: formatDateInput(start), plannedDateTo: formatDateInput(end) };
}

export function matchingPlannedRange(from?: string | null, to?: string | null, today = new Date()): 1 | 2 | 3 | null {
  const months = [1, 2, 3] as const;
  return months.find((monthCount) => {
    const range = recentPlannedRange(monthCount, today);
    return range.plannedDateFrom === from && range.plannedDateTo === to;
  }) ?? null;
}
