/** Tiny quote-aware CSV parser (no papaparse dependency).
 *
 * Handles quoted fields with embedded commas/newlines and "" escapes — enough for
 * the Python csv.DictWriter output the ontology tool produces. */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Parse CSV text into row objects keyed by the header row. */
export function parseCsvObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text.trim());
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows
    .slice(1)
    .map(cells => Object.fromEntries(header.map((key, i) => [key, cells[i] ?? ''])));
}
