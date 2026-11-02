import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanIsbn,
  computeEan13CheckDigit,
  isValidIsbn13,
  isbn10ToIsbn13,
  generateCustomIsbn13,
  formatIsbn13,
  encodeEan13Bits,
  extractSpreadsheetId,
  binarySearchExactTitle,
  binarySearchCatalog,
  isAuthorizedLibrarian,
  upsertScannedBook,
  BookRecord,
} from './isbn';

test('computeEan13CheckDigit and isValidIsbn13 validate standard ISBN-13 numbers', () => {
  assert.equal(computeEan13CheckDigit('978044117271'), '9');
  assert.equal(isValidIsbn13('978-0-441-17271-9'), true);
  assert.equal(isValidIsbn13('978-0-441-17271-0'), false);
});

test('isbn10ToIsbn13 converts 10-digit ISBNs accurately', () => {
  assert.equal(isbn10ToIsbn13('0-441-17271-7'), '9780441172719');
  assert.equal(cleanIsbn('978-0-14-044913-6'), '9780140449136');
});

test('generateCustomIsbn13 creates deterministic valid 13-digit ISBNs for non-ISBN books', () => {
  const custom1 = generateCustomIsbn13('Confessions of St. Augustine', 'Augustine of Hippo');
  const custom2 = generateCustomIsbn13('Confessions of St. Augustine', 'Augustine of Hippo');
  const customDifferent = generateCustomIsbn13('City of God', 'Augustine of Hippo');

  assert.equal(custom1.length, 13);
  assert.equal(custom1, custom2);
  assert.notEqual(custom1, customDifferent);
  assert.equal(isValidIsbn13(custom1), true);
  assert.equal(isValidIsbn13(customDifferent), true);
  assert.equal(custom1.startsWith('979000'), true);
  assert.equal(formatIsbn13(custom1).startsWith('979-0-00-'), true);
});

test('encodeEan13Bits produces exact 95-module EAN-13 bit pattern', () => {
  const bits = encodeEan13Bits('9780441172719');
  assert.equal(bits.length, 95);
  assert.equal(bits.startsWith('101'), true);
  assert.equal(bits.endsWith('101'), true);
  assert.equal(bits.slice(45, 50), '01010');
});

test('extractSpreadsheetId parses full Google Sheets URLs and raw IDs', () => {
  const url = 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0';
  assert.equal(extractSpreadsheetId(url), '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
  assert.equal(extractSpreadsheetId('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'), '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
  assert.equal(extractSpreadsheetId('invalid'), null);
});

test('isAuthorizedLibrarian restricts librarian tools to alexanderngoc@gmail.com', () => {
  assert.equal(isAuthorizedLibrarian('alexanderngoc@gmail.com'), true);
  assert.equal(isAuthorizedLibrarian('ALEXANDERNGOC@GMAIL.COM '), true);
  assert.equal(isAuthorizedLibrarian('visitor@example.com'), false);
  assert.equal(isAuthorizedLibrarian(null), false);
});

test('upsertScannedBook increments copyCount when scanning an existing ISBN', () => {
  const initial: BookRecord[] = [
    {
      id: '1',
      isbn: '9780140449136',
      formattedIsbn: '978-0-14-044913-6',
      title: 'The Odyssey',
      author: 'Homer',
      category: 'Classic Literature',
      roomLocation: 'Room 102 · Classical Wing',
      publishedYear: '1996',
      copyCount: 1,
      isCustomIsbn: false,
      addedAt: '2026-11-01',
    },
  ];

  // Scan the same ISBN again -> increments copyCount to 2 without duplicating rows
  const res1 = upsertScannedBook(initial, {
    ...initial[0],
    id: '2',
  });
  assert.equal(res1.incrementedCopy, true);
  assert.equal(res1.book.copyCount, 2);
  assert.equal(res1.books.length, 1);

  // Scan a brand new ISBN -> adds with copyCount 1
  const res2 = upsertScannedBook(res1.books, {
    id: '3',
    isbn: '9780441172719',
    formattedIsbn: '978-0-441-17271-9',
    title: 'Dune',
    author: 'Frank Herbert',
    category: 'Science Fiction',
    roomLocation: 'Main Reading Room',
    publishedYear: '1965',
    copyCount: 1,
    isCustomIsbn: false,
    addedAt: '2026-11-01',
  });
  assert.equal(res2.incrementedCopy, false);
  assert.equal(res2.book.copyCount, 1);
  assert.equal(res2.books.length, 2);
});

test('binarySearchExactTitle and binarySearchCatalog match partial keywords, roomLocation, and detect non-existent titles', () => {
  const sampleBooks: BookRecord[] = [
    {
      id: '1',
      isbn: '9780140449136',
      formattedIsbn: '978-0-14-044913-6',
      title: 'The Odyssey',
      author: 'Homer',
      category: 'Classic Literature',
      roomLocation: 'Room 102 · Classical Wing',
      publishedYear: '1996',
      copyCount: 1,
      isCustomIsbn: false,
      addedAt: '2026-11-01',
    },
    {
      id: '2',
      isbn: '9790004829104',
      formattedIsbn: '979-0-00-482910-4',
      title: 'Confessions of St. Augustine (Archival Folio)',
      author: 'Augustine of Hippo',
      category: 'Theology & Philosophy',
      roomLocation: 'Patristic Hall · Room 204',
      publishedYear: '1924',
      copyCount: 2,
      isCustomIsbn: true,
      addedAt: '2026-11-01',
    },
    {
      id: '3',
      isbn: '9780441172719',
      formattedIsbn: '978-0-441-17271-9',
      title: 'Dune',
      author: 'Frank Herbert',
      category: 'Science Fiction',
      roomLocation: 'Main Reading Room · Shelf B3',
      publishedYear: '1965',
      copyCount: 1,
      isCustomIsbn: false,
      addedAt: '2026-11-01',
    },
  ];

  // Exact title binary search
  const exactHit = binarySearchExactTitle(sampleBooks, 'The Odyssey');
  assert.equal(exactHit.match?.id, '1');
  assert.equal(exactHit.steps > 0, true);

  // Non-existent exact title returns null
  const exactMiss = binarySearchExactTitle(sampleBooks, 'The Lost Gospel of Atlantis');
  assert.equal(exactMiss.match, null);

  // Keyword binary search without typing exact title
  const keywordMatch = binarySearchCatalog(sampleBooks, 'Augustine Folio');
  assert.equal(keywordMatch.results.length, 1);
  assert.equal(keywordMatch.results[0].id, '2');

  // Room location binary search
  const roomMatch = binarySearchCatalog(sampleBooks, 'Patristic 204');
  assert.equal(roomMatch.results.length, 1);
  assert.equal(roomMatch.results[0].id, '2');

  // Non-existent book returns empty results
  const missingOutcome = binarySearchCatalog(sampleBooks, 'The Lost Gospel of Atlantis');
  assert.equal(missingOutcome.results.length, 0);
});
