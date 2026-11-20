/**
 * SheetModel: cell contents, computed values, and the dependency graph
 * between them.
 *
 * Setting cells recalculates only what depends on them, in topological
 * order. Cells in a reference cycle (and everything that reads them) get
 * `#CYCLE!` instead of looping.
 *
 * @module kit/sheet/model
 */

import { evaluate, FormulaError, parse, references, type CellValue, type Node } from './formula';

export class SheetModel {
  private raw = new Map<string, string>();
  private values = new Map<string, CellValue>();
  private asts = new Map<string, Node | FormulaError>();
  /** cell → the cells it reads */
  private deps = new Map<string, Set<string>>();
  /** cell → the cells that read it */
  private readers = new Map<string, Set<string>>();

  constructor(readonly rows: number, readonly cols: number) {}

  /** What was typed into a cell ('' if empty). */
  getRaw(addr: string): string {
    return this.raw.get(addr) ?? '';
  }

  /** A cell's computed value ('' if empty). */
  getValue(addr: string): CellValue {
    return this.values.get(addr) ?? '';
  }

  /** Every non-empty cell's raw content. */
  entries(): Array<[string, string]> {
    return [...this.raw.entries()];
  }

  /** Set cells (raw content; '' clears). Returns every cell whose value changed. */
  set(changes: Record<string, string>): Set<string> {
    const touched = new Set<string>();
    for (const [addr, value] of Object.entries(changes)) {
      if (value === '') this.raw.delete(addr);
      else this.raw.set(addr, value);
      this.asts.delete(addr);
      this.link(addr);
      touched.add(addr);
    }
    return this.recalculate(touched);
  }

  private parsed(addr: string): Node | FormulaError | null {
    const raw = this.getRaw(addr);
    if (!raw.startsWith('=')) return null;
    let ast = this.asts.get(addr);
    if (!ast) {
      try {
        ast = raw.includes('#REF!') ? new FormulaError('#REF!') : parse(raw.slice(1));
      } catch (e) {
        ast = e instanceof FormulaError ? e : new FormulaError('#ERROR!');
      }
      this.asts.set(addr, ast);
    }
    return ast;
  }

  /** Update the graph edges for a cell. */
  private link(addr: string): void {
    for (const dep of this.deps.get(addr) ?? []) this.readers.get(dep)?.delete(addr);
    const ast = this.parsed(addr);
    const refs = ast && !(ast instanceof FormulaError) ? new Set(references(ast, this)) : new Set<string>();
    this.deps.set(addr, refs);
    for (const dep of refs) {
      if (!this.readers.has(dep)) this.readers.set(dep, new Set());
      this.readers.get(dep)!.add(addr);
    }
  }

  private recalculate(start: Set<string>): Set<string> {
    // Everything downstream of the changed cells.
    const affected = new Set<string>();
    const queue = [...start];
    while (queue.length) {
      const cell = queue.pop()!;
      if (affected.has(cell)) continue;
      affected.add(cell);
      for (const r of this.readers.get(cell) ?? []) queue.push(r);
    }
    // Kahn's algorithm over the affected subgraph.
    const pending = new Map<string, number>();
    for (const cell of affected) {
      let n = 0;
      for (const dep of this.deps.get(cell) ?? []) if (affected.has(dep)) n++;
      pending.set(cell, n);
    }
    const ready = [...affected].filter(c => pending.get(c) === 0);
    const changed = new Set<string>();
    const done = new Set<string>();
    while (ready.length) {
      const cell = ready.pop()!;
      done.add(cell);
      if (this.compute(cell)) changed.add(cell);
      for (const r of this.readers.get(cell) ?? []) {
        if (!affected.has(r)) continue;
        const left = pending.get(r)! - 1;
        pending.set(r, left);
        if (left === 0) ready.push(r);
      }
    }
    // Whatever is left is in a cycle, or reads one.
    for (const cell of affected) {
      if (done.has(cell)) continue;
      const before = this.values.get(cell);
      const error = new FormulaError('#CYCLE!');
      this.values.set(cell, error);
      if (!(before instanceof FormulaError && before.code === '#CYCLE!')) changed.add(cell);
    }
    return changed;
  }

  /** Compute one cell; returns whether its value changed. */
  private compute(addr: string): boolean {
    const before = this.values.get(addr);
    let value: CellValue;
    const ast = this.parsed(addr);
    if (ast === null) {
      const raw = this.getRaw(addr);
      const n = raw.trim() === '' ? NaN : Number(raw.replace(/,/g, ''));
      value = raw === '' ? '' : Number.isFinite(n) ? n : raw.toUpperCase() === 'TRUE' ? true : raw.toUpperCase() === 'FALSE' ? false : raw;
    } else if (ast instanceof FormulaError) {
      value = ast;
    } else {
      value = evaluate(ast, { get: ref => this.getValue(ref), rows: this.rows, cols: this.cols });
    }
    if (value === '') this.values.delete(addr);
    else this.values.set(addr, value);
    const same = before instanceof FormulaError && value instanceof FormulaError ? before.code === value.code : before === value || (before === undefined && value === '');
    return !same;
  }
}
