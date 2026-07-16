import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';

interface SortIconProps {
  field: string;
  activeField: string | null;
  direction: 'asc' | 'desc';
}

export function SortIcon({ field, activeField, direction }: SortIconProps) {
  if (activeField !== field) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
  return direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
}
