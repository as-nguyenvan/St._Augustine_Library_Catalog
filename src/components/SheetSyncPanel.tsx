import React, { useState } from 'react';
import { User } from 'firebase/auth';
import { SheetMetadata, downloadSpreadsheetTemplateCsv } from '../services/sheetsApi';
import { extractSpreadsheetId, BookRecord } from '../utils/isbn';
import { GoogleSignInButton } from './GoogleSignInButton';
import {
  RefreshCw,
  ExternalLink,
  FileSpreadsheet,
  CheckCircle2,
  Download,
  Radio,
} from 'lucide-react';

interface SheetSyncPanelProps {
  user: User | null;
  accessToken: string | null;
  books: BookRecord[];
  sheetMeta: SheetMetadata | null;
  selectedTab: string;
  isSyncing: boolean;
  autoPollEnabled: boolean;
  lastSyncedAt: string | null;
  unresolvedRawCount: number;
  sheetError: string | null;
  onSignIn: () => void;
  onConnectSpreadsheet: (spreadsheetId: string) => Promise<void>;
  onSelectTab: (tabName: string) => void;
  onRequestCreateSpreadsheet: (sheetTitle: string) => void;
  onSyncFromSheet: () => Promise<void>;
  onToggleAutoPoll: () => void;
  onRequestWriteBackResolved: () => void;
}

export const SheetSyncPanel: React.FC<SheetSyncPanelProps> = ({
  user,
  accessToken,
  books,
  sheetMeta,
  selectedTab,
  isSyncing,
  autoPollEnabled,
  lastSyncedAt,
  unresolvedRawCount,
  sheetError,
  onSignIn,
  onConnectSpreadsheet,
  onSelectTab,
  onRequestCreateSpreadsheet,
  onSyncFromSheet,
  onToggleAutoPoll,
  onRequestWriteBackResolved,
}) => {
  const [sheetInput, setSheetInput] = useState('');
  const [newSheetTitle, setNewSheetTitle] = useState(
    "St. Augustine's Library Catalog — Master Dataset"
  );
  const [inputError, setInputError] = useState<string | null>(null);

  const handleConnectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedId = extractSpreadsheetId(sheetInput);
    if (!parsedId) {
      setInputError('Please paste a valid Google Spreadsheet URL or Spreadsheet ID.');
      return;
    }
    setInputError(null);
    await onConnectSpreadsheet(parsedId);
  };

  return (
    <section
      id="google-sheet-sync"
      className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6 no-print space-y-5"
    >
      {/* Header Row: Access Master Dataset Sheet + Enable Live Auto-Sync */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-base sm:text-lg font-semibold text-slate-900">
            Master Dataset Spreadsheet &amp; Live Auto-Sync
          </h2>
          <p className="mt-1 text-xs sm:text-sm text-slate-600">
            Access the St. Augustine&apos;s Master Dataset Google Spreadsheet and enable Live Auto-Sync so scanned ISBNs update the website catalog automatically.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Primary Option 1: Enable Live Auto-Sync */}
          <button
            type="button"
            onClick={onToggleAutoPoll}
            className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-md border px-3.5 py-2 text-xs font-semibold transition-colors ${
              autoPollEnabled
                ? 'border-emerald-700 bg-emerald-700 text-white'
                : 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800'
            }`}
          >
            <Radio className="h-3.5 w-3.5 shrink-0" />
            <span>
              {autoPollEnabled ? 'Live Auto-Sync: ON (8s)' : 'Enable Live Auto-Sync'}
            </span>
          </button>

          {/* Primary Option 2: Access Master Dataset Sheet */}
          {sheetMeta ? (
            <a
              href={sheetMeta.spreadsheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />
              <span>Access Master Dataset Sheet</span>
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          ) : (
            <button
              type="button"
              onClick={() => downloadSpreadsheetTemplateCsv(books)}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <Download className="h-3.5 w-3.5 shrink-0" />
              <span>Download Master Dataset CSV</span>
            </button>
          )}

          {!user || !accessToken ? (
            <div className="w-full sm:w-auto flex justify-center sm:justify-start">
              <GoogleSignInButton onClick={onSignIn} label="Connect Google Account" />
            </div>
          ) : (
            <div className="text-xs text-slate-600 flex items-center gap-1.5 truncate max-w-full">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              <span className="truncate">{user.email || user.displayName || 'Librarian'}</span>
            </div>
          )}
        </div>
      </div>

      {sheetError && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 break-words"
        >
          {sheetError}
        </div>
      )}

      {/* Master Dataset Connection & Google Sheet Template Creation */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <div className="lg:col-span-7 rounded-md border border-slate-200 bg-slate-50/60 p-4 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-slate-900">
                Access or Create Master Dataset Google Sheet
              </h3>
              <span className="text-[11px] font-mono tabular-nums text-slate-500">
                {books.length} Titles in Master Dataset
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Create a pre-formatted Master Dataset Google Spreadsheet in your Google Drive or connect an existing spreadsheet URL. Any barcode scanned via the iPhone Camera Scanner below is immediately appended to the master dataset.
            </p>
          </div>

          {!user || !accessToken ? (
            <div className="pt-2 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <span className="text-xs text-slate-600">
                Sign in with Google to create or link your cloud Google Spreadsheet:
              </span>
              <GoogleSignInButton
                onClick={onSignIn}
                label="Sign in for Google Sheets"
              />
            </div>
          ) : (
            <div className="space-y-3 pt-2 border-t border-slate-200">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <label htmlFor="new-sheet-title" className="sr-only">
                  New Master Dataset Spreadsheet Title
                </label>
                <input
                  id="new-sheet-title"
                  type="text"
                  value={newSheetTitle}
                  onChange={(e) => setNewSheetTitle(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={isSyncing || !newSheetTitle.trim()}
                  onClick={() => onRequestCreateSpreadsheet(newSheetTitle.trim())}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 transition-colors shrink-0 disabled:opacity-50"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />
                  <span>Create Master Dataset Sheet</span>
                </button>
              </div>

              <form
                onSubmit={handleConnectSubmit}
                className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
              >
                <label htmlFor="sheet-url-input" className="sr-only">
                  Existing Google Spreadsheet URL or ID
                </label>
                <input
                  id="sheet-url-input"
                  type="text"
                  value={sheetInput}
                  onChange={(e) => setSheetInput(e.target.value)}
                  placeholder="Or paste existing Google Sheet URL / ID..."
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={isSyncing}
                  className="w-full sm:w-auto rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 transition-colors shrink-0 disabled:opacity-50"
                >
                  Connect Existing Sheet
                </button>
              </form>
              {inputError && (
                <p className="text-xs text-red-600">{inputError}</p>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Live Auto-Sync Status & Master Sheet Columns */}
        <div className="lg:col-span-5 rounded-md border border-slate-200 bg-slate-50/60 p-4 flex flex-col justify-between space-y-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-slate-900">
                Master Dataset Status &amp; Sync Controls
              </h3>
              <span className="text-[11px] font-mono tabular-nums text-slate-500">
                {autoPollEnabled ? 'Auto-Sync Active (8s)' : 'Manual Sync'}
              </span>
            </div>

            <div className="text-xs text-slate-600 space-y-1">
              <p className="break-words">
                <span>Master Dataset Sheet: </span>
                <span className="font-semibold text-slate-900">
                  {sheetMeta ? sheetMeta.title : 'Local Master Dataset (Ready for Cloud Sheet)'}
                </span>
              </p>
              <p>
                <span>Last Synced: </span>
                <span className="font-mono tabular-nums text-slate-800">
                  {lastSyncedAt || 'Live'}
                </span>
              </p>
              <p className="text-[11px] text-slate-500 pt-1 leading-relaxed">
                Columns: Col A (ISBN) · Col B (Title) · Col C (Author) · Col D (Category) · Col E (Room Location) · Col F (Year) · Col G (Copies)
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200">
            {sheetMeta && (
              <>
                <a
                  href={sheetMeta.spreadsheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                >
                  <span>Open Master Sheet</span>
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>

                <select
                  id="sheet-tab-select"
                  aria-label="Select spreadsheet tab"
                  value={selectedTab}
                  onChange={(e) => onSelectTab(e.target.value)}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800"
                >
                  {sheetMeta.sheets.map((tab) => (
                    <option key={tab} value={tab}>
                      {tab}
                    </option>
                  ))}
                </select>
              </>
            )}

            <button
              type="button"
              onClick={onSyncFromSheet}
              disabled={isSyncing}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 shrink-0 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Syncing...' : 'Sync Master Dataset Now'}</span>
            </button>

            {unresolvedRawCount > 0 && (
              <button
                type="button"
                onClick={onRequestWriteBackResolved}
                className="w-full sm:w-auto rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 transition-colors"
              >
                Write {unresolvedRawCount} Resolved Row(s)
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
