import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  details?: string[];
  confirmLabel: string;
  isDestructive?: boolean;
  isBusy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  title,
  description,
  details = [],
  confirmLabel,
  isDestructive = false,
  isBusy = false,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <AlertTriangle
              className={`h-5 w-5 shrink-0 ${
                isDestructive ? 'text-red-600' : 'text-amber-600'
              }`}
              aria-hidden="true"
            />
            <h2
              id="confirm-dialog-title"
              className="text-base font-semibold text-slate-900"
            >
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isBusy}
            aria-label="Close confirmation dialog"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-3 text-sm text-slate-600 leading-relaxed">{description}</p>

        {details.length > 0 && (
          <ul className="mt-3 max-h-36 overflow-y-auto rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 space-y-1 font-mono tabular-nums">
            {details.map((item, idx) => (
              <li key={idx} className="truncate">
                {item}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isBusy}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isBusy}
            className={`rounded-md px-4 py-2 text-xs font-medium text-white transition-colors whitespace-nowrap shrink-0 ${
              isDestructive
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-slate-900 hover:bg-slate-800'
            }`}
          >
            {isBusy ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
