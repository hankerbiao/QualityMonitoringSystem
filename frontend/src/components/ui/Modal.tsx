import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: string;
}

export function Modal({ title, onClose, children, footer, maxWidth = 'max-w-lg' }: ModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div
        className={`bg-white rounded-md shadow-xl border border-slate-200 w-full ${maxWidth} max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-200 flex justify-between items-center bg-[#f8fafc]">
          <h3 className="text-base font-semibold text-slate-800">{title}</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-sm hover:bg-slate-200 text-slate-500 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {children}
        </div>

        {footer && (
          <div className="px-5 py-3 border-t border-slate-200 bg-[#f8fafc] flex justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}