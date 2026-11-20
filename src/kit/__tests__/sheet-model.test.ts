import { describe, expect, it } from 'vitest';
import { colIndex, colName, evaluate, FormulaError, parse, parseAddress, shiftFormula } from '../sheet/formula';
import { SheetModel } from '../sheet/model';

const calc = (src: string, cells: Record<string, number | string> = {}) =>
  evaluate(parse(src), { get: r => cells[r] ?? '', rows: 100, cols: 26 });
const code = (v: unknown) => (v instanceof FormulaError ? v.code : v);

describe('formula', () => {
  it('converts addresses', () => {
    expect([colIndex('A'), colIndex('Z'), colIndex('AA'), colIndex('AZ')]).toEqual([0, 25, 26, 51]);
    expect([colName(0), colName(25), colName(26), colName(51)]).toEqual(['A', 'Z', 'AA', 'AZ']);
    expect(parseAddress('$C$12')).toEqual({ row: 11, col: 2 });
    expect(parseAddress('A0')).toBeNull();
  });

  it('follows precedence and associativity', () => {
    expect(calc('1+2*3')).toBe(7);
    expect(calc('(1+2)*3')).toBe(9);
    expect(calc('2^3^2')).toBe(512);
    expect(calc('-2^2')).toBe(-4);
    expect(calc('10/4-1')).toBe(1.5);
    expect(calc('"a"&1+1')).toBe('a2');
    expect(calc('1+1=2')).toBe(true);
    expect(calc('"Athens"<>"athens"')).toBe(false);
  });

  it('reads references and ranges, and has the usual functions', () => {
    const cells = { A1: 10, A2: 20, A3: 'text', B1: 4 };
    expect(calc('A1+B1', cells)).toBe(14);
    expect(calc('SUM(A1:A3)', cells)).toBe(30);
    expect(calc('AVERAGE(A1:A2, B1)', cells)).toBe(34 / 3);
    expect(calc('MAX(A1:B2)', cells)).toBe(20);
    expect(calc('COUNT(A1:A3)', cells)).toBe(2);
    expect(calc('IF(A1>B1, "more", "less")', cells)).toBe('more');
    expect(calc('ROUND(2.345, 2)', cells)).toBe(2.35);
    expect(calc('CONCAT("x", A1, TRUE)', cells)).toBe('x10TRUE');
    expect(calc('sum($A$1:A2)', cells)).toBe(30);
  });

  it('returns errors as values', () => {
    expect(code(calc('1/0'))).toBe('#DIV/0!');
    expect(code(calc('NOPE(1)'))).toBe('#NAME?');
    expect(code(calc('"a"*2'))).toBe('#VALUE!');
    expect(code(calc('ZZ999+1'))).toBe('#REF!');
    expect(code(calc('SUM(A1:ZZ9)'))).toBe('#REF!');
    expect(() => parse('1+')).toThrow(FormulaError);
    expect(() => parse('(1')).toThrow(FormulaError);
  });

  it('shifts relative references, keeping $ anchors and strings', () => {
    expect(shiftFormula('=A1+$B$1+C$2+$D3', 1, 1)).toBe('=B2+$B$1+D$2+$D4');
    expect(shiftFormula('=SUM(A1:A3)*"A1"', 2, 0)).toBe('=SUM(A3:A5)*"A1"');
    expect(shiftFormula('=A1', -1, 0)).toBe('=#REF!');
    expect(shiftFormula('plain', 1, 1)).toBe('plain');
  });
});

describe('SheetModel', () => {
  it('recalculates dependents in order, and only what changed', () => {
    const m = new SheetModel(20, 5);
    m.set({ A1: '2', A2: '3', A3: '=A1*A2', A4: '=A3+A1', B1: '=SUM(A1:A4)' });
    expect(m.getValue('A3')).toBe(6);
    expect(m.getValue('A4')).toBe(8);
    expect(m.getValue('B1')).toBe(19);
    const changed = m.set({ A2: '4' });
    expect([...changed].sort()).toEqual(['A2', 'A3', 'A4', 'B1']);
    expect(m.getValue('B1')).toBe(24);
    expect(m.set({ C1: 'hello' })).toEqual(new Set(['C1']));
    expect(m.getValue('C1')).toBe('hello');
    expect(m.getRaw('A3')).toBe('=A1*A2');
  });

  it('detects cycles, and recovers when they are broken', () => {
    const m = new SheetModel(10, 5);
    m.set({ A1: '=B1+1', B1: '=A1+1', C1: '=A1*2', D1: '5' });
    expect(code(m.getValue('A1'))).toBe('#CYCLE!');
    expect(code(m.getValue('B1'))).toBe('#CYCLE!');
    expect(code(m.getValue('C1'))).toBe('#CYCLE!');
    expect(m.getValue('D1')).toBe(5);
    m.set({ B1: '1' });
    expect(m.getValue('A1')).toBe(2);
    expect(m.getValue('C1')).toBe(4);
    m.set({ A1: '=A1' });
    expect(code(m.getValue('A1'))).toBe('#CYCLE!');
  });

  it('clears cells and treats blanks as zero in arithmetic', () => {
    const m = new SheetModel(10, 5);
    m.set({ A1: '7', A2: '=A1+1' });
    m.set({ A1: '' });
    expect(m.getValue('A1')).toBe('');
    expect(m.getValue('A2')).toBe(1);
    expect(m.entries()).toEqual([['A2', '=A1+1']]);
    m.set({ B1: '=bad(' });
    expect(code(m.getValue('B1'))).toBe('#ERROR!');
  });
});

describe('formula edge cases', () => {
  it('handles text comparisons, unary plus, booleans, blanks and missing arguments', () => {
    expect(calc('"b">"a"')).toBe(true);
    expect(calc('"a"<="a"')).toBe(true);
    expect(calc('2>=3')).toBe(false);
    expect(calc('1<2')).toBe(true);
    expect(calc('+5')).toBe(5);
    expect(calc('TRUE+1')).toBe(2);
    expect(calc('A9+1')).toBe(1); // blank is zero
    expect(calc('ROUND(2.5)')).toBe(3);
    expect(calc('ABS(-3)')).toBe(3);
    expect(code(calc('ABS("x")'))).toBe('#VALUE!');
    expect(code(calc('ROUND("x", 1)'))).toBe('#VALUE!');
    expect(code(calc('ROUND(1, "x")'))).toBe('#VALUE!');
    expect(calc('MIN()')).toBe(0);
    expect(calc('MAX()')).toBe(0);
    expect(code(calc('AVERAGE()'))).toBe('#DIV/0!');
    expect(calc('IF(0)')).toBe(false);
    expect(calc('IF(1)')).toBe(true);
    expect(calc('IF("", 1, 2)')).toBe(2);
    expect(code(calc('IF(1/0, 1, 2)'))).toBe('#DIV/0!');
    expect(code(calc('CONCAT(1/0)'))).toBe('#DIV/0!');
    expect(code(calc('SUM(1/0)'))).toBe('#DIV/0!');
    expect(code(calc('SUM("x")'))).toBe('#VALUE!');
    expect(code(calc('-"x"'))).toBe('#VALUE!');
    expect(code(calc('(1/0)+1'))).toBe('#DIV/0!');
    expect(code(calc('1+(1/0)'))).toBe('#DIV/0!');
    expect(code(calc('"x"-1'))).toBe('#VALUE!');
    expect(code(calc('1-"x"'))).toBe('#VALUE!');
    expect(code(calc('ABS(A1:A2)'))).toBe('#VALUE!');
    expect(calc('"a""b"')).toBe('a"b');
    expect(calc('.5*2')).toBe(1);
    expect(calc('1e2')).toBe(100);
    const errs = { A1: new FormulaError('#REF!') as unknown as number };
    expect(code(calc('SUM(A1:A2)', errs))).toBe('#REF!');
  });

  it('rejects malformed formulas', () => {
    for (const bad of ['', ')', 'SUM(1', 'A1:', 'A1:2', '1 2', '*', '#', 'SUM(1,)']) expect(() => parse(bad)).toThrow(FormulaError);
    expect(new FormulaError('#NAME?').toString()).toBe('#NAME?');
  });
});
