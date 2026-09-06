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

/** 文字列が実質的に数値表記か (整数/小数、先頭の-可) を判定する */
function looksNumeric(field: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(field.trim());
}

/**
 * CSV/スプレッドシートの数式インジェクション対策。
 * `= + - @ \t` で始まる文字列セルの先頭に `'` を付与し、文字列として展開されるようにする。
 * 数値表記のセル（スコアなど）はそのまま返す。
 */
export function escapeFormulaInjection(field: string): string {
  if (looksNumeric(field)) return field;
  if (/^[=+\-@\t]/.test(field)) return `'${field}`;
  return field;
}

export function toCsvRow(fields: string[]): string {
  return fields.map((f) => escapeCsvField(escapeFormulaInjection(f))).join(',');
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
