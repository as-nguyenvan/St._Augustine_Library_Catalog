export interface BookRecord {
  id: string;
  isbn: string;
  formattedIsbn: string;
  title: string;
  author: string;
  category: string;
  roomLocation: string;
  publishedYear: string;
  copyCount: number;
  isCustomIsbn: boolean;
  addedAt: string;
  sheetRowIndex?: number;
}

export interface BinarySearchOutcome {
  results: BookRecord[];
  exactTitleMatch: BookRecord | null;
  searchSteps: number;
  algorithmUsed: 'all-catalog' | 'binary-exact-title' | 'binary-keyword-prefix';
}

export const AUTHORIZED_LIBRARIAN_EMAIL = 'alexanderngoc@gmail.com';

export function isAuthorizedLibrarian(email?: string | null): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === AUTHORIZED_LIBRARIAN_EMAIL;
}

/**
 * Strips all non-ISBN characters (hyphens, spaces, prefixes) and uppercases X.
 */
export function cleanIsbn(raw: string): string {
  return raw.replace(/[^0-9Xx]/g, '').toUpperCase();
}

/**
 * Computes the official EAN-13 / ISBN-13 Mod-10 check digit for a 12-digit numeric string.
 */
export function computeEan13CheckDigit(twelveDigits: string): string {
  if (!/^\d{12}$/.test(twelveDigits)) {
    throw new Error('Input must be exactly 12 digits');
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = Number(twelveDigits[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const remainder = sum % 10;
  return remainder === 0 ? '0' : String(10 - remainder);
}

/**
 * Validates whether a string is a valid 13-digit EAN-13 / ISBN-13 with matching check digit.
 */
export function isValidIsbn13(raw: string): boolean {
  const cleaned = cleanIsbn(raw);
  if (!/^\d{13}$/.test(cleaned)) return false;
  const expectedCheck = computeEan13CheckDigit(cleaned.slice(0, 12));
  return cleaned[12] === expectedCheck;
}

/**
 * Converts a 10-digit ISBN to a 13-digit 978 ISBN with valid check digit.
 */
export function isbn10ToIsbn13(raw: string): string | null {
  const cleaned = cleanIsbn(raw);
  if (!/^\d{9}[\dX]$/.test(cleaned)) return null;
  const base12 = '978' + cleaned.slice(0, 9);
  return base12 + computeEan13CheckDigit(base12);
}

/**
 * Deterministically generates a valid 13-digit internal library ISBN (prefix 979-0-00)
 * corresponding to a specific Title and Author for books that have no publisher ISBN.
 */
export function generateCustomIsbn13(title: string, author: string, saltIndex = 0): string {
  const normalized = `${title.trim().toLowerCase()}|${author.trim().toLowerCase()}|${saltIndex}`;
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const positiveHash = Math.abs(hash >>> 0);
  const sixDigits = String(positiveHash % 1000000).padStart(6, '0');
  const twelveDigits = `979000${sixDigits}`;
  const checkDigit = computeEan13CheckDigit(twelveDigits);
  return `${twelveDigits}${checkDigit}`;
}

/**
 * Formats a 13-digit ISBN into readable hyphenated segments.
 */
export function formatIsbn13(raw: string): string {
  const cleaned = cleanIsbn(raw);
  if (cleaned.length !== 13) return raw.trim();
  if (cleaned.startsWith('979000')) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 12)}-${cleaned.slice(12)}`;
  }
  return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 4)}-${cleaned.slice(4, 7)}-${cleaned.slice(7, 12)}-${cleaned.slice(12)}`;
}

/**
 * Upserts a scanned book into the master catalog list.
 * If a book with the same normalized ISBN already exists, increments its copyCount by 1.
 */
export function upsertScannedBook(
  books: BookRecord[],
  incomingBook: BookRecord
): { book: BookRecord; books: BookRecord[]; incrementedCopy: boolean } {
  const targetIsbn = cleanIsbn(incomingBook.isbn);
  const existingIdx = books.findIndex((b) => cleanIsbn(b.isbn) === targetIsbn);

  if (existingIdx !== -1) {
    const existing = books[existingIdx];
    const updatedBook: BookRecord = {
      ...existing,
      copyCount: (existing.copyCount || 1) + 1,
      roomLocation: incomingBook.roomLocation || existing.roomLocation,
      addedAt: incomingBook.addedAt || existing.addedAt,
    };
    const remaining = books.filter((_, idx) => idx !== existingIdx);
    const updatedList = [updatedBook, ...remaining];
    return {
      book: updatedBook,
      books: updatedList,
      incrementedCopy: true,
    };
  }

  const freshBook: BookRecord = {
    ...incomingBook,
    copyCount: incomingBook.copyCount && incomingBook.copyCount > 0 ? incomingBook.copyCount : 1,
  };
  return {
    book: freshBook,
    books: [freshBook, ...books],
    incrementedCopy: false,
  };
}

// Standard EAN-13 encoding tables for generating real scannable SVG barcodes
const L_CODES = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];
const G_CODES = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
];
const R_CODES = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100',
];
const PARITY_PATTERNS = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
];

/**
 * Encodes a 13-digit ISBN into a 95-module binary string ('1' = bar, '0' = space)
 * conforming to the official EAN-13 barcode specification.
 */
export function encodeEan13Bits(isbn13: string): string {
  const cleaned = cleanIsbn(isbn13);
  if (!/^\d{13}$/.test(cleaned)) {
    throw new Error('EAN-13 encoding requires a 13-digit numeric string');
  }
  const firstDigit = Number(cleaned[0]);
  const parity = PARITY_PATTERNS[firstDigit];
  let bits = '101';

  for (let i = 1; i <= 6; i++) {
    const digit = Number(cleaned[i]);
    const p = parity[i - 1];
    bits += p === 'L' ? L_CODES[digit] : G_CODES[digit];
  }

  bits += '01010';

  for (let i = 7; i <= 12; i++) {
    const digit = Number(cleaned[i]);
    bits += R_CODES[digit];
  }

  bits += '101';
  return bits;
}

/**
 * Extracts a Google Spreadsheet ID from either a full Google Sheets URL or a direct ID string.
 */
export function extractSpreadsheetId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }
  if (/^[a-zA-Z0-9-_]{15,64}$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function normalizeText(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Performs classic O(log N) binary search over a title-sorted catalog array
 * to check for an exact normalized title match.
 */
export function binarySearchExactTitle(
  books: BookRecord[],
  targetTitle: string
): { match: BookRecord | null; steps: number } {
  const target = normalizeText(targetTitle);
  if (!target || books.length === 0) return { match: null, steps: 0 };

  const sortedByTitle = [...books].sort((a, b) =>
    normalizeText(a.title).localeCompare(normalizeText(b.title))
  );

  let low = 0;
  let high = sortedByTitle.length - 1;
  let steps = 0;

  while (low <= high) {
    steps++;
    const mid = (low + high) >>> 1;
    const midTitle = normalizeText(sortedByTitle[mid].title);
    const cmp = midTitle.localeCompare(target);

    if (cmp === 0) {
      return { match: sortedByTitle[mid], steps };
    } else if (cmp < 0) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return { match: null, steps };
}

interface SortedTokenEntry {
  token: string;
  book: BookRecord;
}

/**
 * Builds a sorted lexicographical token array from all books (Title words, Full Title prefixes,
 * Author words, Category words, Room Location words, and ISBN) and uses Binary Search
 * (O(log M) lower-bound prefix lookup) so users do NOT have to type the exact title to find matching books.
 */
export function binarySearchCatalog(
  books: BookRecord[],
  rawQuery: string,
  filterMode: 'all' | 'custom_isbn' = 'all'
): BinarySearchOutcome {
  const baseBooks =
    filterMode === 'custom_isbn'
      ? books.filter((b) => b.isCustomIsbn)
      : books;

  const trimmed = rawQuery.trim();
  if (!trimmed) {
    return {
      results: baseBooks,
      exactTitleMatch: null,
      searchSteps: 0,
      algorithmUsed: 'all-catalog',
    };
  }

  // 1. Run O(log N) Binary Search on exact normalized book titles first
  const exactCheck = binarySearchExactTitle(baseBooks, trimmed);
  let totalSteps = exactCheck.steps;

  // 2. Build a lexicographically sorted inverted index of searchable tokens
  const indexEntries: SortedTokenEntry[] = [];
  for (const book of baseBooks) {
    const rawWords = normalizeText(
      `${book.title} ${book.author} ${book.category} ${book.roomLocation}`
    ).split(' ');
    const cleanedIsbn = cleanIsbn(book.isbn).toLowerCase();
    const formattedIsbn = book.formattedIsbn.toLowerCase();
    const fullNormalizedTitle = normalizeText(book.title);

    const uniqueTokens = new Set<string>([
      ...rawWords.filter(Boolean),
      fullNormalizedTitle,
      cleanedIsbn,
      formattedIsbn,
    ]);

    for (const token of uniqueTokens) {
      indexEntries.push({ token, book });
    }
  }

  indexEntries.sort((a, b) => a.token.localeCompare(b.token));

  const queryKeywords = normalizeText(trimmed).split(' ').filter(Boolean);
  const numericQuery = cleanIsbn(trimmed).toLowerCase();
  if (numericQuery.length >= 3 && !queryKeywords.includes(numericQuery)) {
    queryKeywords.push(numericQuery);
  }

  if (queryKeywords.length === 0) {
    return {
      results: [],
      exactTitleMatch: null,
      searchSteps: totalSteps,
      algorithmUsed: 'binary-keyword-prefix',
    };
  }

  // For each keyword, use Binary Search lower-bound to find all tokens starting with keyword
  const bookMatchCounts = new Map<string, { book: BookRecord; score: number }>();

  for (const kw of queryKeywords) {
    let low = 0;
    let high = indexEntries.length - 1;
    let firstIdx = indexEntries.length;

    while (low <= high) {
      totalSteps++;
      const mid = (low + high) >>> 1;
      if (indexEntries[mid].token.localeCompare(kw) >= 0) {
        firstIdx = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    const matchedBooksForKeyword = new Set<string>();
    for (let i = firstIdx; i < indexEntries.length; i++) {
      const entry = indexEntries[i];
      if (!entry.token.startsWith(kw)) {
        break;
      }
      if (!matchedBooksForKeyword.has(entry.book.id)) {
        matchedBooksForKeyword.add(entry.book.id);
        const prev = bookMatchCounts.get(entry.book.id);
        const exactTokenBonus = entry.token === kw ? 2 : 1;
        bookMatchCounts.set(entry.book.id, {
          book: entry.book,
          score: (prev?.score || 0) + exactTokenBonus,
        });
      }
    }
  }

  const requiredKeywordCount = normalizeText(trimmed).split(' ').filter(Boolean).length;
  const matchedResults: Array<{ book: BookRecord; score: number }> = [];

  if (exactCheck.match) {
    matchedResults.push({ book: exactCheck.match, score: 1000 });
  }

  for (const [, value] of bookMatchCounts.entries()) {
    if (exactCheck.match && value.book.id === exactCheck.match.id) continue;
    const bookSearchableTokens = normalizeText(
      `${value.book.title} ${value.book.author} ${value.book.category} ${value.book.roomLocation}`
    ).split(' ');
    const bookCleanIsbn = cleanIsbn(value.book.isbn).toLowerCase();

    const allKeywordsSatisfied = normalizeText(trimmed)
      .split(' ')
      .filter(Boolean)
      .every(
        (kw) =>
          bookSearchableTokens.some((t) => t.startsWith(kw)) ||
          bookCleanIsbn.startsWith(kw) ||
          bookCleanIsbn.includes(kw)
      );

    if (allKeywordsSatisfied || (requiredKeywordCount === 0 && value.score > 0)) {
      matchedResults.push(value);
    }
  }

  matchedResults.sort((a, b) => b.score - a.score);

  return {
    results: matchedResults.map((r) => r.book),
    exactTitleMatch: exactCheck.match,
    searchSteps: totalSteps,
    algorithmUsed: exactCheck.match ? 'binary-exact-title' : 'binary-keyword-prefix',
  };
}

/**
 * Convenience wrapper for filtering books using the binary search system.
 */
export function filterBooks(
  books: BookRecord[],
  query: string,
  filterMode: 'all' | 'custom_isbn' = 'all'
): BookRecord[] {
  return binarySearchCatalog(books, query, filterMode).results;
}
