export interface QboRow {
  invoiceNo: string;
  customer: string;
  invoiceDate: string;
  dueDate: string;
  terms: string;
  memo: string;
  item: string;
  description: string;
  quantity: number;
  rateCents: number;
  amountCents: number;
}

const HEADER = ['InvoiceNo', 'Customer', 'InvoiceDate', 'DueDate', 'Terms', 'Memo', 'Item(Product/Service)', 'ItemDescription', 'ItemQuantity', 'ItemRate', 'ItemAmount'];

/** Quotes per RFC 4180 and neutralizes spreadsheet formula injection in text cells. */
export function csvText(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** QuickBooks Online invoice import layout. Dates are MM/DD/YYYY as QBO expects. */
export function qboCsv(rows: QboRow[]): string {
  const money = (c: number) => (c / 100).toFixed(2);
  const body = rows.map((r) =>
    [
      csvText(r.invoiceNo),
      csvText(r.customer),
      r.invoiceDate,
      r.dueDate,
      csvText(r.terms),
      csvText(r.memo),
      csvText(r.item),
      csvText(r.description),
      String(r.quantity),
      money(r.rateCents),
      money(r.amountCents),
    ].join(','),
  );
  return [HEADER.join(','), ...body].join('\r\n') + '\r\n';
}
