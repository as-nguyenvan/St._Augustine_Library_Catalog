import React, { useState, useRef, useCallback } from 'react';
import {
  BookRecord,
  generateCustomIsbn13,
  formatIsbn13,
  encodeEan13Bits,
} from '../utils/isbn';
import { BarcodeSvg } from './BarcodeSvg';
import {
  Printer,
  Download,
  ScanLine,
  Plus,
  Trash2,
  Scissors,
  X,
  CheckCircle2,
} from 'lucide-react';

export interface PrintableBarcodeItem {
  id: string;
  isbn: string;
  formattedIsbn: string;
  title: string;
  author: string;
  roomLocation: string;
  publishedYear: string;
}

interface CustomIsbnStudioProps {
  books: BookRecord[];
  printQueueIds: string[];
  onCreateCustomIsbnBook: (data: {
    title: string;
    author: string;
    category: string;
    roomLocation: string;
    publishedYear: string;
  }) => Promise<BookRecord | null>;
  onTogglePrintQueue: (bookId: string) => void;
  onAddAllCustomToQueue: () => void;
  onClearPrintQueue: () => void;
  onTestScanIsbn: (isbn: string) => void;
}

function buildBarcodeSvgMarkup(
  isbn: string,
  title: string,
  author: string
): string {
  const bits = encodeEan13Bits(isbn);
  const quietZone = 9;
  const totalModules = bits.length + quietZone * 2;
  const rects = bits
    .split('')
    .map((bit, idx) => {
      if (bit !== '1') return '';
      const isGuard = idx < 3 || (idx >= 45 && idx < 50) || idx >= 92;
      const h = isGuard ? 62 : 54;
      return `<rect x="${quietZone + idx}" y="22" width="1" height="${h}" fill="#0f172a" />`;
    })
    .join('');

  const safeTitle = title.replace(/[<>&"']/g, '');
  const safeAuthor = author.replace(/[<>&"']/g, '');
  const formatted = formatIsbn13(isbn);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalModules} 100" width="250" height="175" style="display:block;margin:0 auto;">
    <rect x="0" y="0" width="${totalModules}" height="100" fill="#ffffff" />
    <text x="${totalModules / 2}" y="10" text-anchor="middle" font-family="sans-serif" font-size="5" font-weight="bold" fill="#0f172a">${safeTitle.slice(0, 34)}</text>
    <text x="${totalModules / 2}" y="17" text-anchor="middle" font-family="sans-serif" font-size="4.2" fill="#475569">${safeAuthor.slice(0, 38)}</text>
    ${rects}
    <text x="${totalModules / 2}" y="95" text-anchor="middle" font-family="monospace" font-size="7.5" font-weight="bold" fill="#0f172a">${formatted}</text>
  </svg>`;
}

export const CustomIsbnStudio: React.FC<CustomIsbnStudioProps> = ({
  books,
  printQueueIds,
  onCreateCustomIsbnBook,
  onTogglePrintQueue,
  onAddAllCustomToQueue,
  onClearPrintQueue,
  onTestScanIsbn,
}) => {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [category, setCategory] = useState('Patristic Archives');
  const [roomLocation, setRoomLocation] = useState('Patristic Hall · Room 101');
  const [publishedYear, setPublishedYear] = useState('1950');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastCreated, setLastCreated] = useState<BookRecord | null>(null);

  // Printing Popup Screen state
  const [printPopupItems, setPrintPopupItems] = useState<
    PrintableBarcodeItem[] | null
  >(null);
  const [printPopupTitle, setPrintPopupTitle] = useState<string>('');
  const [printStatusNotice, setPrintStatusNotice] = useState<string | null>(
    null
  );
  const printIframeRef = useRef<HTMLIFrameElement | null>(null);

  const queuedBooks = books.filter((b) => printQueueIds.includes(b.id));
  const customBooks = books.filter((b) => b.isCustomIsbn);
  const activePreviewBook = lastCreated || customBooks[0] || null;

  const previewIsbn =
    title.trim() && author.trim()
      ? generateCustomIsbn13(title.trim(), author.trim())
      : activePreviewBook
      ? activePreviewBook.isbn
      : '9790009180384';

  const previewTitle =
    title.trim() ||
    activePreviewBook?.title ||
    'St. Augustine Parish Homilies & Letters (Unindexed Folio)';
  const previewAuthor =
    author.trim() || activePreviewBook?.author || 'Augustine of Hippo';
  const previewRoom =
    roomLocation.trim() ||
    activePreviewBook?.roomLocation ||
    'Patristic Hall · Room 101';
  const previewYear =
    publishedYear.trim() || activePreviewBook?.publishedYear || '1950';

  const currentPreviewItem: PrintableBarcodeItem = {
    id: activePreviewBook?.id || `preview-${previewIsbn}`,
    isbn: previewIsbn,
    formattedIsbn: formatIsbn13(previewIsbn),
    title: previewTitle,
    author: previewAuthor,
    roomLocation: previewRoom,
    publishedYear: previewYear,
  };

  /**
   * Writes the 7x11 inch printable HTML document into the hidden print iframe
   * and triggers the native system print dialog.
   */
  const executeSystemPrint = useCallback((items: PrintableBarcodeItem[]) => {
    setPrintStatusNotice(
      'Opening system print dialog for 7×11 in paper...'
    );

    const cardsHtml = items
      .map(
        (item) => `
        <div class="label-card">
          <div class="label-meta">
            <span>✂ ${item.roomLocation.replace(/[<>&]/g, '')} · Cut &amp; Tape to Back</span>
            <span>${item.publishedYear.replace(/[<>&]/g, '')}</span>
          </div>
          ${buildBarcodeSvgMarkup(item.isbn, item.title, item.author)}
        </div>
      `
      )
      .join('');

    const htmlDoc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>St. Augustine's Library — 7x11 Barcode Print Sheet</title>
  <style>
    @page {
      size: 7in 11in;
      margin: 0.35in;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: 0.2in;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #ffffff;
      color: #0f172a;
    }
    .sheet-header {
      font-size: 11px;
      color: #475569;
      border-bottom: 1px solid #cbd5e1;
      padding-bottom: 8px;
      margin-bottom: 14px;
      display: flex;
      justify-content: space-between;
    }
    .labels-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 14px;
    }
    .label-card {
      border: 2px dashed #475569;
      border-radius: 6px;
      padding: 12px;
      text-align: center;
      page-break-inside: avoid;
      break-inside: avoid;
      background: #ffffff;
    }
    .label-meta {
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      color: #475569;
      border-bottom: 1px dashed #e2e8f0;
      padding-bottom: 4px;
      margin-bottom: 8px;
      font-family: monospace;
    }
  </style>
</head>
<body>
  <div class="sheet-header">
    <strong>St. Augustine's Library Catalog — 7×11 in Cut-Out Barcode Sheet</strong>
    <span>${items.length} Label(s)</span>
  </div>
  <div class="labels-grid">
    ${cardsHtml}
  </div>
</body>
</html>`;

    try {
      const iframe = printIframeRef.current;
      if (iframe && iframe.contentWindow) {
        const doc = iframe.contentWindow.document;
        doc.open();
        doc.write(htmlDoc);
        doc.close();
        setTimeout(() => {
          try {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
          } catch {
            window.print();
          }
        }, 120);
        return;
      }
    } catch {
      // Fallback to window.print() if iframe access fails
    }

    try {
      window.print();
    } catch {
      // Ignore if blocked in headless test environment
    }
  }, []);

  /**
   * Opens the Printing Popup Screen for any print button in the Barcode tab
   * and immediately launches the browser's print dialog.
   */
  const openPrintingPopupScreen = (
    items: PrintableBarcodeItem[],
    popupHeading: string
  ) => {
    const validItems = items.length > 0 ? items : [currentPreviewItem];
    setPrintPopupItems(validItems);
    setPrintPopupTitle(popupHeading);
    setPrintStatusNotice(null);
    setTimeout(() => {
      executeSystemPrint(validItems);
    }, 80);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !author.trim()) {
      setFormError('Please enter both the Book Title and Author to generate a barcode.');
      return;
    }
    setFormError(null);
    setIsSubmitting(true);
    try {
      const created = await onCreateCustomIsbnBook({
        title: title.trim(),
        author: author.trim(),
        category: category.trim() || 'Patristic Archives',
        roomLocation: roomLocation.trim() || 'Patristic Hall · Room 101',
        publishedYear: publishedYear.trim() || '2024',
      });
      if (created) {
        setLastCreated(created);
        setTitle('');
        setAuthor('');
      }
    } catch (err: unknown) {
      setFormError(
        err instanceof Error ? err.message : 'Failed to generate custom ISBN'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownloadSvg = (
    isbnToExport: string,
    titleToExport: string,
    authorToExport: string
  ) => {
    const svgContent = `<?xml version="1.0" encoding="UTF-8"?>\n${buildBarcodeSvgMarkup(
      isbnToExport,
      titleToExport,
      authorToExport
    )}`;

    const blob = new Blob([svgContent], {
      type: 'image/svg+xml;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `isbn-barcode-${isbnToExport}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <section id="print-isbn-studio" className="space-y-6 sm:space-y-8">
      {/* Hidden dedicated 7x11 Print Iframe for reliable browser print dialog invocation */}
      <iframe
        ref={printIframeRef}
        title="7x11 Barcode Print Frame"
        className="hidden"
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 items-stretch no-print">
        {/* Left Column: Barcode Generator Form */}
        <div className="lg:col-span-7 rounded-lg border border-slate-200 bg-white p-4 sm:p-6 flex flex-col justify-between h-full">
          <div>
            <div className="border-b border-slate-200 pb-4">
              <h2 className="text-base sm:text-lg font-semibold text-slate-900">
                Barcode Generator (For Books Without ISBNs)
              </h2>
              <p className="mt-1 text-xs sm:text-sm text-slate-600">
                Enter the book&apos;s Title, Author, and Room Location to generate a scannable 13-digit EAN-13 barcode, preview it live on the right, and print it on 7×11 in paper.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="custom-book-title"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Book Title *
                  </label>
                  <input
                    id="custom-book-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., On Christian Doctrine"
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="custom-book-author"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Author / Editor *
                  </label>
                  <input
                    id="custom-book-author"
                    type="text"
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                    placeholder="e.g., St. Augustine"
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label
                    htmlFor="custom-book-category"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Collection / Subject
                  </label>
                  <input
                    id="custom-book-category"
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="e.g., Patristics"
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="custom-book-room"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Room Location
                  </label>
                  <input
                    id="custom-book-room"
                    type="text"
                    value={roomLocation}
                    onChange={(e) => setRoomLocation(e.target.value)}
                    placeholder="e.g., Patristic Hall · Room 101"
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="custom-book-year"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Publication Year
                  </label>
                  <input
                    id="custom-book-year"
                    type="text"
                    value={publishedYear}
                    onChange={(e) => setPublishedYear(e.target.value)}
                    placeholder="e.g., 1958"
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-mono tabular-nums text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              {formError && (
                <p role="alert" className="text-xs font-medium text-red-600">
                  {formError}
                </p>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                <div className="text-xs text-slate-500">
                  <span>Generated ISBN-13: </span>
                  <span className="font-mono tabular-nums font-semibold text-slate-900">
                    {formatIsbn13(previewIsbn)}
                  </span>
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                  <span>{isSubmitting ? 'Generating...' : 'Generate Barcode'}</span>
                </button>
              </div>
            </form>
          </div>

          {lastCreated && (
            <div className="mt-5 pt-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-emerald-700">
                  Barcode Generated &amp; Linked to Master Dataset
                </p>
                <p className="text-sm font-semibold text-slate-900 mt-0.5 break-words">
                  {lastCreated.title}
                </p>
                <p className="text-xs text-slate-600 break-words">
                  <span>{lastCreated.author}</span>
                  <span aria-hidden="true"> · </span>
                  <span>{lastCreated.roomLocation}</span>
                  <span aria-hidden="true"> · </span>
                  <span className="font-mono tabular-nums">
                    {lastCreated.formattedIsbn}
                  </span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    openPrintingPopupScreen(
                      [lastCreated],
                      `Print Barcode — ${lastCreated.title}`
                    )
                  }
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                >
                  <Printer className="h-3.5 w-3.5 shrink-0" />
                  <span>Print Generated Barcode</span>
                </button>
                <button
                  type="button"
                  onClick={() => onTestScanIsbn(lastCreated.isbn)}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <ScanLine className="h-3.5 w-3.5 shrink-0" />
                  <span>Verify in Catalog</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Live Barcode Preview + Direct Print Button */}
        <div className="lg:col-span-5 rounded-lg border border-slate-200 bg-white p-4 sm:p-6 flex flex-col items-center justify-between h-full">
          <div className="w-full flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Barcode Preview
            </h3>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              7×11 in Cut-Out Label
            </span>
          </div>

          <div className="my-auto w-full max-w-full p-3 sm:p-5 border-2 border-dashed border-slate-400 rounded-md bg-white flex flex-col items-center overflow-hidden">
            <div className="flex items-center gap-1 text-[10px] text-slate-500 mb-2 text-center">
              <Scissors className="h-3 w-3 shrink-0" />
              <span className="truncate max-w-[220px]">{previewRoom} · Cut &amp; Tape to Back</span>
            </div>
            <BarcodeSvg
              isbn={previewIsbn}
              title={previewTitle}
              author={previewAuthor}
            />
          </div>

          {/* Direct Print & Download Buttons on the Barcode Preview Card */}
          <div className="w-full mt-5 pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
            <button
              type="button"
              onClick={() =>
                handleDownloadSvg(previewIsbn, previewTitle, previewAuthor)
              }
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <Download className="h-3.5 w-3.5 shrink-0" />
              <span>Download SVG</span>
            </button>

            <button
              type="button"
              onClick={() =>
                openPrintingPopupScreen(
                  [currentPreviewItem],
                  `Print Barcode — ${previewTitle}`
                )
              }
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors"
            >
              <Printer className="h-3.5 w-3.5 shrink-0" />
              <span>Print Barcode</span>
            </button>
          </div>
        </div>
      </div>

      {/* Printable 7x11 in Paper Cut-Out Sheet Queue */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6 print-only-sheet">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-200 pb-4 no-print">
          <div>
            <h3 className="text-sm sm:text-base font-semibold text-slate-900">
              7×11 in Paper Cut-Out Barcode Sheet ({queuedBooks.length} labels queued)
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              Formatted for 7×11 inch paper with dashed scissor cut lines. Print, cut out, tape to the back of each book, and scan with your iPhone camera scanner.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {customBooks.length > 0 && (
              <button
                type="button"
                onClick={onAddAllCustomToQueue}
                className="w-full sm:w-auto rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Queue All Non-ISBN ({customBooks.length})
              </button>
            )}
            {queuedBooks.length > 0 && (
              <button
                type="button"
                onClick={onClearPrintQueue}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5 shrink-0" />
                <span>Clear Sheet</span>
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                openPrintingPopupScreen(
                  queuedBooks.length > 0 ? queuedBooks : [currentPreviewItem],
                  `7×11 in Paper Cut-Out Barcode Sheet (${
                    queuedBooks.length > 0 ? queuedBooks.length : 1
                  } Label${queuedBooks.length === 1 ? '' : 's'})`
                )
              }
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-slate-800 transition-colors"
            >
              <Printer className="h-3.5 w-3.5 shrink-0" />
              <span>Print 7×11 Cut-Out Sheet</span>
            </button>
          </div>
        </div>

        {queuedBooks.length === 0 ? (
          <div className="py-10 text-center no-print">
            <p className="text-sm text-slate-600">
              No barcode labels are currently queued on the 7×11 cut-out sheet.
            </p>
            <button
              type="button"
              onClick={onAddAllCustomToQueue}
              className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 transition-colors"
            >
              Load Non-ISBN Archive Books ({customBooks.length})
            </button>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            {queuedBooks.map((book) => (
              <div
                key={book.id}
                className="cutout-barcode-card border-2 border-dashed border-slate-400 rounded-md p-3.5 sm:p-4 flex flex-col items-center justify-between bg-white overflow-hidden"
              >
                <div className="w-full flex items-center justify-between text-[10px] text-slate-500 mb-2 pb-1 border-b border-dashed border-slate-200">
                  <span className="inline-flex items-center gap-1 truncate">
                    <Scissors className="h-3 w-3 shrink-0" />
                    <span className="truncate">{book.roomLocation} · Cut &amp; Tape</span>
                  </span>
                  <span className="font-mono tabular-nums shrink-0 ml-1">
                    {book.publishedYear}
                  </span>
                </div>
                <BarcodeSvg
                  isbn={book.isbn}
                  title={book.title}
                  author={book.author}
                />
                <div className="mt-3 pt-2.5 border-t border-slate-100 w-full flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 no-print">
                  <button
                    type="button"
                    onClick={() => onTestScanIsbn(book.isbn)}
                    className="inline-flex items-center gap-1 text-slate-700 hover:text-slate-950 font-medium"
                  >
                    <ScanLine className="h-3 w-3 shrink-0" />
                    <span>Verify in Catalog</span>
                  </button>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        openPrintingPopupScreen(
                          [book],
                          `Print Barcode — ${book.title}`
                        )
                      }
                      className="inline-flex items-center gap-1 font-semibold text-slate-900 hover:underline"
                    >
                      <Printer className="h-3 w-3 shrink-0" />
                      <span>Print</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleDownloadSvg(book.isbn, book.title, book.author)
                      }
                      className="text-slate-600 hover:text-slate-900"
                    >
                      SVG
                    </button>
                    <button
                      type="button"
                      onClick={() => onTogglePrintQueue(book.id)}
                      className="text-red-600 hover:text-red-800"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Dedicated Printing Popup Screen Modal */}
      {printPopupItems && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-4 no-print"
          role="dialog"
          aria-modal="true"
          aria-labelledby="printing-popup-title"
        >
          <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-lg border border-slate-200 bg-white shadow-xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3 px-4 sm:px-6 py-4 border-b border-slate-200 bg-slate-50">
              <div className="min-w-0">
                <h2
                  id="printing-popup-title"
                  className="text-sm sm:text-base font-semibold text-slate-900 break-words"
                >
                  {printPopupTitle || 'Print Barcode Sheet (7×11 in)'}
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Paper Size: 7 × 11 inches · {printPopupItems.length} Cut-Out Barcode Label(s) Ready for Printer
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPrintPopupItems(null)}
                aria-label="Close printing popup"
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Print Mode Selector & Status Notice */}
            <div className="px-4 sm:px-6 py-3 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-slate-600">Print Scope:</span>
                <button
                  type="button"
                  onClick={() => {
                    setPrintPopupItems([currentPreviewItem]);
                    setPrintPopupTitle(
                      `Print Barcode — ${currentPreviewItem.title}`
                    );
                  }}
                  className={`rounded px-2.5 py-1 font-medium transition-colors ${
                    printPopupItems.length === 1 &&
                    printPopupItems[0].isbn === currentPreviewItem.isbn
                      ? 'bg-slate-900 text-white'
                      : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Single Preview Barcode (1)
                </button>
                {queuedBooks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setPrintPopupItems(queuedBooks);
                      setPrintPopupTitle(
                        `7×11 in Paper Cut-Out Barcode Sheet (${queuedBooks.length} Labels)`
                      );
                    }}
                    className={`rounded px-2.5 py-1 font-medium transition-colors ${
                      printPopupItems.length === queuedBooks.length &&
                      queuedBooks.length > 1
                        ? 'bg-slate-900 text-white'
                        : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Full 7×11 Sheet ({queuedBooks.length} Queued)
                  </button>
                )}
              </div>

              {printStatusNotice && (
                <div className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  <span>{printStatusNotice}</span>
                </div>
              )}
            </div>

            {/* 7x11 Paper Sheet Visual Preview Area */}
            <div className="p-3 sm:p-6 overflow-y-auto bg-slate-100 flex-1">
              <div className="mx-auto max-w-[600px] rounded border border-slate-300 bg-white p-3 sm:p-6 shadow-xs">
                <div className="flex items-center justify-between text-[11px] text-slate-500 border-b border-slate-200 pb-2 mb-4 font-mono tabular-nums">
                  <span className="truncate">St. Augustine&apos;s Library — 7×11 in Sheet</span>
                  <span className="shrink-0 ml-2">{printPopupItems.length} Label(s)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {printPopupItems.map((item) => (
                    <div
                      key={item.id}
                      className="border-2 border-dashed border-slate-400 rounded-md p-3 flex flex-col items-center bg-white overflow-hidden"
                    >
                      <div className="w-full flex items-center justify-between text-[10px] text-slate-500 mb-2 pb-1 border-b border-dashed border-slate-200">
                        <span className="inline-flex items-center gap-1 truncate">
                          <Scissors className="h-3 w-3 shrink-0" />
                          <span className="truncate">{item.roomLocation}</span>
                        </span>
                        <span className="font-mono tabular-nums shrink-0 ml-1">
                          {item.publishedYear}
                        </span>
                      </div>
                      <BarcodeSvg
                        isbn={item.isbn}
                        title={item.title}
                        author={item.author}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Footer with Send to Printer Action */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 sm:px-6 py-3.5 border-t border-slate-200 bg-white">
              <button
                type="button"
                onClick={() => setPrintPopupItems(null)}
                className="rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Close Preview
              </button>

              <div className="flex flex-wrap items-center gap-2">
                {printPopupItems.length === 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      handleDownloadSvg(
                        printPopupItems[0].isbn,
                        printPopupItems[0].title,
                        printPopupItems[0].author
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <Download className="h-3.5 w-3.5 shrink-0" />
                    <span>Download SVG</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => executeSystemPrint(printPopupItems)}
                  className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors"
                >
                  <Printer className="h-4 w-4 shrink-0" />
                  <span>Send to Printer</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
