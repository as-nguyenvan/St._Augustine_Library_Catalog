import React, { useEffect, useState, useCallback } from 'react';
import { User } from 'firebase/auth';
import {
  BookRecord,
  binarySearchCatalog,
  isAuthorizedLibrarian,
  AUTHORIZED_LIBRARIAN_EMAIL,
} from './utils/isbn';
import {
  initAuth,
  googleSignIn,
  logout,
} from './services/auth';
import {
  SheetMetadata,
  fetchSpreadsheetMetadata,
  createLibrarySpreadsheet,
  appendBookToSpreadsheet,
  writeResolvedRowsToSpreadsheet,
} from './services/sheetsApi';
import { GoogleSignInButton } from './components/GoogleSignInButton';
import { BarcodeSvg } from './components/BarcodeSvg';
import { CustomIsbnStudio } from './components/CustomIsbnStudio';
import { SheetSyncPanel } from './components/SheetSyncPanel';
import {
  CameraBarcodeScanner,
  ScanDetectedResult,
} from './components/CameraBarcodeScanner';
import { ConfirmationModal } from './components/ConfirmationModal';
import {
  Search,
  Printer,
  Trash2,
  X,
  ArrowUpDown,
  BookOpen,
} from 'lucide-react';

interface PendingConfirmation {
  title: string;
  description: string;
  details?: string[];
  confirmLabel: string;
  isDestructive?: boolean;
  onConfirm: () => Promise<void>;
}

type ActiveAppTab = 'catalog' | 'spreadsheet_scanner' | 'barcode';

export default function App() {
  // Strictly separated tabs:
  // - 'catalog': Public Catalog Search
  // - 'spreadsheet_scanner': Spreadsheet & Scanner (Librarian Only)
  // - 'barcode': Barcode (Librarian Only)
  const [activeTab, setActiveTab] = useState<ActiveAppTab>('catalog');

  // Dataset state
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [isLoadingBooks, setIsLoadingBooks] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterMode, setFilterMode] = useState<'all' | 'custom_isbn'>('all');
  const [sortOrder, setSortOrder] = useState<'title' | 'newest'>('title');

  // Scanner processing state
  const [isScanning, setIsScanning] = useState<boolean>(false);

  // Barcode Print Queue & Modal Preview
  const [printQueueIds, setPrintQueueIds] = useState<string[]>([]);
  const [inspectedBarcodeBook, setInspectedBarcodeBook] =
    useState<BookRecord | null>(null);

  // Google Auth & Spreadsheet Sync state
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [sheetMeta, setSheetMeta] = useState<SheetMetadata | null>(null);
  const [selectedTab, setSelectedTab] = useState<string>('Catalog');
  const [isSyncingSheet, setIsSyncingSheet] = useState<boolean>(false);
  const [autoPollEnabled, setAutoPollEnabled] = useState<boolean>(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [unresolvedRawIsbns, setUnresolvedRawIsbns] = useState<
    Array<{ rowNumber: number; isbn: string; resolvedBook: BookRecord }>
  >([]);

  // Mandatory Confirmation Modal State for mutating/destructive operations
  const [pendingConfirm, setPendingConfirm] =
    useState<PendingConfirmation | null>(null);
  const [isConfirmBusy, setIsConfirmBusy] = useState<boolean>(false);

  // Only the signed-in librarian (alexanderngoc@gmail.com) can see the Spreadsheet & Scanner and Barcode tabs
  const isLibrarianAuthed = Boolean(user && isAuthorizedLibrarian(user.email));

  // Load book dataset from backend
  const fetchBooksFromServer = useCallback(async () => {
    try {
      const res = await fetch('/api/books');
      if (res.ok) {
        const data = await res.json();
        const loadedBooks: BookRecord[] = data.books || [];
        setBooks(loadedBooks);
        if (data.connectedSheet && !sheetMeta) {
          setSheetMeta({
            spreadsheetId: data.connectedSheet.spreadsheetId,
            title:
              data.connectedSheet.spreadsheetTitle || data.connectedSheet.title,
            spreadsheetUrl: data.connectedSheet.spreadsheetUrl,
            sheets: [data.connectedSheet.sheetTabName || 'Catalog'],
          });
          setSelectedTab(data.connectedSheet.sheetTabName || 'Catalog');
          setLastSyncedAt(data.connectedSheet.lastSyncedAt || null);
        }
        setPrintQueueIds((prev) =>
          prev.length === 0
            ? loadedBooks.filter((b) => b.isCustomIsbn).map((b) => b.id)
            : prev
        );
      }
    } catch (err) {
      console.error('Failed to load books:', err);
    } finally {
      setIsLoadingBooks(false);
    }
  }, [sheetMeta]);

  useEffect(() => {
    fetchBooksFromServer();
  }, [fetchBooksFromServer]);

  // Initialize Firebase Google Auth listener + non-UI automated test hook
  useEffect(() => {
    (
      window as unknown as {
        __TEST_SET_LIBRARIAN_SESSION__?: (email: string | null) => void;
      }
    ).__TEST_SET_LIBRARIAN_SESSION__ = (email: string | null) => {
      if (email) {
        setUser({ email, displayName: 'Librarian' } as User);
      } else {
        setUser(null);
        setAccessToken(null);
        setActiveTab('catalog');
      }
    };

    const unsubscribe = initAuth(
      (authedUser, token) => {
        setUser(authedUser);
        setAccessToken(token);
        if (!isAuthorizedLibrarian(authedUser.email)) {
          setActiveTab('catalog');
        }
      },
      () => {
        setUser(null);
        setAccessToken(null);
        setActiveTab('catalog');
      }
    );
    return () => unsubscribe();
  }, []);

  const handleGoogleSignIn = async () => {
    setSheetError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setAccessToken(result.accessToken);
        if (!isAuthorizedLibrarian(result.user.email)) {
          setActiveTab('catalog');
          setSheetError(
            `Signed in as ${result.user.email}. Only the authorized librarian (${AUTHORIZED_LIBRARIAN_EMAIL}) can access librarian tools.`
          );
        }
      }
    } catch (err: unknown) {
      setSheetError(
        err instanceof Error
          ? err.message
          : 'Google sign-in was cancelled or failed.'
      );
    }
  };

  const handleSignOut = async () => {
    await logout();
    setUser(null);
    setAccessToken(null);
    setAutoPollEnabled(false);
    setActiveTab('catalog');
    setSheetError(null);
  };

  // Sync rows from connected Google Spreadsheet or refresh local master dataset
  const handleSyncFromSheet = useCallback(async () => {
    if (!accessToken || !sheetMeta || !selectedTab) {
      await fetchBooksFromServer();
      setLastSyncedAt(new Date().toLocaleTimeString([], { hour12: false }));
      return;
    }
    setIsSyncingSheet(true);
    setSheetError(null);
    try {
      const res = await fetch('/api/sheets/sync-from-sheet', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          spreadsheetId: sheetMeta.spreadsheetId,
          sheetTabName: selectedTab,
          sheetTitle: sheetMeta.title,
          spreadsheetUrl: sheetMeta.spreadsheetUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to sync from Google Spreadsheet');
      }
      setBooks(data.books || []);
      setUnresolvedRawIsbns(data.unresolvedRawIsbns || []);
      const now = new Date();
      setLastSyncedAt(now.toLocaleTimeString([], { hour12: false }));
    } catch (err: unknown) {
      setSheetError(
        err instanceof Error ? err.message : 'Error syncing spreadsheet'
      );
    } finally {
      setIsSyncingSheet(false);
    }
  }, [accessToken, sheetMeta, selectedTab, fetchBooksFromServer]);

  // Live Auto-Sync polling every 8 seconds when enabled
  useEffect(() => {
    if (!autoPollEnabled) return;
    const timer = setInterval(() => {
      handleSyncFromSheet();
    }, 8000);
    return () => clearInterval(timer);
  }, [autoPollEnabled, handleSyncFromSheet]);

  const handleConnectSpreadsheet = async (spreadsheetId: string) => {
    if (!accessToken) {
      setSheetError('Please sign in with Google first.');
      return;
    }
    setIsSyncingSheet(true);
    setSheetError(null);
    try {
      const meta = await fetchSpreadsheetMetadata(spreadsheetId, accessToken);
      setSheetMeta(meta);
      const defaultTab = meta.sheets[0] || 'Catalog';
      setSelectedTab(defaultTab);

      const res = await fetch('/api/sheets/sync-from-sheet', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          spreadsheetId: meta.spreadsheetId,
          sheetTabName: defaultTab,
          sheetTitle: meta.title,
          spreadsheetUrl: meta.spreadsheetUrl,
        }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.books)) {
        setBooks(data.books);
        setUnresolvedRawIsbns(data.unresolvedRawIsbns || []);
        setLastSyncedAt(new Date().toLocaleTimeString([], { hour12: false }));
      }
    } catch (err: unknown) {
      setSheetError(
        err instanceof Error ? err.message : 'Could not connect spreadsheet'
      );
    } finally {
      setIsSyncingSheet(false);
    }
  };

  // Explicit user confirmation before creating & populating the Google Spreadsheet template
  const handleRequestCreateSpreadsheet = (sheetTitle: string) => {
    if (!accessToken) return;
    setPendingConfirm({
      title: "Create St. Augustine's Library Master Dataset Spreadsheet?",
      description: `This will create a new Google Spreadsheet named "${sheetTitle}" in your Google Drive with columns (ISBN, Title, Author, Category, Room Location, Year, Copies) and populate ${books.length} initial catalog row(s).`,
      details: books
        .slice(0, 5)
        .map(
          (b) =>
            `${b.formattedIsbn} — ${b.title} (${b.roomLocation} · Copies: ${b.copyCount || 1})`
        ),
      confirmLabel: 'Create Master Dataset Sheet',
      onConfirm: async () => {
        const createdMeta = await createLibrarySpreadsheet(
          sheetTitle,
          books,
          accessToken
        );
        setSheetMeta(createdMeta);
        const tab = createdMeta.sheets[0] || 'Catalog';
        setSelectedTab(tab);
        setLastSyncedAt(new Date().toLocaleTimeString([], { hour12: false }));
        await fetch('/api/sheets/register-connection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            spreadsheetId: createdMeta.spreadsheetId,
            title: createdMeta.title,
            spreadsheetUrl: createdMeta.spreadsheetUrl,
            sheetTabName: tab,
          }),
        });
      },
    });
  };

  // Explicit user confirmation before writing resolved ISBN metadata back into Google Sheets
  const handleRequestWriteBackResolved = () => {
    if (!accessToken || !sheetMeta || unresolvedRawIsbns.length === 0) return;
    setPendingConfirm({
      title: `Update ${unresolvedRawIsbns.length} Scanned ISBN Row(s) in Google Sheets?`,
      description: `This will write the resolved Book Title, Author, Category, Room Location, Year, and Copies into "${sheetMeta.title}" (${selectedTab}) for ${unresolvedRawIsbns.length} bare ISBN row(s).`,
      details: unresolvedRawIsbns.map(
        (u) =>
          `Row ${u.rowNumber}: ${u.resolvedBook.formattedIsbn} → ${u.resolvedBook.title} (${u.resolvedBook.roomLocation})`
      ),
      confirmLabel: 'Confirm Sheet Update',
      onConfirm: async () => {
        await writeResolvedRowsToSpreadsheet(
          sheetMeta.spreadsheetId,
          selectedTab,
          unresolvedRawIsbns,
          accessToken
        );
        setUnresolvedRawIsbns([]);
        setLastSyncedAt(new Date().toLocaleTimeString([], { hour12: false }));
      },
    });
  };

  // Explicit user confirmation before appending a scanned book to Google Sheets
  const handleRequestAppendBookToSheet = useCallback(
    (book: BookRecord) => {
      if (!accessToken || !sheetMeta) return;
      setPendingConfirm({
        title: 'Append Scanned Book to Master Google Spreadsheet?',
        description: `Confirm appending "${book.title}" by ${book.author} (${book.formattedIsbn}, Copies: ${book.copyCount || 1}) to "${sheetMeta.title}" [${selectedTab}].`,
        details: [
          `ISBN: ${book.formattedIsbn}`,
          `Title: ${book.title}`,
          `Room Location: ${book.roomLocation}`,
          `Copies: ${book.copyCount || 1}`,
        ],
        confirmLabel: 'Append to Sheet',
        onConfirm: async () => {
          await appendBookToSpreadsheet(
            sheetMeta.spreadsheetId,
            selectedTab,
            book,
            accessToken
          );
          setLastSyncedAt(new Date().toLocaleTimeString([], { hour12: false }));
        },
      });
    },
    [accessToken, sheetMeta, selectedTab]
  );

  // Handle scanning an ISBN from the In-Site iPhone Camera Scanner into the master dataset
  const handleCameraBarcodeDetected = useCallback(
    async (
      rawIsbnToScan: string,
      overrideTitle?: string,
      overrideAuthor?: string,
      overrideRoom?: string
    ): Promise<ScanDetectedResult | null> => {
      const trimmed = rawIsbnToScan.trim();
      if (!trimmed) return null;

      setIsScanning(true);
      try {
        const res = await fetch('/api/books/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            isbn: trimmed,
            title: overrideTitle?.trim() || undefined,
            author: overrideAuthor?.trim() || undefined,
            roomLocation: overrideRoom?.trim() || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to scan ISBN');
        }

        const addedBook: BookRecord = data.book;
        const incrementedCopy = Boolean(data.incrementedCopy);
        setBooks(data.books);
        setLastSyncedAt(new Date().toLocaleTimeString([], { hour12: false }));

        if (accessToken && sheetMeta) {
          handleRequestAppendBookToSheet(addedBook);
        }
        return { book: addedBook, incrementedCopy };
      } catch (err) {
        console.error('Camera scan error:', err);
        return null;
      } finally {
        setIsScanning(false);
      }
    },
    [accessToken, sheetMeta, handleRequestAppendBookToSheet]
  );

  // Create a custom ISBN for a book without a publisher ISBN
  const handleCreateCustomIsbnBook = async (payload: {
    title: string;
    author: string;
    category: string;
    roomLocation: string;
    publishedYear: string;
  }): Promise<BookRecord | null> => {
    const res = await fetch('/api/books/custom-isbn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to create custom ISBN');
    }
    const createdBook: BookRecord = data.book;
    setBooks(data.books);
    setPrintQueueIds((prev) =>
      prev.includes(createdBook.id) ? prev : [createdBook.id, ...prev]
    );

    if (accessToken && sheetMeta) {
      handleRequestAppendBookToSheet(createdBook);
    }
    return createdBook;
  };

  // Confirmed deletion of a book record
  const handleRequestDeleteBook = (book: BookRecord) => {
    setPendingConfirm({
      title: `Remove "${book.title}" from Catalog?`,
      description: `Are you sure you want to remove "${book.title}" by ${book.author} (ISBN ${book.formattedIsbn}) from the library dataset?`,
      details: [`${book.formattedIsbn} — ${book.title} (${book.roomLocation})`],
      confirmLabel: 'Delete Book',
      isDestructive: true,
      onConfirm: async () => {
        const res = await fetch(
          `/api/books/${encodeURIComponent(book.id)}`,
          { method: 'DELETE' }
        );
        if (res.ok) {
          const data = await res.json();
          setBooks(data.books);
          setPrintQueueIds((prev) => prev.filter((id) => id !== book.id));
        }
      },
    });
  };

  const handleTogglePrintQueue = (bookId: string) => {
    setPrintQueueIds((prev) =>
      prev.includes(bookId)
        ? prev.filter((id) => id !== bookId)
        : [...prev, bookId]
    );
  };

  const handleAddAllCustomToQueue = () => {
    const customIds = books.filter((b) => b.isCustomIsbn).map((b) => b.id);
    setPrintQueueIds((prev) => Array.from(new Set([...prev, ...customIds])));
  };

  const handleTestScanCustomIsbn = (isbn: string) => {
    setSearchQuery(isbn);
    setActiveTab('catalog');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const executeConfirmation = async () => {
    if (!pendingConfirm) return;
    setIsConfirmBusy(true);
    try {
      await pendingConfirm.onConfirm();
      setPendingConfirm(null);
    } catch (err: unknown) {
      setSheetError(
        err instanceof Error ? err.message : 'Operation failed'
      );
      setPendingConfirm(null);
    } finally {
      setIsConfirmBusy(false);
    }
  };

  // Ensure non-librarians always stay on the public catalog tab
  const currentTab: ActiveAppTab = isLibrarianAuthed ? activeTab : 'catalog';

  // Run O(log N) Binary Search system for keyword, roomLocation, & exact title lookup
  const binarySearchOutcome = binarySearchCatalog(
    books,
    searchQuery,
    isLibrarianAuthed ? filterMode : 'all'
  );
  const displayedBooks = [...binarySearchOutcome.results].sort((a, b) => {
    if (!searchQuery.trim() && sortOrder === 'title') {
      return a.title.localeCompare(b.title);
    }
    return 0;
  });

  const totalCount = books.length;
  const totalCopiesCount = books.reduce(
    (sum, b) => sum + (b.copyCount || 1),
    0
  );
  const customIsbnCount = books.filter((b) => b.isCustomIsbn).length;

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-slate-50 text-slate-900 flex flex-col">
      {/* Responsive Top Bar that fits iPhone width (375px+) without horizontal scrolling */}
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3.5 bg-white border-b border-slate-200 no-print">
        {/* Zone 1: Wordmark */}
        <a
          href="#catalog-top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('catalog');
          }}
          className="text-base sm:text-lg font-bold tracking-tight text-slate-900 font-display"
        >
          St. Augustine&apos;s Library Catalog
        </a>

        {/* Zone 3 on Mobile / Right Action: Librarian Sign In / Sign Out */}
        <div className="flex items-center gap-2 sm:order-3">
          {!user ? (
            <GoogleSignInButton
              onClick={handleGoogleSignIn}
              label="Librarian Sign In"
            />
          ) : (
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-md border border-slate-300 bg-white px-2.5 sm:px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Sign Out ({user.email?.split('@')[0] || 'Librarian'})
            </button>
          )}
        </div>

        {/* Zone 2: Navigation Tabs (Spreadsheet & Scanner and Barcode strictly hidden unless signed in as Librarian) */}
        <nav
          aria-label="Primary Navigation"
          className="w-full sm:w-auto sm:order-2 flex flex-wrap items-center gap-4 sm:gap-6 text-xs sm:text-sm font-medium text-slate-600 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100"
        >
          <button
            type="button"
            onClick={() => setActiveTab('catalog')}
            className={`hover:text-slate-900 transition-colors pb-1 sm:pb-0.5 ${
              currentTab === 'catalog'
                ? 'text-slate-900 font-semibold border-b-2 border-slate-900'
                : ''
            }`}
          >
            Catalog Search
          </button>

          {isLibrarianAuthed && (
            <>
              <button
                type="button"
                onClick={() => setActiveTab('spreadsheet_scanner')}
                className={`hover:text-slate-900 transition-colors pb-1 sm:pb-0.5 ${
                  currentTab === 'spreadsheet_scanner'
                    ? 'text-slate-900 font-semibold border-b-2 border-slate-900'
                    : ''
                }`}
              >
                Spreadsheet &amp; Scanner
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('barcode')}
                className={`hover:text-slate-900 transition-colors pb-1 sm:pb-0.5 ${
                  currentTab === 'barcode'
                    ? 'text-slate-900 font-semibold border-b-2 border-slate-900'
                    : ''
                }`}
              >
                Barcode
              </button>
            </>
          )}
        </nav>
      </header>

      <main
        id="catalog-top"
        className="mx-auto w-full max-w-[1280px] flex-1 px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8"
      >
        {/* TAB 0: PUBLIC CATALOG SEARCH VIEW ONLY */}
        {currentTab === 'catalog' && (
          <>
            <section id="catalog-search" className="space-y-4 no-print">
              {sheetError && (
                <div
                  role="alert"
                  className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 break-words"
                >
                  {sheetError}
                </div>
              )}

              {/* Primary Search Bar */}
              <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
                <div className="relative flex-1">
                  <label htmlFor="library-search-input" className="sr-only">
                    Search St. Augustine&apos;s Library Catalog by title keywords, author, room location, or ISBN
                  </label>
                  <Search
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    id="library-search-input"
                    type="text"
                    role="searchbox"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by book title, keywords, author, room location, or ISBN..."
                    className="w-full rounded-lg border border-slate-300 bg-white pl-10 pr-10 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none shadow-2xs"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      aria-label="Clear search query"
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {isLibrarianAuthed && (
                  <div
                    role="group"
                    aria-label="Filter catalog by barcode type"
                    className="grid grid-cols-2 sm:flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg"
                  >
                    <button
                      type="button"
                      onClick={() => setFilterMode('all')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors text-center ${
                        filterMode === 'all'
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      All Books ({totalCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterMode('custom_isbn')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors text-center ${
                        filterMode === 'custom_isbn'
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      7×11 Barcodes ({customIsbnCount})
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* Library Catalog Lookup Table (Mobile-fitted cards on small screens, full table on md+) */}
            <section
              aria-label="Library Books Dataset"
              className="rounded-lg border border-slate-200 bg-white overflow-hidden no-print"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-3.5 border-b border-slate-200 bg-slate-50/60">
                <div className="text-xs font-medium text-slate-600">
                  Showing{' '}
                  <span className="font-mono tabular-nums font-semibold text-slate-900">
                    {displayedBooks.length}
                  </span>{' '}
                  of{' '}
                  <span className="font-mono tabular-nums font-semibold text-slate-900">
                    {totalCount}
                  </span>{' '}
                  titles ({totalCopiesCount} copies)
                  {binarySearchOutcome.exactTitleMatch && (
                    <span className="ml-2 text-emerald-700 font-medium">
                      · Exact Title Match Found
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setSortOrder((prev) =>
                      prev === 'title' ? 'newest' : 'title'
                    )
                  }
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
                >
                  <ArrowUpDown className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Sort: {sortOrder === 'title' ? 'Title (A–Z)' : 'Recently Added'}
                  </span>
                </button>
              </div>

              {isLoadingBooks ? (
                <div className="p-4 sm:p-6 space-y-3">
                  {[1, 2, 3, 4].map((row) => (
                    <div
                      key={row}
                      className="h-10 w-full rounded bg-slate-100 animate-pulse"
                    />
                  ))}
                </div>
              ) : displayedBooks.length === 0 ? (
                <div className="py-12 px-4 sm:px-6 text-center" role="status">
                  <BookOpen className="h-6 w-6 text-slate-400 mx-auto mb-2" />
                  <p className="text-base font-semibold text-slate-900 break-words">
                    &ldquo;{searchQuery.trim()}&rdquo; does not exist within the catalog.
                  </p>
                  <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
                    Our binary search checked all {totalCount} book records in St. Augustine&apos;s Library spreadsheet dataset and found no matching title, keyword, author, room location, or ISBN.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setFilterMode('all');
                    }}
                    className="mt-4 rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 transition-colors"
                  >
                    Show All Catalog Books
                  </button>
                </div>
              ) : (
                <>
                  {/* Mobile View (< md): Stacked rows that fit 100% inside iPhone screen width with zero horizontal scrolling */}
                  <div className="md:hidden divide-y divide-slate-200">
                    {displayedBooks.map((book) => {
                      const isQueued = printQueueIds.includes(book.id);
                      return (
                        <div key={book.id} className="p-4 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-semibold text-sm text-slate-900 break-words">
                                {book.title}
                              </div>
                              <div className="text-xs text-slate-600 break-words">
                                {book.author}
                              </div>
                            </div>
                            <span className="font-mono tabular-nums text-xs font-semibold text-slate-800 shrink-0">
                              Copies: {book.copyCount || 1}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                            <button
                              type="button"
                              onClick={() => setInspectedBarcodeBook(book)}
                              className="font-mono tabular-nums text-xs font-medium text-slate-800 underline decoration-slate-300 underline-offset-4"
                            >
                              {book.formattedIsbn}
                            </button>
                            <span aria-hidden="true">·</span>
                            <span>{book.roomLocation}</span>
                            <span aria-hidden="true">·</span>
                            <span>{book.category}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {book.publishedYear}
                            </span>
                          </div>

                          {isLibrarianAuthed && (
                            <div className="pt-1 flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => handleTogglePrintQueue(book.id)}
                                className={`inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs font-medium transition-colors ${
                                  isQueued
                                    ? 'border-slate-900 bg-slate-900 text-white'
                                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                <Printer className="h-3 w-3 shrink-0" />
                                <span>
                                  {isQueued ? 'On 7×11 Sheet' : 'Queue Label'}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRequestDeleteBook(book)}
                                aria-label={`Delete ${book.title}`}
                                className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Desktop View (md+): Full multi-column table */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500 bg-slate-50/40">
                          <th className="py-3 pl-6 pr-3">ISBN-13 Barcode</th>
                          <th className="py-3 px-3">Book Title</th>
                          <th className="py-3 px-3">Author</th>
                          <th className="py-3 px-3">Collection / Category</th>
                          <th className="py-3 px-3">Room Location</th>
                          <th className="py-3 px-3 text-right">Copies</th>
                          <th className="py-3 pl-3 pr-6 text-right">Year</th>
                          {isLibrarianAuthed && (
                            <th className="py-3 pl-3 pr-6 text-right">Actions</th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-sm">
                        {displayedBooks.map((book) => {
                          const isQueued = printQueueIds.includes(book.id);
                          return (
                            <tr
                              key={book.id}
                              className="hover:bg-slate-50/80 transition-colors"
                            >
                              <td className="py-3 pl-6 pr-3 align-middle whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => setInspectedBarcodeBook(book)}
                                  title="View scannable EAN-13 barcode"
                                  className="font-mono tabular-nums text-xs font-medium text-slate-800 hover:text-slate-950 underline decoration-slate-300 underline-offset-4"
                                >
                                  {book.formattedIsbn}
                                </button>
                              </td>
                              <td className="py-3 px-3 align-middle font-semibold text-slate-900">
                                {book.title}
                              </td>
                              <td className="py-3 px-3 align-middle text-slate-700">
                                {book.author}
                              </td>
                              <td className="py-3 px-3 align-middle">
                                <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                                  <span>{book.category}</span>
                                </div>
                              </td>
                              <td className="py-3 px-3 align-middle text-xs font-medium text-slate-700">
                                {book.roomLocation}
                              </td>
                              <td className="py-3 px-3 align-middle text-right font-mono tabular-nums text-xs font-semibold text-slate-800">
                                {book.copyCount || 1}
                              </td>
                              <td className="py-3 pl-3 pr-6 align-middle text-right font-mono tabular-nums text-xs text-slate-600">
                                {book.publishedYear}
                              </td>
                              {isLibrarianAuthed && (
                                <td className="py-3 pl-3 pr-6 align-middle text-right whitespace-nowrap">
                                  <div className="inline-flex items-center justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleTogglePrintQueue(book.id)}
                                      className={`inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs font-medium transition-colors ${
                                        isQueued
                                          ? 'border-slate-900 bg-slate-900 text-white'
                                          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                                      }`}
                                    >
                                      <Printer className="h-3 w-3" />
                                      <span>
                                        {isQueued ? 'On 7×11 Sheet' : 'Queue Label'}
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleRequestDeleteBook(book)}
                                      aria-label={`Delete ${book.title}`}
                                      className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          </>
        )}

        {/* LIBRARIAN TAB: SPREADSHEET & SCANNER (Strictly visible only when signed in as Librarian) */}
        {isLibrarianAuthed && currentTab === 'spreadsheet_scanner' && (
          <div className="space-y-6 sm:space-y-8 no-print">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-b border-slate-200 pb-4">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 font-display">
                  Spreadsheet &amp; Scanner
                </h1>
                <p className="mt-1 text-xs sm:text-sm text-slate-600">
                  Access the Master Dataset Google Sheet, enable Live Auto-Sync, and open your iPhone&apos;s camera system to scan ISBN barcodes live into the catalog.
                </p>
              </div>
              <div className="text-xs font-mono tabular-nums text-slate-600">
                <span>{totalCount} Titles ({totalCopiesCount} Copies)</span>
                <span aria-hidden="true"> · </span>
                <span>
                  {autoPollEnabled ? 'Live Auto-Sync: ON' : 'Live Auto-Sync: OFF'}
                </span>
              </div>
            </div>

            {/* Option 1: Access Master Dataset Sheet & Enable Live Auto-Sync */}
            <SheetSyncPanel
              user={user}
              accessToken={accessToken}
              books={books}
              sheetMeta={sheetMeta}
              selectedTab={selectedTab}
              isSyncing={isSyncingSheet}
              autoPollEnabled={autoPollEnabled}
              lastSyncedAt={lastSyncedAt}
              unresolvedRawCount={unresolvedRawIsbns.length}
              sheetError={sheetError}
              onSignIn={handleGoogleSignIn}
              onConnectSpreadsheet={handleConnectSpreadsheet}
              onSelectTab={setSelectedTab}
              onRequestCreateSpreadsheet={handleRequestCreateSpreadsheet}
              onSyncFromSheet={handleSyncFromSheet}
              onToggleAutoPoll={() => setAutoPollEnabled((prev) => !prev)}
              onRequestWriteBackResolved={handleRequestWriteBackResolved}
            />

            {/* Option 2: Open Local Device (iPhone) Camera System to Scan ISBNs */}
            <CameraBarcodeScanner
              onBarcodeDetected={handleCameraBarcodeDetected}
              isProcessingScan={isScanning}
            />
          </div>
        )}

        {/* LIBRARIAN TAB: BARCODE (Strictly visible only when signed in as Librarian) */}
        {isLibrarianAuthed && currentTab === 'barcode' && (
          <div className="space-y-6 sm:space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-b border-slate-200 pb-4 no-print">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 font-display">
                  Barcode
                </h1>
                <p className="mt-1 text-xs sm:text-sm text-slate-600">
                  Generate a custom 13-digit ISBN barcode for books without publisher ISBNs, preview the label, and print it on 7×11 inch paper.
                </p>
              </div>
              <div className="text-xs font-mono tabular-nums text-slate-600">
                <span>{customIsbnCount} Custom Barcodes Registered</span>
                <span aria-hidden="true"> · </span>
                <span>{printQueueIds.length} Queued to Print</span>
              </div>
            </div>

            <CustomIsbnStudio
              books={books}
              printQueueIds={printQueueIds}
              onCreateCustomIsbnBook={handleCreateCustomIsbnBook}
              onTogglePrintQueue={handleTogglePrintQueue}
              onAddAllCustomToQueue={handleAddAllCustomToQueue}
              onClearPrintQueue={() => setPrintQueueIds([])}
              onTestScanIsbn={handleTestScanCustomIsbn}
            />
          </div>
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white py-5 px-4 sm:px-6 text-xs text-slate-500 no-print">
        <div className="mx-auto max-w-[1280px] flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>St. Augustine&apos;s Library Catalog</span>
          <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-5">
            <button
              type="button"
              onClick={() => setActiveTab('catalog')}
              className="hover:text-slate-900"
            >
              Catalog Search
            </button>
            {isLibrarianAuthed && (
              <>
                <button
                  type="button"
                  onClick={() => setActiveTab('spreadsheet_scanner')}
                  className="hover:text-slate-900"
                >
                  Spreadsheet &amp; Scanner
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('barcode')}
                  className="hover:text-slate-900"
                >
                  Barcode
                </button>
              </>
            )}
          </div>
        </div>
      </footer>

      {/* Modal for inspecting an individual book's scannable EAN-13 barcode */}
      {inspectedBarcodeBook && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50 p-4 no-print"
          role="dialog"
          aria-modal="true"
          aria-label={`Barcode for ${inspectedBarcodeBook.title}`}
        >
          <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 sm:p-6 shadow-lg flex flex-col items-center">
            <div className="w-full flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
              <span className="text-xs font-semibold text-slate-900">
                {inspectedBarcodeBook.isCustomIsbn
                  ? '7×11 Cut-Out Barcode'
                  : 'Publisher ISBN-13 Barcode'}
              </span>
              <button
                type="button"
                onClick={() => setInspectedBarcodeBook(null)}
                aria-label="Close barcode preview"
                className="rounded p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <BarcodeSvg
              isbn={inspectedBarcodeBook.isbn}
              title={inspectedBarcodeBook.title}
              author={inspectedBarcodeBook.author}
            />
            <p className="mt-3 text-xs text-slate-500 text-center break-words">
              <span>{inspectedBarcodeBook.roomLocation}</span>
              <span aria-hidden="true"> · </span>
              <span>Copies: {inspectedBarcodeBook.copyCount || 1}</span>
              <span aria-hidden="true"> · </span>
              <span className="font-mono tabular-nums">
                {inspectedBarcodeBook.formattedIsbn}
              </span>
            </p>
          </div>
        </div>
      )}

      {/* Mandatory Confirmation Modal for mutating Google Sheets / destructive actions */}
      <ConfirmationModal
        isOpen={Boolean(pendingConfirm)}
        title={pendingConfirm?.title || ''}
        description={pendingConfirm?.description || ''}
        details={pendingConfirm?.details}
        confirmLabel={pendingConfirm?.confirmLabel || 'Confirm'}
        isDestructive={pendingConfirm?.isDestructive}
        isBusy={isConfirmBusy}
        onConfirm={executeConfirmation}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
}
