// 純粋関数: 自由計算式のトークナイザ＋再帰下降パーサー。evalは使わない。
//
// 対応: 数値リテラル、変数（identifier: [A-Za-z0-9_-]+ で先頭が数字でないもの）、
// 四則演算(+ - * /)、単項マイナス、括弧。
// 変数名の例: judge-form_avg, peer-form_sum, my-team-form_count （slug にハイフンを含む）

type TokenType = 'number' | 'ident' | 'op' | 'lparen' | 'rparen' | 'eof';

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  const n = expression.length;
  let i = 0;

  while (i < n) {
    const c = expression[i];

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }

    if (c >= '0' && c <= '9') {
      let j = i + 1;
      while (j < n && /[0-9.]/.test(expression[j])) j++;
      tokens.push({ type: 'number', value: expression.slice(i, j), pos: i });
      i = j;
      continue;
    }

    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_-]/.test(expression[j])) j++;
      tokens.push({ type: 'ident', value: expression.slice(i, j), pos: i });
      i = j;
      continue;
    }

    if (c === '+' || c === '-' || c === '*' || c === '/') {
      tokens.push({ type: 'op', value: c, pos: i });
      i++;
      continue;
    }

    if (c === '(') {
      tokens.push({ type: 'lparen', value: c, pos: i });
      i++;
      continue;
    }

    if (c === ')') {
      tokens.push({ type: 'rparen', value: c, pos: i });
      i++;
      continue;
    }

    throw new Error(`不正な文字です: '${c}' (位置 ${i})`);
  }

  tokens.push({ type: 'eof', value: '', pos: n });
  return tokens;
}

class Parser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly vars: Record<string, number>
  ) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    return this.tokens[this.pos++];
  }

  parse(): number {
    const value = this.parseExpression();
    if (this.peek().type !== 'eof') {
      throw new Error(`構文エラー: 余分なトークンがあります (位置 ${this.peek().pos})`);
    }
    return value;
  }

  private parseExpression(): number {
    let value = this.parseTerm();
    while (this.peek().type === 'op' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.advance().value;
      const rhs = this.parseTerm();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  }

  private parseTerm(): number {
    let value = this.parseFactor();
    while (this.peek().type === 'op' && (this.peek().value === '*' || this.peek().value === '/')) {
      const op = this.advance().value;
      const rhs = this.parseFactor();
      if (op === '/') {
        if (rhs === 0) throw new Error('ゼロ除算です');
        value = value / rhs;
      } else {
        value = value * rhs;
      }
    }
    return value;
  }

  private parseFactor(): number {
    const tok = this.peek();
    if (tok.type === 'op' && tok.value === '-') {
      this.advance();
      return -this.parseFactor();
    }
    if (tok.type === 'op' && tok.value === '+') {
      this.advance();
      return this.parseFactor();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    const tok = this.advance();

    if (tok.type === 'number') {
      const n = Number(tok.value);
      if (!Number.isFinite(n)) throw new Error(`不正な数値です: ${tok.value}`);
      return n;
    }

    if (tok.type === 'ident') {
      if (!(tok.value in this.vars)) {
        throw new Error(`不明な変数です: ${tok.value}`);
      }
      return this.vars[tok.value];
    }

    if (tok.type === 'lparen') {
      const value = this.parseExpression();
      const close = this.advance();
      if (close.type !== 'rparen') {
        throw new Error(`構文エラー: ')' が必要です (位置 ${close.pos})`);
      }
      return value;
    }

    throw new Error(`構文エラー: 予期しないトークンです (位置 ${tok.pos})`);
  }
}

/** 式を評価する。未知変数・構文エラー・ゼロ除算は例外を投げる。 */
export function evaluate(expression: string, vars: Record<string, number>): number {
  const tokens = tokenize(expression);
  const parser = new Parser(tokens, vars);
  return parser.parse();
}
