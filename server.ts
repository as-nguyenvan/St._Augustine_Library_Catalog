import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  BookRecord,
  cleanIsbn,
  computeEan13CheckDigit,
  formatIsbn13,
  generateCustomIsbn13,
  isbn10ToIsbn13,
  isValidIsbn13,
  upsertScannedBook,
} from './src/utils/isbn';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Local zero-cost persistent JSON file cache so catalog updates survive restarts with $0 database cost
const DATA_DIR = path.join(__dirname, 'data');
const CATALOG_CACHE_FILE = path.join(DATA_DIR, 'catalog-cache.json');

// Built-in fast lookup catalog for common ISBNs + fallback when offline
const KNOWN_ISBN_CATALOG: Record<
  string,
  {
    title: string;
    author: string;
    category: string;
    roomLocation: string;
    publishedYear: string;
  }
> = {
  '9780441172719': {
    title: 'Dune',
    author: 'Frank Herbert',
    category: 'Science Fiction',
    roomLocation: 'Main Reading Room · Shelf B3',
    publishedYear: '1965',
  },
  '9780140449136': {
    title: 'The Odyssey',
    author: 'Homer (Trans. Robert Fagles)',
    category: 'Classic Literature',
    roomLocation: 'Room 102 · Classical Wing',
    publishedYear: '1996',
  },
  '9780451524935': {
    title: '1984',
    author: 'George Orwell',
    category: 'Literary Fiction',
    roomLocation: 'Main Reading Room · Shelf A1',
    publishedYear: '1949',
  },
  '9780061120084': {
    title: 'To Kill a Mockingbird',
    author: 'Harper Lee',
    category: 'Classic Literature',
    roomLocation: 'Room 102 · Classical Wing',
    publishedYear: '1960',
  },
  '9780743273565': {
    title: 'The Great Gatsby',
    author: 'F. Scott Fitzgerald',
    category: 'Classic Literature',
    roomLocation: 'Room 102 · Classical Wing',
    publishedYear: '1925',
  },
  '9780132350884': {
    title: 'Clean Code: A Handbook of Agile Software Craftsmanship',
    author: 'Robert C. Martin',
    category: 'Computer Science',
    roomLocation: 'Room 205 · Reference Study',
    publishedYear: '2008',
  },
  '9780547928227': {
    title: 'The Hobbit',
    author: 'J.R.R. Tolkien',
    category: 'Fantasy',
    roomLocation: 'Main Reading Room · Shelf C2',
    publishedYear: '1937',
  },
  '9780062316097': {
    title: 'Sapiens: A Brief History of Humankind',
    author: 'Yuval Noah Harari',
    category: 'History & Anthropology',
    roomLocation: 'Room 104 · History Alcove',
    publishedYear: '2015',
  },
  '9780262033848': {
    title: 'Introduction to Algorithms (CLRS)',
    author: 'Thomas H. Cormen, Charles E. Leiserson',
    category: 'Computer Science',
    roomLocation: 'Room 205 · Reference Study',
    publishedYear: '2009',
  },
  '9780140448955': {
    title: 'Confessions',
    author: 'St. Augustine (Trans. R.S. Pine-Coffin)',
    category: 'Theology & Patristics',
    roomLocation: 'Patristic Hall · Room 101',
    publishedYear: '1961',
  },
  '9780140448948': {
    title: 'City of God',
    author: 'St. Augustine (Trans. Henry Bettenson)',
    category: 'Theology & Philosophy',
    roomLocation: 'Patristic Hall · Room 101',
    publishedYear: '2003',
  },
};

// In-memory cache of resolved ISBN metadata so OpenLibrary is queried at most once per unique ISBN
const isbnMetadataCache = new Map<
  string,
  {
    title: string;
    author: string;
    category: string;
    roomLocation: string;
    publishedYear: string;
    isCustomIsbn: boolean;
  }
>();

// Registry mapping custom generated ISBN-13s (for books without publisher ISBNs) to their Title, Author & Room Location
const customIsbnRegistry = new Map<
  string,
  {
    title: string;
    author: string;
    category: string;
    roomLocation: string;
    publishedYear: string;
  }
>();

const seedNonIsbnBooks = [
  {
    title: 'St. Augustine Parish Homilies & Letters (Unindexed Folio)',
    author: 'Augustine of Hippo',
    category: 'Patristic Archives',
    roomLocation: 'Patristic Hall · Archive Case 1',
    publishedYear: '1928',
  },
  {
    title: 'Early Christian Liturgical Hymnal Vol. II',
    author: 'Dr. Clara Hawthorne',
    category: 'Rare Manuscripts',
    roomLocation: 'Choir Loft Archive · Room 202',
    publishedYear: '1914',
  },
];

const initialBooks: BookRecord[] = [
  {
    id: 'bk-100',
    isbn: '9780140448955',
    formattedIsbn: formatIsbn13('9780140448955'),
    title: 'Confessions',
    author: 'St. Augustine (Trans. R.S. Pine-Coffin)',
    category: 'Theology & Patristics',
    roomLocation: 'Patristic Hall · Room 101',
    publishedYear: '1961',
    copyCount: 1,
    isCustomIsbn: false,
    addedAt: '2026-10-27 09:00',
  },
  {
    id: 'bk-101',
    isbn: '9780140448948',
    formattedIsbn: formatIsbn13('9780140448948'),
    title: 'City of God',
    author: 'St. Augustine (Trans. Henry Bettenson)',
    category: 'Theology & Philosophy',
    roomLocation: 'Patristic Hall · Room 101',
    publishedYear: '2003',
    copyCount: 1,
    isCustomIsbn: false,
    addedAt: '2026-10-28 09:15',
  },
  {
    id: 'bk-102',
    isbn: '9780441172719',
    formattedIsbn: formatIsbn13('9780441172719'),
    title: 'Dune',
    author: 'Frank Herbert',
    category: 'Science Fiction',
    roomLocation: 'Main Reading Room · Shelf B3',
    publishedYear: '1965',
    copyCount: 1,
    isCustomIsbn: false,
    addedAt: '2026-10-29 14:20',
  },
  {
    id: 'bk-103',
    isbn: '9780132350884',
    formattedIsbn: formatIsbn13('9780132350884'),
    title: 'Clean Code: A Handbook of Agile Software Craftsmanship',
    author: 'Robert C. Martin',
    category: 'Computer Science',
    roomLocation: 'Room 205 · Reference Study',
    publishedYear: '2008',
    copyCount: 1,
    isCustomIsbn: false,
    addedAt: '2026-10-30 11:05',
  },
  {
    id: 'bk-104',
    isbn: '9780451524935',
    formattedIsbn: formatIsbn13('9780451524935'),
    title: '1984',
    author: 'George Orwell',
    category: 'Literary Fiction',
    roomLocation: 'Main Reading Room · Shelf A1',
    publishedYear: '1949',
    copyCount: 1,
    isCustomIsbn: false,
    addedAt: '2026-10-31 16:40',
  },
  {
    id: 'bk-105',
    isbn: '9780743273565',
    formattedIsbn: formatIsbn13('9780743273565'),
    title: 'The Great Gatsby',
    author: 'F. Scott Fitzgerald',
    category: 'Classic Literature',
    roomLocation: 'Room 102 · Classical Wing',
    publishedYear: '1925',
    copyCount: 1,
    isCustomIsbn: false,
    addedAt: '2026-11-01 08:30',
  },
];

for (let i = 0; i < seedNonIsbnBooks.length; i++) {
  const item = seedNonIsbnBooks[i];
  const customIsbn = generateCustomIsbn13(item.title, item.author);
  customIsbnRegistry.set(customIsbn, {
    title: item.title,
    author: item.author,
    category: item.category,
    roomLocation: item.roomLocation,
    publishedYear: item.publishedYear,
  });
  initialBooks.push({
    id: `bk-custom-${i + 1}`,
    isbn: customIsbn,
    formattedIsbn: formatIsbn13(customIsbn),
    title: item.title,
    author: item.author,
    category: item.category,
    roomLocation: item.roomLocation,
    publishedYear: item.publishedYear,
    copyCount: 1,
    isCustomIsbn: true,
    addedAt: '2026-11-01 10:00',
  });
}

// Live in-memory book list that mirrors the connected Google Spreadsheet dataset
let booksList: BookRecord[] = [...initialBooks];
let connectedSheetInfo: {
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
  sheetTabName: string;
  lastSyncedAt: string;
} | null = null;

function loadPersistedCatalogCache() {
  try {
    if (fs.existsSync(CATALOG_CACHE_FILE)) {
      const raw = fs.readFileSync(CATALOG_CACHE_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.books) && parsed.books.length > 0) {
        booksList = parsed.books;
      }
      if (parsed.connectedSheet) {
        connectedSheetInfo = parsed.connectedSheet;
      }
    }
  } catch {
    // Use default initialBooks if cache file doesn't exist yet
  }
}

function savePersistedCatalogCache() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(
      CATALOG_CACHE_FILE,
      JSON.stringify(
        {
          books: booksList,
          connectedSheet: connectedSheetInfo,
        },
        null,
        2
      ),
      'utf-8'
    );
  } catch {
    // Ignore write errors in read-only environments
  }
}

loadPersistedCatalogCache();

/**
 * Reads Firebase Auth configuration strictly on the server so firebase-applet-config.json
 * is never imported into client code or publicly downloadable as a static file.
 */
function getServerSideAuthConfig() {
  try {
    const configPath = path.join(__dirname, 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return {
        apiKey: process.env.FIREBASE_API_KEY || parsed.apiKey || '',
        authDomain: process.env.FIREBASE_AUTH_DOMAIN || parsed.authDomain || '',
        projectId: process.env.FIREBASE_PROJECT_ID || parsed.projectId || '',
        appId: process.env.FIREBASE_APP_ID || parsed.appId || '',
      };
    }
  } catch {
    // Fallback to environment variables
  }
  return {
    apiKey: process.env.FIREBASE_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    appId: process.env.FIREBASE_APP_ID || '',
  };
}

function normalizeScannedIsbn(rawInput: string): string {
  const cleaned = cleanIsbn(rawInput);
  if (cleaned.length === 10) {
    const converted = isbn10ToIsbn13(cleaned);
    if (converted) return converted;
  }
  if (cleaned.length === 12 && /^\d{12}$/.test(cleaned)) {
    return cleaned + computeEan13CheckDigit(cleaned);
  }
  if (cleaned.length === 13 && /^\d{13}$/.test(cleaned)) {
    return cleaned;
  }
  const digitsOnly = cleaned.replace(/\D/g, '');
  if (digitsOnly.length >= 6) {
    const base12 = ('978' + digitsOnly).slice(0, 12).padEnd(12, '0');
    return base12 + computeEan13CheckDigit(base12);
  }
  return cleaned;
}

async function resolveIsbnMetadata(isbn13: string): Promise<{
  title: string;
  author: string;
  category: string;
  roomLocation: string;
  publishedYear: string;
  isCustomIsbn: boolean;
}> {
  // 1. Check custom ISBN registry first (for books with 7x11 cut-out barcodes taped to the back)
  const customHit = customIsbnRegistry.get(isbn13);
  if (customHit) {
    return { ...customHit, isCustomIsbn: true };
  }

  // 2. Check existing catalog list
  const existingBook = booksList.find((b) => cleanIsbn(b.isbn) === isbn13);
  if (existingBook) {
    return {
      title: existingBook.title,
      author: existingBook.author,
      category: existingBook.category,
      roomLocation: existingBook.roomLocation,
      publishedYear: existingBook.publishedYear,
      isCustomIsbn: existingBook.isCustomIsbn,
    };
  }

  // 3. Check fast local dictionary
  if (KNOWN_ISBN_CATALOG[isbn13]) {
    return { ...KNOWN_ISBN_CATALOG[isbn13], isCustomIsbn: false };
  }

  // 4. Check in-memory resolved ISBN cache
  const cachedMeta = isbnMetadataCache.get(isbn13);
  if (cachedMeta) {
    return cachedMeta;
  }

  // 5. Query free OpenLibrary API with a 3.5s timeout
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(
      `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(
        isbn13
      )}&format=json&jscmd=data`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const entry = data[`ISBN:${isbn13}`];
      if (entry && entry.title) {
        const authorNames = Array.isArray(entry.authors)
          ? entry.authors.map((a: { name?: string }) => a.name).filter(Boolean).join(', ')
          : 'Unknown Author';
        const subjectName =
          Array.isArray(entry.subjects) && entry.subjects.length > 0
            ? entry.subjects[0].name || 'General Collection'
            : 'General Collection';
        const yearMatch = String(entry.publish_date || '').match(/\b(18|19|20)\d{2}\b/);
        const resolvedObj = {
          title: String(entry.title),
          author: authorNames || 'Unknown Author',
          category: String(subjectName).slice(0, 36),
          roomLocation: 'Main Reading Room',
          publishedYear: yearMatch ? yearMatch[0] : '2024',
          isCustomIsbn: isbn13.startsWith('979000'),
        };
        isbnMetadataCache.set(isbn13, resolvedObj);
        return resolvedObj;
      }
    }
  } catch {
    // Fall back gracefully if offline or blocked
  }

  const fallbackObj = {
    title: `Cataloged Volume (${formatIsbn13(isbn13)})`,
    author: 'Library Acquisition',
    category: isbn13.startsWith('979000') ? 'Custom Barcode' : 'General Collection',
    roomLocation: 'Main Reading Room',
    publishedYear: new Date().getFullYear().toString(),
    isCustomIsbn: isbn13.startsWith('979000'),
  };
  isbnMetadataCache.set(isbn13, fallbackObj);
  return fallbackObj;
}

function nowTimestamp(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '256kb' }));

  // Block any public HTTP access to sensitive configuration or backend files
  app.use((req, res, next) => {
    const lowerPath = req.path.toLowerCase();
    if (
      lowerPath.includes('firebase-applet-config.json') ||
      lowerPath.includes('firebase-blueprint.json') ||
      lowerPath.includes('firestore.rules') ||
      lowerPath.startsWith('/.env') ||
      lowerPath.startsWith('/data/')
    ) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    next();
  });

  // POST /api/auth/session-config - Provides auth configuration on-demand when Librarian clicks Sign In
  app.post('/api/auth/session-config', (req, res) => {
    if (req.headers['x-requested-with'] !== 'LibrarianAuth') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json(getServerSideAuthConfig());
  });

  // GET /api/books - Serves the live dataset from in-memory cache (0 external API calls, $0 cost regardless of traffic)
  app.get('/api/books', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.json({
      books: booksList,
      connectedSheet: connectedSheetInfo,
    });
  });

  // GET /api/isbn/:isbn - Lookup metadata for a scanned ISBN
  app.get('/api/isbn/:isbn', async (req, res) => {
    const normalized = normalizeScannedIsbn(req.params.isbn || '');
    if (!normalized || normalized.length < 10) {
      res.status(400).json({ error: 'Please provide a valid 10 or 13 digit ISBN.' });
      return;
    }
    const meta = await resolveIsbnMetadata(normalized);
    res.json({
      isbn: normalized,
      formattedIsbn: formatIsbn13(normalized),
      validCheckDigit: isValidIsbn13(normalized),
      ...meta,
    });
  });

  // POST /api/books/scan - Append a scanned ISBN book or increment copyCount if ISBN already exists
  app.post('/api/books/scan', async (req, res) => {
    const { isbn, title, author, category, roomLocation, publishedYear } = req.body || {};
    if (!isbn || String(isbn).trim().length < 6) {
      res.status(400).json({ error: 'Please enter or scan a valid ISBN barcode.' });
      return;
    }

    const normalized = normalizeScannedIsbn(String(isbn));
    const resolved = await resolveIsbnMetadata(normalized);

    const finalTitle = (title && String(title).trim()) || resolved.title;
    const finalAuthor = (author && String(author).trim()) || resolved.author;
    const finalCategory = (category && String(category).trim()) || resolved.category;
    const finalRoom = (roomLocation && String(roomLocation).trim()) || resolved.roomLocation;
    const finalYear = (publishedYear && String(publishedYear).trim()) || resolved.publishedYear;
    const isCustom = resolved.isCustomIsbn || normalized.startsWith('979000');

    if (isCustom) {
      customIsbnRegistry.set(normalized, {
        title: finalTitle,
        author: finalAuthor,
        category: finalCategory,
        roomLocation: finalRoom,
        publishedYear: finalYear,
      });
    }

    const candidateBook: BookRecord = {
      id: `bk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      isbn: normalized,
      formattedIsbn: formatIsbn13(normalized),
      title: finalTitle,
      author: finalAuthor,
      category: finalCategory,
      roomLocation: finalRoom,
      publishedYear: finalYear,
      copyCount: 1,
      isCustomIsbn: isCustom,
      addedAt: nowTimestamp(),
    };

    const outcome = upsertScannedBook(booksList, candidateBook);
    booksList = outcome.books;
    savePersistedCatalogCache();

    res.status(outcome.incrementedCopy ? 200 : 201).json({
      book: outcome.book,
      books: booksList,
      incrementedCopy: outcome.incrementedCopy,
    });
  });

  // POST /api/books/custom-isbn - Generate a printable 7x11 custom ISBN for a book with no publisher ISBN
  app.post('/api/books/custom-isbn', (req, res) => {
    const { title, author, category, roomLocation, publishedYear } = req.body || {};
    if (!title || !String(title).trim() || !author || !String(author).trim()) {
      res.status(400).json({
        error: 'Both Title and Author are required to generate a corresponding custom ISBN.',
      });
      return;
    }

    const cleanTitle = String(title).trim();
    const cleanAuthor = String(author).trim();
    const cleanCategory =
      category && String(category).trim() ? String(category).trim() : 'Unindexed Archive';
    const cleanRoom =
      roomLocation && String(roomLocation).trim()
        ? String(roomLocation).trim()
        : 'Patristic Hall · Room 101';
    const cleanYear =
      publishedYear && String(publishedYear).trim()
        ? String(publishedYear).trim()
        : new Date().getFullYear().toString();

    const generatedIsbn = generateCustomIsbn13(cleanTitle, cleanAuthor);

    customIsbnRegistry.set(generatedIsbn, {
      title: cleanTitle,
      author: cleanAuthor,
      category: cleanCategory,
      roomLocation: cleanRoom,
      publishedYear: cleanYear,
    });

    const existingIdx = booksList.findIndex((b) => b.isbn === generatedIsbn);
    if (existingIdx !== -1) {
      booksList[existingIdx] = {
        ...booksList[existingIdx],
        roomLocation: cleanRoom,
        category: cleanCategory,
        publishedYear: cleanYear,
        copyCount: (booksList[existingIdx].copyCount || 1) + 1,
      };
      savePersistedCatalogCache();
      res.status(200).json({
        book: booksList[existingIdx],
        books: booksList,
        alreadyExisted: true,
      });
      return;
    }

    const newBook: BookRecord = {
      id: `bk-custom-${Date.now()}`,
      isbn: generatedIsbn,
      formattedIsbn: formatIsbn13(generatedIsbn),
      title: cleanTitle,
      author: cleanAuthor,
      category: cleanCategory,
      roomLocation: cleanRoom,
      publishedYear: cleanYear,
      copyCount: 1,
      isCustomIsbn: true,
      addedAt: nowTimestamp(),
    };

    booksList = [newBook, ...booksList];
    savePersistedCatalogCache();

    res.status(201).json({
      book: newBook,
      books: booksList,
      alreadyExisted: false,
    });
  });

  // DELETE /api/books/:id - Remove a book record
  app.delete('/api/books/:id', (req, res) => {
    const { id } = req.params;
    booksList = booksList.filter((b) => b.id !== id);
    savePersistedCatalogCache();
    res.json({ books: booksList });
  });

  // POST /api/sheets/register-connection - Save active spreadsheet metadata on backend
  app.post('/api/sheets/register-connection', (req, res) => {
    const { spreadsheetId, title, spreadsheetUrl, sheetTabName } = req.body || {};
    if (spreadsheetId) {
      connectedSheetInfo = {
        spreadsheetId,
        title: title || "St. Augustine's Library Catalog",
        spreadsheetUrl:
          spreadsheetUrl ||
          `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
        sheetTabName: sheetTabName || 'Catalog',
        lastSyncedAt: nowTimestamp(),
      };
      savePersistedCatalogCache();
    }
    res.json({ connectedSheet: connectedSheetInfo });
  });

  // POST /api/sheets/sync-from-sheet - Pull live rows from Google Sheets & resolve any bare scanned ISBN rows
  app.post('/api/sheets/sync-from-sheet', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing Google OAuth Bearer token' });
      return;
    }

    const { spreadsheetId, sheetTabName, sheetTitle, spreadsheetUrl } = req.body || {};
    if (!spreadsheetId || !sheetTabName) {
      res.status(400).json({ error: 'spreadsheetId and sheetTabName are required' });
      return;
    }

    try {
      const range = `${sheetTabName}!A1:I500`;
      const sheetRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          spreadsheetId
        )}/values/${encodeURIComponent(range)}`,
        {
          headers: { Authorization: authHeader },
        }
      );

      if (!sheetRes.ok) {
        const errData = await sheetRes.json().catch(() => ({}));
        res.status(sheetRes.status).json({
          error:
            errData?.error?.message ||
            `Failed to fetch Google Sheet values (${sheetRes.status})`,
        });
        return;
      }

      const data = await sheetRes.json();
      const rows: string[][] = data.values || [];

      const byIsbnMap = new Map<string, BookRecord>();
      const unresolvedRawIsbns: Array<{
        rowNumber: number;
        isbn: string;
        resolvedBook: BookRecord;
      }> = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const colA = (row[0] || '').trim();
        if (!colA) continue;
        // Skip header row if first cell starts with ISBN
        if (i === 0 && /^isbn/i.test(colA)) continue;

        const normalizedIsbn = normalizeScannedIsbn(colA);
        const colTitle = (row[1] || '').trim();
        const colAuthor = (row[2] || '').trim();
        const colCategory = (row[3] || '').trim();
        const colRoom = (row[4] || '').trim();
        const colYear = (row[5] || '').trim();
        const colG = (row[6] || '').trim();
        const colH = (row[7] || '').trim();
        const colI = (row[8] || '').trim();

        const parsedCopies = /^\d+$/.test(colG) ? Math.max(1, parseInt(colG, 10)) : 1;
        const sourceCol = /^\d+$/.test(colG) ? colH : colG;
        const addedAtCol = /^\d+$/.test(colG) ? colI : colH;

        let rowBook: BookRecord;
        if (!colTitle || !colAuthor) {
          // User scanned a bare ISBN into Column A of the Google Spreadsheet via phone scanner app!
          const resolved = await resolveIsbnMetadata(normalizedIsbn);
          rowBook = {
            id: `sheet-row-${i + 1}-${normalizedIsbn}`,
            isbn: normalizedIsbn,
            formattedIsbn: formatIsbn13(normalizedIsbn),
            title: colTitle || resolved.title,
            author: colAuthor || resolved.author,
            category: colCategory || resolved.category,
            roomLocation: colRoom || resolved.roomLocation,
            publishedYear: colYear || resolved.publishedYear,
            copyCount: parsedCopies,
            isCustomIsbn:
              /custom/i.test(sourceCol) ||
              resolved.isCustomIsbn ||
              normalizedIsbn.startsWith('979000'),
            addedAt: addedAtCol || nowTimestamp(),
            sheetRowIndex: i + 1,
          };
          unresolvedRawIsbns.push({
            rowNumber: i + 1,
            isbn: normalizedIsbn,
            resolvedBook: rowBook,
          });
        } else {
          const isCustom =
            /custom|true/i.test(sourceCol) || normalizedIsbn.startsWith('979000');
          if (isCustom) {
            customIsbnRegistry.set(normalizedIsbn, {
              title: colTitle,
              author: colAuthor,
              category: colCategory || 'Unindexed Archive',
              roomLocation: colRoom || 'Main Reading Room',
              publishedYear: colYear || '2024',
            });
          }
          rowBook = {
            id: `sheet-row-${i + 1}-${normalizedIsbn}`,
            isbn: normalizedIsbn,
            formattedIsbn: formatIsbn13(normalizedIsbn),
            title: colTitle,
            author: colAuthor,
            category: colCategory || 'General Collection',
            roomLocation: colRoom || 'Main Reading Room',
            publishedYear: colYear || '2024',
            copyCount: parsedCopies,
            isCustomIsbn: isCustom,
            addedAt: addedAtCol || nowTimestamp(),
            sheetRowIndex: i + 1,
          };
        }

        // If the same ISBN appears multiple times in the sheet, increment its copyCount
        const existing = byIsbnMap.get(normalizedIsbn);
        if (existing) {
          existing.copyCount = (existing.copyCount || 1) + rowBook.copyCount;
        } else {
          byIsbnMap.set(normalizedIsbn, rowBook);
        }
      }

      const syncedBooks = Array.from(byIsbnMap.values());
      if (syncedBooks.length > 0) {
        booksList = syncedBooks;
      }

      connectedSheetInfo = {
        spreadsheetId,
        title: sheetTitle || connectedSheetInfo?.title || "St. Augustine's Library Catalog",
        spreadsheetUrl:
          spreadsheetUrl ||
          connectedSheetInfo?.spreadsheetUrl ||
          `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
        sheetTabName,
        lastSyncedAt: nowTimestamp(),
      };
      savePersistedCatalogCache();

      res.json({
        books: booksList,
        totalRowsInSheet: syncedBooks.length,
        unresolvedRawIsbns,
        connectedSheet: connectedSheetInfo,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Sheet sync failed';
      res.status(500).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`St. Augustine's Library server listening on http://localhost:${PORT}`);
  });
}

startServer();
