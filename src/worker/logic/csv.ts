// 純粋関数: CSVエスケープとMarkdown平文化。D1に依存しない。

/** Excel対応のUTF-8 BOM */
export const CSV_BOM = '﻿';

/** CSVフィールドをエスケープする。カンマ・ダブルクォート・改行を含む場合は引用符で囲む。 */
export function escapeCsvField(field: string): string {
  if (/[",\n\r]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

export function toCsvRow(fields: string[]): string {
  return fields.map(escapeCsvField).join(',');
}

/** 行の配列からCSV文字列を生成する（CRLF区切り、Excel対応）。BOMは含まない。 */
export function toCsv(rows: string[][]): string {
  return rows.map(toCsvRow).join('\r\n');
}

/** Markdownの強調記号などを除去し平文化する（簡易実装）。 */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*\*|\*\*|\*|___|__|_)/g, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/\r?\n+/g, ' ')
    .trim();
}
