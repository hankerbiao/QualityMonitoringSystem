interface SuggestionItem {
  salesOrder: string;
  productionOrders: string[];
}

interface SuggestionDropdownProps {
  suggestions: SuggestionItem[];
  onSelect: (salesOrder: string, productionOrder: string) => void;
}

export function SuggestionDropdown({ suggestions, onSelect }: SuggestionDropdownProps) {
  return (
    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-sm shadow-lg max-h-48 overflow-auto">
      {suggestions.map((item, idx) => (
        <div key={idx}>
          <div className="px-2 py-1 text-[10px] text-blue-600 bg-blue-50 border-b border-slate-100 font-medium">
            销售订单: {item.salesOrder}
          </div>
          {item.productionOrders.map((po, poIdx) => (
            <button
              key={poIdx}
              className="w-full text-left px-4 py-1.5 text-xs hover:bg-blue-50 text-slate-600 truncate pl-4"
              onMouseDown={() => onSelect(item.salesOrder, po)}
            >
              {po}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}