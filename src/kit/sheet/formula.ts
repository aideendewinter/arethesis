/**
 * Spreadsheet formulas: addresses, a tokenizer and parser for `=` expressions,
 * and an evaluator.
 *
 * Supported: numbers, "strings", TRUE/FALSE; `+ - * / ^ &` and comparisons
 * (`= <> < > <= >=`); references (`A1`, `$A$1`) and ranges (`A1:B9`); and the
 * functions SUM, AVERAGE (AVG), MIN, MAX, COUNT, IF, ROUND, ABS, CONCAT.
 * Errors are values, as in other spreadsheets: `#REF!`, `#DIV/0!`,
 * `#VALUE!`, `#NAME?`, `#CYCLE!` and `#ERROR!` (unparseable).
 *
 * @module kit/sheet/formula
 */

export type ErrorCode = '#REF!' | '#DIV/0!' | '#VALUE!' | '#NAME?' | '#CYCLE!' | '#ERROR!';

export class FormulaError {
  constructor(readonly code: ErrorCode) {}
  toString(): string {
    return this.code;
  }
}

export type CellValue = number | string | boolean | FormulaError;

// ── Addresses ──────────────────────────────────────────────────────────────

/** 0-based column index of a column name: A → 0, Z → 25, AA → 26. */
export function colIndex(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Column name of a 0-based index. */
export function colName(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export const address = (row: number, col: number): string => `${colName(col)}${row + 1}`;

/** Parse "B7" into 0-based `{ row, col }`, or null. */
export function parseAddress(addr: string): { row: number; col: number } | null {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(addr);
  if (!m || Number(m[2]) < 1) return null;
  return { row: Number(m[2]) - 1, col: colIndex(m[1]) };
}

// ── Tokens ─────────────────────────────────────────────────────────────────

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'ref'; v: string }
  | { t: 'name'; v: string }
  | { t: 'op'; v: string }
  | { t: '(' | ')' | ',' | ':' };

const TOKEN = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)|"((?:[^"]|"")*)"|(\$?[A-Z]{1,3}\$?\d+)(?![A-Z(\d])|([A-Z_][A-Z0-9_.]*)|(<=|>=|<>|[-+*/^&=<>])|([(),:]))/iy;

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  TOKEN.lastIndex = 0;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(src);
    if (!m) throw new FormulaError('#ERROR!');
    pos = TOKEN.lastIndex;
    if (m[1] !== undefined) tokens.push({ t: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) tokens.push({ t: 'str', v: m[2].replace(/""/g, '"') });
    else if (m[3] !== undefined) tokens.push({ t: 'ref', v: m[3].toUpperCase() });
    else if (m[4] !== undefined) {
      const name = m[4].toUpperCase();
      if (name === 'TRUE' || name === 'FALSE') tokens.push({ t: 'bool', v: name === 'TRUE' });
      else tokens.push({ t: 'name', v: name });
    } else if (m[5] !== undefined) tokens.push({ t: 'op', v: m[5] });
    else tokens.push({ t: m[6] as '(' | ')' | ',' | ':' });
  }
  return tokens;
}

// ── Parser ─────────────────────────────────────────────────────────────────

export type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'ref'; ref: string }
  | { k: 'range'; from: string; to: string }
  | { k: 'unary'; op: string; arg: Node }
  | { k: 'bin'; op: string; l: Node; r: Node }
  | { k: 'call'; name: string; args: Node[] };

const BINARY: Record<string, number> = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 6 };

/** Parse a formula (without the leading `=`). Throws a FormulaError on bad syntax. */
export function parse(src: string): Node {
  const tokens = tokenize(src);
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const expect = (t: string) => {
    const tok = next();
    if (!tok || tok.t !== t) throw new FormulaError('#ERROR!');
  };

  function primary(): Node {
    const tok = next();
    if (!tok) throw new FormulaError('#ERROR!');
    switch (tok.t) {
      case 'num': return { k: 'num', v: tok.v };
      case 'str': return { k: 'str', v: tok.v };
      case 'bool': return { k: 'bool', v: tok.v };
      case 'ref': {
        if (peek()?.t === ':') {
          next();
          const to = next();
          if (!to || to.t !== 'ref') throw new FormulaError('#ERROR!');
          return { k: 'range', from: tok.v, to: to.v };
        }
        return { k: 'ref', ref: tok.v };
      }
      case 'name': {
        expect('(');
        const args: Node[] = [];
        if (peek()?.t !== ')') {
          args.push(expression(0));
          while (peek()?.t === ',') {
            next();
            args.push(expression(0));
          }
        }
        expect(')');
        return { k: 'call', name: tok.v, args };
      }
      case 'op':
        if (tok.v === '-' || tok.v === '+') return { k: 'unary', op: tok.v, arg: expression(5) };
        throw new FormulaError('#ERROR!');
      case '(': {
        const e = expression(0);
        expect(')');
        return e;
      }
      default:
        throw new FormulaError('#ERROR!');
    }
  }

  /** Precedence climbing; `^` is right-associative. */
  function expression(min: number): Node {
    let left = primary();
    for (;;) {
      const tok = peek();
      if (!tok || tok.t !== 'op' || BINARY[tok.v] === undefined || BINARY[tok.v] < min) break;
      next();
      const prec = BINARY[tok.v];
      const right = expression(tok.v === '^' ? prec : prec + 1);
      left = { k: 'bin', op: tok.v, l: left, r: right };
    }
    return left;
  }

  const tree = expression(0);
  if (i !== tokens.length) throw new FormulaError('#ERROR!');
  return tree;
}

/** Every cell a formula reads (ranges expanded). */
export function references(node: Node, limits?: { rows: number; cols: number }): string[] {
  const out: string[] = [];
  const walk = (n: Node): void => {
    switch (n.k) {
      case 'ref': out.push(n.ref.replace(/\$/g, '')); break;
      case 'range': out.push(...expandRange(n.from, n.to, limits)); break;
      case 'unary': walk(n.arg); break;
      case 'bin': walk(n.l); walk(n.r); break;
      case 'call': n.args.forEach(walk); break;
    }
  };
  walk(node);
  return out;
}

export function expandRange(from: string, to: string, limits?: { rows: number; cols: number }): string[] {
  const a = parseAddress(from);
  const b = parseAddress(to);
  if (!a || !b) return [];
  const cells: string[] = [];
  const maxRow = Math.min(Math.max(a.row, b.row), (limits?.rows ?? Infinity) - 1);
  const maxCol = Math.min(Math.max(a.col, b.col), (limits?.cols ?? Infinity) - 1);
  for (let r = Math.min(a.row, b.row); r <= maxRow; r++) {
    for (let c = Math.min(a.col, b.col); c <= maxCol; c++) cells.push(address(r, c));
  }
  return cells;
}

// ── Evaluation ─────────────────────────────────────────────────────────────

const isError = (v: unknown): v is FormulaError => v instanceof FormulaError;

function toNumber(v: CellValue): number | FormulaError {
  if (isError(v)) return v;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : new FormulaError('#VALUE!');
}

const toText = (v: CellValue): string => (typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v));

export interface EvalContext {
  /** The value of a cell (already computed). */
  get(ref: string): CellValue;
  rows: number;
  cols: number;
}

type Arg = CellValue | CellValue[];

const FUNCTIONS: Record<string, (args: Arg[]) => CellValue> = {
  SUM: args => aggregate(args, ns => ns.reduce((a, b) => a + b, 0)),
  AVERAGE: args => aggregate(args, ns => (ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : new FormulaError('#DIV/0!'))),
  MIN: args => aggregate(args, ns => (ns.length ? Math.min(...ns) : 0)),
  MAX: args => aggregate(args, ns => (ns.length ? Math.max(...ns) : 0)),
  COUNT: args => args.flat().filter(v => typeof v === 'number').length,
  ABS: ([v]) => {
    const n = toNumber(single(v));
    return isError(n) ? n : Math.abs(n);
  },
  ROUND: ([v, digits]) => {
    const n = toNumber(single(v));
    const d = digits === undefined ? 0 : toNumber(single(digits));
    if (isError(n)) return n;
    if (isError(d)) return d;
    const f = 10 ** Math.trunc(d);
    return Math.round(n * f) / f;
  },
  IF: ([cond, a, b]) => {
    const c = single(cond);
    if (isError(c)) return c;
    const truthy = typeof c === 'string' ? c !== '' : Boolean(c);
    return single(truthy ? (a ?? true) : (b ?? false));
  },
  CONCAT: args => {
    const flat = args.flat();
    const err = flat.find(isError);
    return err ?? flat.map(toText).join('');
  },
};
FUNCTIONS.AVG = FUNCTIONS.AVERAGE;

function single(v: Arg | undefined): CellValue {
  if (v === undefined) return '';
  return Array.isArray(v) ? new FormulaError('#VALUE!') : v;
}

/** Numbers from the arguments; text and blanks inside ranges are skipped, errors propagate. */
function aggregate(args: Arg[], fn: (ns: number[]) => number | FormulaError): CellValue {
  const ns: number[] = [];
  for (const arg of args) {
    if (Array.isArray(arg)) {
      for (const v of arg) {
        if (isError(v)) return v;
        if (typeof v === 'number') ns.push(v);
      }
    } else {
      const n = toNumber(arg);
      if (isError(n)) return n;
      ns.push(n);
    }
  }
  return fn(ns);
}

export function evaluate(node: Node, ctx: EvalContext): CellValue {
  const ref = (r: string): CellValue => {
    const pos = parseAddress(r);
    if (!pos || pos.row >= ctx.rows || pos.col >= ctx.cols) return new FormulaError('#REF!');
    return ctx.get(r.replace(/\$/g, ''));
  };
  const arg = (n: Node): Arg => {
    if (n.k !== 'range') return evaluate(n, ctx);
    for (const end of [n.from, n.to]) {
      const pos = parseAddress(end);
      if (!pos || pos.row >= ctx.rows || pos.col >= ctx.cols) return new FormulaError('#REF!');
    }
    return expandRange(n.from, n.to).map(ref);
  };
  switch (node.k) {
    case 'num': return node.v;
    case 'str': return node.v;
    case 'bool': return node.v;
    case 'ref': return ref(node.ref);
    case 'range': return new FormulaError('#VALUE!');
    case 'unary': {
      const n = toNumber(evaluate(node.arg, ctx));
      return isError(n) ? n : node.op === '-' ? -n : n;
    }
    case 'call': {
      const fn = FUNCTIONS[node.name];
      if (!fn) return new FormulaError('#NAME?');
      return fn(node.args.map(arg));
    }
    case 'bin': {
      const l = evaluate(node.l, ctx);
      const r = evaluate(node.r, ctx);
      if (isError(l)) return l;
      if (isError(r)) return r;
      if (node.op === '&') return toText(l) + toText(r);
      if (['=', '<>', '<', '>', '<=', '>='].includes(node.op)) {
        const both = typeof l === 'number' && typeof r === 'number';
        const a = both ? l : toText(l).toLowerCase();
        const b = both ? r : toText(r).toLowerCase();
        switch (node.op) {
          case '=': return a === b;
          case '<>': return a !== b;
          case '<': return a < b;
          case '>': return a > b;
          case '<=': return a <= b;
          default: return a >= b;
        }
      }
      const a = toNumber(l);
      const b = toNumber(r);
      if (isError(a)) return a;
      if (isError(b)) return b;
      switch (node.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? new FormulaError('#DIV/0!') : a / b;
        default: return a ** b;
      }
    }
  }
}

/**
 * Shift a formula's relative references by `dRow`/`dCol` (for fill and
 * paste). `$`-anchored parts stay; references pushed off the sheet become `#REF!`.
 */
export function shiftFormula(raw: string, dRow: number, dCol: number): string {
  if (!raw.startsWith('=')) return raw;
  // Leave string literals alone.
  return raw.replace(/"(?:[^"]|"")*"|(\$?)([A-Z]{1,3})(\$?)(\d+)(?![A-Z(\d])/gi, (match, colAbs: string, col: string, rowAbs: string, row: string) => {
    if (col === undefined) return match;
    const c = colAbs ? colIndex(col) : colIndex(col) + dCol;
    const r = rowAbs ? Number(row) - 1 : Number(row) - 1 + dRow;
    if (c < 0 || r < 0) return '#REF!';
    return `${colAbs}${colName(c)}${rowAbs}${r + 1}`;
  });
}
