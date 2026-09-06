import { describe, expect, it } from 'vitest';
import { CSV_BOM, escapeCsvField, escapeFormulaInjection, stripMarkdown, toCsv, toCsvRow } from '../src/worker/logic/csv';

describe('escapeCsvField', () => {
  it('特殊文字を含まない場合はそのまま返す', () => {
    expect(escapeCsvField('hello')).toBe('hello');
    expect(escapeCsvField('チームA')).toBe('チームA');
  });

  it('カンマを含む場合は引用符で囲む', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
  });

  it('ダブルクォートを含む場合はエスケープして引用符で囲む', () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it('改行を含む場合は引用符で囲む', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvField('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('空文字はそのまま返す', () => {
    expect(escapeCsvField('')).toBe('');
  });
});

describe('toCsvRow / toCsv', () => {
  it('行をカンマ区切りにする', () => {
    expect(toCsvRow(['a', 'b', 'c'])).toBe('a,b,c');
  });

  it('複数行をCRLFで連結する', () => {
    const csv = toCsv([
      ['回答者', 'チーム', 'スコア'],
      ['Alice', 'A', '10'],
      ['Bob', 'B', '8'],
    ]);
    expect(csv).toBe('回答者,チーム,スコア\r\nAlice,A,10\r\nBob,B,8');
  });

  it('フィールドのエスケープを適用する', () => {
    const csv = toCsv([['a,b', 'say "hi"']]);
    expect(csv).toBe('"a,b","say ""hi"""');
  });
});

describe('escapeFormulaInjection', () => {
  it('= + - @ タブで始まる文字列に \' を付与する', () => {
    expect(escapeFormulaInjection('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(escapeFormulaInjection('+1+1')).toBe("'+1+1");
    expect(escapeFormulaInjection('-cmd|calc')).toBe("'-cmd|calc");
    expect(escapeFormulaInjection('@echo')).toBe("'@echo");
    expect(escapeFormulaInjection('\tfoo')).toBe("'\tfoo");
  });

  it('数値表記の文字列 (負の数含む) はそのまま返す', () => {
    expect(escapeFormulaInjection('10')).toBe('10');
    expect(escapeFormulaInjection('-5')).toBe('-5');
    expect(escapeFormulaInjection('-5.5')).toBe('-5.5');
  });

  it('特殊文字で始まらない文字列はそのまま返す', () => {
    expect(escapeFormulaInjection('hello')).toBe('hello');
    expect(escapeFormulaInjection('')).toBe('');
  });
});

describe('toCsvRow / toCsv 数式インジェクション対策', () => {
  it('=で始まるセルをCSV出力時にエスケープする', () => {
    expect(toCsvRow(['=SUM(A1:A2)', 'normal'])).toBe("'=SUM(A1:A2),normal");
  });

  it('数式インジェクション対策後にカンマを含む場合は引用符でも囲む', () => {
    expect(toCsvRow(['=A,B', 'normal'])).toBe('"\'=A,B",normal');
  });

  it('スコアなど数値文字列のセルはエスケープしない', () => {
    expect(toCsvRow(['-5', '10'])).toBe('-5,10');
  });
});

describe('CSV_BOM', () => {
  it('UTF-8 BOM文字を含む', () => {
    expect(CSV_BOM.charCodeAt(0)).toBe(0xfeff);
    expect(CSV_BOM.length).toBe(1);
  });
});

describe('stripMarkdown', () => {
  it('太字・斜体記号を除去する', () => {
    expect(stripMarkdown('**bold**')).toBe('bold');
    expect(stripMarkdown('*italic*')).toBe('italic');
    expect(stripMarkdown('__bold__')).toBe('bold');
  });

  it('インラインコードを除去する', () => {
    expect(stripMarkdown('`code`')).toBe('code');
  });

  it('見出し記号を除去する', () => {
    expect(stripMarkdown('# heading')).toBe('heading');
    expect(stripMarkdown('### small heading')).toBe('small heading');
  });

  it('リンクをテキストのみに変換する', () => {
    expect(stripMarkdown('[link](https://example.com)')).toBe('link');
  });

  it('改行を空白に変換する', () => {
    expect(stripMarkdown('line1\nline2')).toBe('line1 line2');
  });

  it('前後の空白をトリムする', () => {
    expect(stripMarkdown('  hello  ')).toBe('hello');
  });
});
