import { BookRecord } from '../utils/isbn';

export interface SheetMetadata {
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
  sheets: string[];
}

export interface SheetSyncResult {
  books: BookRecord[];
  sheetTitle: string;
  totalRowsInSheet: number;
  unresolvedRawIsbns: Array<{
    rowNumber: number;
    isbn: string;
    resolvedBook: BookRecord;
  }>;
}

/**
 * Fetches spreadsheet metadata (title and list of sheet tab names) without hardcoding "Sheet1".
 */
export async function fetchSpreadsheetMetadata(
  spreadsheetId: string,
  accessToken: string
): Promise<SheetMetadata> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties.title`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(
      errData?.error?.message || `Failed to read Google Spreadsheet (${res.status})`
    );
  }
  const data = await res.json();
  const sheets: string[] = (data.sheets || []).map(
    (s: { properties?: { title?: string } }) => s.properties?.title || 'Catalog'
  );
  return {
    spreadsheetId: data.spreadsheetId,
    title: data.properties?.title || "St. Augustine's Library Catalog",
    spreadsheetUrl:
      data.spreadsheetUrl ||
      `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}/edit`,
    sheets: sheets.length > 0 ? sheets : ['Catalog'],
  };
}

/**
 * Creates a brand-new Google Spreadsheet template pre-configured for St. Augustine's Library
 * and mobile phone ISBN barcode scanning apps (Column A = ISBN, Column E = Room Location, Column G = Copies).
 */
export async function createLibrarySpreadsheet(
  title: string,
  initialBooks: BookRecord[],
  accessToken: string
): Promise<SheetMetadata> {
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title },
      sheets: [
        {
          properties: {
            title: 'Catalog',
            gridProperties: { frozenRowCount: 1 },
          },
        },
      ],
    }),
  });

  if (!createRes.ok) {
    const errData = await createRes.json().catch(() => ({}));
    throw new Error(
      errData?.error?.message || `Failed to create Google Spreadsheet (${createRes.status})`
    );
  }

  const created = await createRes.json();
  const spreadsheetId: string = created.spreadsheetId;
  const sheetTabName = created.sheets?.[0]?.properties?.title || 'Catalog';

  const headerRow = [
    'ISBN (Scan Here from Phone)',
    'Book Title',
    'Author',
    'Category',
    'Room Location',
    'Publication Year',
    'Copies',
    'Barcode Source',
    'Added Date',
  ];

  const bookRows = initialBooks.map((b) => [
    b.isbn,
    b.title,
    b.author,
    b.category,
    b.roomLocation,
    b.publishedYear,
    String(b.copyCount || 1),
    b.isCustomIsbn ? 'Custom 7x11 Cut-Out Barcode' : 'Publisher ISBN',
    b.addedAt,
  ]);

  const values = [headerRow, ...bookRows];

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(sheetTabName)}!A1:I${values.length}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values }),
    }
  );

  return {
    spreadsheetId,
    title: created.properties?.title || title,
    spreadsheetUrl:
      created.spreadsheetUrl ||
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    sheets: [sheetTabName],
  };
}

/**
 * Appends a single book record to the connected Google Spreadsheet tab.
 */
export async function appendBookToSpreadsheet(
  spreadsheetId: string,
  sheetTabName: string,
  book: BookRecord,
  accessToken: string
): Promise<void> {
  const row = [
    book.isbn,
    book.title,
    book.author,
    book.category,
    book.roomLocation,
    book.publishedYear,
    String(book.copyCount || 1),
    book.isCustomIsbn ? 'Custom 7x11 Cut-Out Barcode' : 'Publisher ISBN',
    book.addedAt,
  ];

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(sheetTabName)}!A1:I1:append?valueInputOption=USER_ENTERED`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [row] }),
    }
  );

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(
      errData?.error?.message || `Failed to append row to Google Sheets (${res.status})`
    );
  }
}

/**
 * Writes back resolved metadata (Title, Author, Category, Room Location, Year, Copies) for bare ISBN rows
 * that were scanned via a mobile phone ISBN app into Column A of the Google Spreadsheet.
 */
export async function writeResolvedRowsToSpreadsheet(
  spreadsheetId: string,
  sheetTabName: string,
  resolvedItems: Array<{ rowNumber: number; resolvedBook: BookRecord }>,
  accessToken: string
): Promise<void> {
  for (const item of resolvedItems) {
    const b = item.resolvedBook;
    const range = `${sheetTabName}!A${item.rowNumber}:I${item.rowNumber}`;
    const values = [
      [
        b.isbn,
        b.title,
        b.author,
        b.category,
        b.roomLocation,
        b.publishedYear,
        String(b.copyCount || 1),
        b.isCustomIsbn ? 'Custom 7x11 Cut-Out Barcode' : 'Publisher ISBN',
        b.addedAt,
      ],
    ];
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId
      )}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values }),
      }
    );
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(
        errData?.error?.message || `Failed to update row ${item.rowNumber} in Google Sheets`
      );
    }
  }
}

/**
 * Downloads a ready-to-import CSV template file structured for mobile ISBN scanner apps.
 */
export function downloadSpreadsheetTemplateCsv(books: BookRecord[]): void {
  const headers = [
    'ISBN (Scan Here from Phone)',
    'Book Title',
    'Author',
    'Category',
    'Room Location',
    'Publication Year',
    'Copies',
    'Barcode Source',
    'Added Date',
  ];
  const escapeCsv = (val: string) => `"${String(val).replace(/"/g, '""')}"`;
  const rows = books.map((b) =>
    [
      b.isbn,
      b.title,
      b.author,
      b.category,
      b.roomLocation,
      b.publishedYear,
      String(b.copyCount || 1),
      b.isCustomIsbn ? 'Custom 7x11 Cut-Out Barcode' : 'Publisher ISBN',
      b.addedAt,
    ]
      .map(escapeCsv)
      .join(',')
  );
  const csvContent = [headers.map(escapeCsv).join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'st-augustines-library-template.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
