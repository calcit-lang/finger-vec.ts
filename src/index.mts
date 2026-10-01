/**
 * FingerVec: a persistent vector for the Calcit runtime.
 *
 * Layout: a front buffer, a relaxed B-tree of chunks, and a back buffer.
 * Buffers make both ends cheap; the tree keeps indexing, slicing and
 * concatenation logarithmic. Lists with at most 32 elements live in one buffer.
 * Every operation returns a new value and shares structure with its input.
 */

import {
  CHUNK,
  BRANCH,
  Branch,
  Leaf,
  Tree,
  buildFromLeaves,
  checkTree,
  chunkValues,
  forEachLeaf,
  formatTree,
  leftmostLeaf,
  normalizeRoot,
  rightmostLeaf,
  someLeaf,
  treeAssoc,
  treeConcat,
  treeFirst,
  treeGet,
  treeLast,
  treeMap,
  treeSplit,
} from "./tree.mjs";

export { CHUNK, BRANCH };

const EMPTY: readonly never[] = Object.freeze([]) as readonly never[];

/**
 * Each value records whether its back-buffer array was created by this module
 * (`bo`, "back owned"). A value whose back buffer ends at the array's current
 * length may then append in place: other values sharing the array never read
 * past their own end index. Leaf arrays and caller arrays are never owned, so
 * tree nodes and inputs are never mutated.
 */

export class FingerVec<T> {
  /** front buffer is data[fs..fe) */
  private constructor(
    private readonly fd: readonly T[],
    private readonly fs: number,
    private readonly fe: number,
    private readonly tree: Tree<T> | null,
    /** back buffer is bd[bs..be) */
    private readonly bd: readonly T[],
    private readonly bs: number,
    private readonly be: number,
    /** total length, cached */
    readonly size: number,
    private readonly bo: boolean = false,
  ) {}

  private static readonly EMPTY_VEC: FingerVec<never> = new FingerVec<never>(EMPTY, 0, 0, null, EMPTY, 0, 0, 0);

  static empty<T>(): FingerVec<T> {
    return FingerVec.EMPTY_VEC as unknown as FingerVec<T>;
  }

  static from<T>(xs: Iterable<T> | ArrayLike<T>): FingerVec<T> {
    const arr = Array.isArray(xs) ? (xs as T[]) : Array.from(xs as Iterable<T>);
    return FingerVec.fromRange(arr, 0, arr.length);
  }

  /** Build from `xs[from..to)` without copying the source first. */
  static fromRange<T>(xs: readonly T[], from: number, to: number): FingerVec<T> {
    const n = to - from;
    if (n <= 0) return FingerVec.empty();
    if (n <= CHUNK) return new FingerVec<T>(EMPTY, 0, 0, null, xs.slice(from, to), 0, n, n);
    return new FingerVec<T>(EMPTY, 0, 0, buildFromLeaves<T>(chunkValues(xs, from, to)), EMPTY, 0, 0, n);
  }

  static of<T>(...xs: T[]): FingerVec<T> {
    return FingerVec.fromRange(xs, 0, xs.length);
  }

  private static make<T>(fd: readonly T[], fs: number, fe: number, tree: Tree<T> | null, bd: readonly T[], bs: number, be: number, bo = false): FingerVec<T> {
    const size = fe - fs + (tree == null ? 0 : tree.len) + (be - bs);
    if (size === 0) return FingerVec.empty();
    if (fs === fe) {
      fd = EMPTY;
      fs = fe = 0;
    }
    if (bs === be) {
      bd = EMPTY;
      bs = be = 0;
    }
    return new FingerVec(fd, fs, fe, tree, bd, bs, be, size, bo && bd !== EMPTY);
  }

  get length(): number {
    return this.size;
  }

  len(): number {
    return this.size;
  }

  isEmpty(): boolean {
    return this.size === 0;
  }

  /** Height of the middle tree plus one, 0 without a tree. */
  depth(): number {
    return this.tree == null ? 0 : this.tree.height + 1;
  }

  get(idx: number): T | undefined {
    if (idx < 0 || idx >= this.size) return undefined;
    const f = this.fe - this.fs;
    if (idx < f) return this.fd[this.fs + idx];
    idx -= f;
    const t = this.tree;
    if (t != null) {
      const tl = t.len;
      if (idx < tl) return treeGet(t, idx);
      idx -= tl;
    }
    return this.bd[this.bs + idx];
  }

  first(): T | undefined {
    if (this.fe > this.fs) return this.fd[this.fs];
    if (this.tree != null) return treeFirst(this.tree);
    return this.be > this.bs ? this.bd[this.bs] : undefined;
  }

  last(): T | undefined {
    if (this.be > this.bs) return this.bd[this.be - 1];
    if (this.tree != null) return treeLast(this.tree);
    return this.fe > this.fs ? this.fd[this.fe - 1] : undefined;
  }

  pushRight(x: T): FingerVec<T> {
    const blen = this.be - this.bs;
    if (blen >= CHUNK) {
      const leaf = new Leaf(this.bd.slice(this.bs, this.be));
      const tree = this.tree == null ? leaf : treeConcat(this.tree, leaf);
      return FingerVec.make(this.fd, this.fs, this.fe, tree, [x], 0, 1, true);
    }
    if (this.bo && this.be === this.bd.length) {
      (this.bd as T[]).push(x);
      return new FingerVec(this.fd, this.fs, this.fe, this.tree, this.bd, this.bs, this.be + 1, this.size + 1, true);
    }
    const next = this.bd.slice(this.bs, this.be);
    next.push(x);
    return FingerVec.make(this.fd, this.fs, this.fe, this.tree, next, 0, next.length, true);
  }

  pushLeft(x: T): FingerVec<T> {
    const flen = this.fe - this.fs;
    // a small list lives in the back buffer so it stays one chunk
    if (flen === 0 && this.tree == null && this.be - this.bs < CHUNK) {
      const next = [x];
      for (let i = this.bs; i < this.be; i++) next.push(this.bd[i]);
      return FingerVec.make(EMPTY, 0, 0, null, next, 0, next.length);
    }
    if (flen >= CHUNK) {
      const leaf = new Leaf(this.fd.slice(this.fs, this.fe));
      const tree = this.tree == null ? leaf : treeConcat(leaf, this.tree);
      return FingerVec.make([x], 0, 1, tree, this.bd, this.bs, this.be);
    }
    const next = [x];
    for (let i = this.fs; i < this.fe; i++) next.push(this.fd[i]);
    return FingerVec.make(next, 0, next.length, this.tree, this.bd, this.bs, this.be);
  }

  append(x: T): FingerVec<T> {
    return this.pushRight(x);
  }

  prepend(x: T): FingerVec<T> {
    return this.pushLeft(x);
  }

  /** Without the first element; empty stays empty. */
  dropLeft(): FingerVec<T> {
    if (this.fe > this.fs) return FingerVec.make(this.fd, this.fs + 1, this.fe, this.tree, this.bd, this.bs, this.be);
    if (this.tree != null) {
      const leaf = leftmostLeaf(this.tree);
      const [, rest] = treeSplit(this.tree, leaf.len);
      return FingerVec.make(leaf.items, 1, leaf.len, rest == null ? null : normalizeRoot(rest), this.bd, this.bs, this.be);
    }
    if (this.be > this.bs) return FingerVec.make(EMPTY, 0, 0, null, this.bd, this.bs + 1, this.be);
    return this;
  }

  /** Without the last element; empty stays empty. */
  dropRight(): FingerVec<T> {
    if (this.be > this.bs) return FingerVec.make(this.fd, this.fs, this.fe, this.tree, this.bd, this.bs, this.be - 1, this.bo);
    if (this.tree != null) {
      const leaf = rightmostLeaf(this.tree);
      const [rest] = treeSplit(this.tree, this.tree.len - leaf.len);
      return FingerVec.make(this.fd, this.fs, this.fe, rest == null ? null : normalizeRoot(rest), leaf.items, 0, leaf.len - 1);
    }
    if (this.fe > this.fs) return FingerVec.make(this.fd, this.fs, this.fe - 1, null, EMPTY, 0, 0);
    return this;
  }

  rest(): FingerVec<T> {
    if (this.size === 0) throw new Error("Cannot call rest on empty list");
    return this.dropLeft();
  }

  butlast(): FingerVec<T> {
    if (this.size === 0) throw new Error("Cannot call butlast on empty list");
    return this.dropRight();
  }

  assoc(idx: number, x: T): FingerVec<T> {
    if (idx < 0 || idx >= this.size || !Number.isInteger(idx)) throw new Error(`Index ${idx} out of range for list of size ${this.size}`);
    const f = this.fe - this.fs;
    if (idx < f) {
      const next = this.fd.slice(this.fs, this.fe);
      next[idx] = x;
      return FingerVec.make(next, 0, next.length, this.tree, this.bd, this.bs, this.be);
    }
    let i = idx - f;
    const t = this.tree;
    if (t != null) {
      if (i < t.len) return FingerVec.make(this.fd, this.fs, this.fe, treeAssoc(t, i, x), this.bd, this.bs, this.be);
      i -= t.len;
    }
    const next = this.bd.slice(this.bs, this.be);
    next[i] = x;
    return FingerVec.make(this.fd, this.fs, this.fe, this.tree, next, 0, next.length);
  }

  /** Split into [0, idx) and [idx, size). */
  split(idx: number): [FingerVec<T>, FingerVec<T>] {
    if (idx <= 0) return [FingerVec.empty(), this];
    if (idx >= this.size) return [this, FingerVec.empty()];
    const f = this.fe - this.fs;
    if (idx <= f) {
      return [FingerVec.fromRange(this.fd, this.fs, this.fs + idx), FingerVec.make(this.fd, this.fs + idx, this.fe, this.tree, this.bd, this.bs, this.be)];
    }
    const tl = this.tree == null ? 0 : this.tree.len;
    if (idx <= f + tl) {
      const [l, r] = treeSplit(this.tree as Tree<T>, idx - f);
      const left = FingerVec.make(this.fd, this.fs, this.fe, l == null ? null : normalizeRoot(l), EMPTY, 0, 0);
      const right = FingerVec.make(EMPTY, 0, 0, r == null ? null : normalizeRoot(r), this.bd, this.bs, this.be);
      return [left.rebalanced(), right.rebalanced()];
    }
    const k = idx - f - tl;
    return [FingerVec.make(this.fd, this.fs, this.fe, this.tree, this.bd, this.bs, this.bs + k), FingerVec.fromRange(this.bd, this.bs + k, this.be)];
  }

  /** Elements in [start, end); `end` defaults to the size. */
  slice(start: number, end: number = this.size): FingerVec<T> {
    if (end > this.size) throw new Error(`Slice range too large ${end} for list of size ${this.size}`);
    if (start < 0 || start > end) throw new Error(`Invalid slice range ${start}..${end}`);
    if (start === end) return FingerVec.empty();
    if (start === 0 && end === this.size) return this;
    return this.split(start)[1].split(end - start)[0];
  }

  take(n: number): FingerVec<T> {
    return this.slice(0, n);
  }

  skip(n: number): FingerVec<T> {
    return this.slice(n, this.size);
  }

  concat(other: FingerVec<T>): FingerVec<T> {
    if (other.size === 0) return this;
    if (this.size === 0) return other;
    if (other.size <= CHUNK) {
      let next: FingerVec<T> = this;
      other.forEach((x) => {
        next = next.pushRight(x);
      });
      return next;
    }
    if (this.size <= CHUNK) {
      const items = this.toArray();
      let next = other;
      for (let i = items.length - 1; i >= 0; i--) next = next.pushLeft(items[i]);
      return next;
    }
    let leftTree = this.tree;
    if (this.be > this.bs) {
      const leaf = new Leaf(this.bd.slice(this.bs, this.be));
      leftTree = leftTree == null ? leaf : treeConcat(leftTree, leaf);
    }
    let rightTree = other.tree;
    if (other.fe > other.fs) {
      const leaf = new Leaf(other.fd.slice(other.fs, other.fe));
      rightTree = rightTree == null ? leaf : treeConcat(leaf, rightTree);
    }
    let tree: Tree<T> | null;
    if (leftTree == null) tree = rightTree;
    else if (rightTree == null) tree = leftTree;
    else tree = treeConcat(leftTree, rightTree);
    return FingerVec.make(this.fd, this.fs, this.fe, tree, other.bd, other.bs, other.be).rebalanced();
  }

  static concatAll<T>(...xs: FingerVec<T>[]): FingerVec<T> {
    let acc = FingerVec.empty<T>();
    for (const x of xs) acc = acc.concat(x);
    return acc;
  }

  /** Insert so that `x` ends up at position `pos` (0..=size). */
  insertAt(pos: number, x: T): FingerVec<T> {
    if (pos < 0 || pos > this.size) throw new Error(`Insert position ${pos} out of range for list of size ${this.size}`);
    if (pos === 0) return this.pushLeft(x);
    if (pos === this.size) return this.pushRight(x);
    const [l, r] = this.split(pos);
    return l.pushRight(x).concat(r);
  }

  /** Same contract as ternary-tree `insert`: before or after an existing index. */
  insert(idx: number, x: T, after = false): FingerVec<T> {
    if (this.size === 0) {
      if (idx === 0) return this.pushRight(x);
      throw new Error("Inserting into empty list, but index is not 0");
    }
    if (idx < 0 || idx >= this.size) throw new Error(`Index ${idx} out of range for list of size ${this.size}`);
    return this.insertAt(after ? idx + 1 : idx, x);
  }

  assocBefore(idx: number, x: T): FingerVec<T> {
    return this.insert(idx, x, false);
  }

  assocAfter(idx: number, x: T): FingerVec<T> {
    return this.insert(idx, x, true);
  }

  dissoc(idx: number): FingerVec<T> {
    if (idx < 0 || idx >= this.size) throw new Error(`Index ${idx} out of range for list of size ${this.size}`);
    if (idx === 0) return this.dropLeft();
    if (idx === this.size - 1) return this.dropRight();
    const [l, r] = this.split(idx);
    return l.concat(r.dropLeft());
  }

  reverse(): FingerVec<T> {
    const xs = this.toArray();
    xs.reverse();
    return FingerVec.fromRange(xs, 0, xs.length);
  }

  map<V>(f: (x: T) => V): FingerVec<V> {
    const front = this.fd.slice(this.fs, this.fe).map((x) => f(x));
    const tree = this.tree == null ? null : treeMap(this.tree, f);
    const back = this.bd.slice(this.bs, this.be).map((x) => f(x));
    return FingerVec.make<V>(front, 0, front.length, tree, back, 0, back.length);
  }

  /** Visit elements in order. */
  forEach(f: (x: T, idx: number) => void): void {
    let idx = 0;
    for (let i = this.fs; i < this.fe; i++) f(this.fd[i], idx++);
    if (this.tree != null) {
      forEachLeaf(this.tree, (items) => {
        for (let i = 0; i < items.length; i++) f(items[i], idx++);
      });
    }
    for (let i = this.bs; i < this.be; i++) f(this.bd[i], idx++);
  }

  /** Visit elements until `f` returns true; returns the index or -1. */
  findIndex(f: (x: T) => boolean): number {
    let idx = 0;
    for (let i = this.fs; i < this.fe; i++, idx++) if (f(this.fd[i])) return idx;
    if (this.tree != null) {
      let found = -1;
      someLeaf(this.tree, (items) => {
        for (let i = 0; i < items.length; i++, idx++) {
          if (f(items[i])) {
            found = idx;
            return true;
          }
        }
        return false;
      });
      if (found >= 0) return found;
    }
    for (let i = this.bs; i < this.be; i++, idx++) if (f(this.bd[i])) return idx;
    return -1;
  }

  indexOf(x: T, eq: (a: T, b: T) => boolean = Object.is): number {
    return this.findIndex((y) => eq(x, y));
  }

  toArray(): T[] {
    const out = new Array<T>(this.size);
    let idx = 0;
    for (let i = this.fs; i < this.fe; i++) out[idx++] = this.fd[i];
    if (this.tree != null) {
      forEachLeaf(this.tree, (items) => {
        for (let i = 0; i < items.length; i++) out[idx++] = items[i];
      });
    }
    for (let i = this.bs; i < this.be; i++) out[idx++] = this.bd[i];
    return out;
  }

  *[Symbol.iterator](): Generator<T> {
    for (let i = this.fs; i < this.fe; i++) yield this.fd[i];
    if (this.tree != null) {
      // explicit stack avoids nested generators
      const stack: [readonly Tree<T>[], number][] = [];
      let node: Tree<T> = this.tree;
      while (true) {
        if (node instanceof Leaf) {
          const items = node.items;
          for (let i = 0; i < items.length; i++) yield items[i];
        } else {
          stack.push([node.children, 0]);
        }
        let next: Tree<T> | null = null;
        while (stack.length > 0) {
          const top = stack[stack.length - 1];
          if (top[1] < top[0].length) {
            next = top[0][top[1]];
            top[1] += 1;
            break;
          }
          stack.pop();
        }
        if (next == null) break;
        node = next;
      }
    }
    for (let i = this.bs; i < this.be; i++) yield this.bd[i];
  }

  items(): Generator<T> {
    return this[Symbol.iterator]();
  }

  equals(other: FingerVec<T>, eq: (a: T, b: T) => boolean = Object.is): boolean {
    if (this === other) return true;
    if (this.size !== other.size) return false;
    const a = this[Symbol.iterator]();
    const b = other[Symbol.iterator]();
    while (true) {
      const x = a.next();
      const y = b.next();
      if (x.done) return true;
      if (!eq(x.value, y.value as T)) return false;
    }
  }

  /** Throws when internal invariants are broken. Intended for tests. */
  checkStructure(): void {
    if (this.fe - this.fs > CHUNK || this.be - this.bs > CHUNK) throw new Error("buffer longer than one chunk");
    if (this.tree != null) {
      checkTree(this.tree);
      const max = maxHeight(this.size);
      if (this.tree.height > max) throw new Error(`tree height ${this.tree.height} exceeds ${max} for ${this.size} items`);
    }
    let count = 0;
    this.forEach(() => count++);
    if (count !== this.size) throw new Error(`cached size ${this.size} differs from ${count}`);
  }

  /** Debug view: `{front} tree {back}`. */
  formatInline(show: (x: T) => string = String): string {
    const front = this.fd.slice(this.fs, this.fe).map(show).join(" ");
    const back = this.bd.slice(this.bs, this.be).map(show).join(" ");
    const tree = this.tree == null ? "_" : formatTree(this.tree, show);
    return `{${front}} ${tree} {${back}}`;
  }

  toString(): string {
    return `(FingerVec ${this.toArray().map(String).join(" ")})`;
  }

  /** Rebuild the tree when seams have made it taller than needed. */
  private rebalanced(): FingerVec<T> {
    const t = this.tree;
    if (t == null || t.height <= maxHeight(this.size)) return this;
    const items: T[] = [];
    forEachLeaf(t, (xs) => {
      for (let i = 0; i < xs.length; i++) items.push(xs[i]);
    });
    return FingerVec.make(this.fd, this.fs, this.fe, buildFromLeaves<T>(chunkValues(items)), this.bd, this.bs, this.be);
  }
}

/** Height allowed for `len` elements: nodes a quarter full, plus one level. */
function maxHeight(len: number): number {
  let chunks = Math.max(1, Math.ceil(len / (CHUNK / 4)));
  let h = 0;
  while (chunks > 1) {
    chunks = Math.ceil(chunks / (BRANCH / 4));
    h += 1;
  }
  return h + 1;
}

