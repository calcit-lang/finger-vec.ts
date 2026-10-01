/**
 * Relaxed B-tree of chunks. All leaves sit at the same depth; branches keep
 * cumulative sizes so they may hold fewer than BRANCH children.
 */

export const CHUNK = 32;
export const BRANCH = 32;

export class Leaf<T> {
  readonly height = 0;
  constructor(public readonly items: readonly T[]) {}
  get len(): number {
    return this.items.length;
  }
}

export class Branch<T> {
  constructor(
    public readonly height: number,
    /** ends[i] = number of elements in children[0..=i] */
    public readonly ends: readonly number[],
    public readonly children: readonly Tree<T>[],
  ) {}
  get len(): number {
    return this.ends[this.ends.length - 1];
  }
}

export type Tree<T> = Leaf<T> | Branch<T>;

export function makeBranch<T>(height: number, children: Tree<T>[]): Branch<T> {
  const ends = new Array<number>(children.length);
  let acc = 0;
  for (let i = 0; i < children.length; i++) {
    acc += children[i].len;
    ends[i] = acc;
  }
  return new Branch(height, ends, children);
}

/** Index of the child holding element `idx`. */
export function locate(ends: readonly number[], idx: number): number {
  let lo = 0;
  let hi = ends.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ends[mid] <= idx) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function normalizeRoot<T>(t: Tree<T>): Tree<T> {
  while (t instanceof Branch && t.children.length === 1) {
    t = t.children[0];
  }
  return t;
}

export function treeGet<T>(t: Tree<T>, idx: number): T {
  let node: Tree<T> = t;
  while (node instanceof Branch) {
    const i = locate(node.ends, idx);
    if (i > 0) idx -= node.ends[i - 1];
    node = node.children[i];
  }
  return node.items[idx];
}

export function treeFirst<T>(t: Tree<T>): T {
  let node: Tree<T> = t;
  while (node instanceof Branch) node = node.children[0];
  return node.items[0];
}

export function treeLast<T>(t: Tree<T>): T {
  let node: Tree<T> = t;
  while (node instanceof Branch) node = node.children[node.children.length - 1];
  return node.items[node.items.length - 1];
}

export function leftmostLeaf<T>(t: Tree<T>): Leaf<T> {
  let node: Tree<T> = t;
  while (node instanceof Branch) node = node.children[0];
  return node;
}

export function rightmostLeaf<T>(t: Tree<T>): Leaf<T> {
  let node: Tree<T> = t;
  while (node instanceof Branch) node = node.children[node.children.length - 1];
  return node;
}

export function treeAssoc<T>(t: Tree<T>, idx: number, item: T): Tree<T> {
  if (t instanceof Leaf) {
    const next = t.items.slice();
    next[idx] = item;
    return new Leaf(next);
  }
  const i = locate(t.ends, idx);
  const offset = i > 0 ? t.ends[i - 1] : 0;
  const children = t.children.slice();
  children[i] = treeAssoc(t.children[i], idx - offset, item);
  return new Branch(t.height, t.ends, children);
}

/** Split into [0, idx) and [idx, len). */
export function treeSplit<T>(t: Tree<T>, idx: number): [Tree<T> | null, Tree<T> | null] {
  if (idx <= 0) return [null, t];
  if (idx >= t.len) return [t, null];
  if (t instanceof Leaf) {
    return [new Leaf(t.items.slice(0, idx)), new Leaf(t.items.slice(idx))];
  }
  const i = locate(t.ends, idx);
  const offset = i > 0 ? t.ends[i - 1] : 0;
  const [cl, cr] = treeSplit(t.children[i], idx - offset);
  const left = t.children.slice(0, i);
  if (cl != null) left.push(cl);
  const right: Tree<T>[] = [];
  if (cr != null) right.push(cr);
  for (let k = i + 1; k < t.children.length; k++) right.push(t.children[k]);
  return [left.length > 0 ? makeBranch(t.height, left) : null, right.length > 0 ? makeBranch(t.height, right) : null];
}

export function treeConcat<T>(a: Tree<T>, b: Tree<T>): Tree<T> {
  const parts = join(a, b);
  if (parts.length === 1) return normalizeRoot(parts[0]);
  return makeBranch(parts[0].height + 1, parts);
}

function join<T>(a: Tree<T>, b: Tree<T>): Tree<T>[] {
  const ha = a.height;
  const hb = b.height;
  if (ha > hb) {
    const ab = a as Branch<T>;
    const last = ab.children.length - 1;
    const mid = join(ab.children[last], b);
    const children = ab.children.slice(0, last);
    const seam = children.length;
    for (const m of mid) children.push(m);
    mergeSeam(children, Math.max(0, seam - 1), seam + mid.length);
    return pack(ha, children);
  } else if (ha < hb) {
    const bb = b as Branch<T>;
    const mid = join(a, bb.children[0]);
    const children = mid.slice();
    for (let k = 1; k < bb.children.length; k++) children.push(bb.children[k]);
    mergeSeam(children, 0, mid.length + 1);
    return pack(hb, children);
  } else if (a instanceof Leaf && b instanceof Leaf) {
    return joinLeaves(a, b);
  } else {
    const ab = a as Branch<T>;
    const bb = b as Branch<T>;
    const la = ab.children.length - 1;
    const mid = join(ab.children[la], bb.children[0]);
    const children = ab.children.slice(0, la);
    const seam = children.length;
    for (const m of mid) children.push(m);
    for (let k = 1; k < bb.children.length; k++) children.push(bb.children[k]);
    mergeSeam(children, Math.max(0, seam - 1), seam + mid.length + 1);
    return pack(ha, children);
  }
}

function joinLeaves<T>(x: Leaf<T>, y: Leaf<T>): Tree<T>[] {
  const total = x.len + y.len;
  if (total <= CHUNK) {
    return [new Leaf(x.items.concat(y.items))];
  }
  if (x.len < CHUNK / 2 || y.len < CHUNK / 2) {
    const all = x.items.concat(y.items);
    const half = total >> 1;
    return [new Leaf(all.slice(0, half)), new Leaf(all.slice(half))];
  }
  return [x, y];
}

/** Merge adjacent nodes in children[from..to) whose contents fit in one node. */
function mergeSeam<T>(children: Tree<T>[], from: number, to: number): void {
  let i = from;
  let end = Math.min(to, children.length);
  while (i + 1 < end) {
    const x = children[i];
    const y = children[i + 1];
    let merged: Tree<T> | null = null;
    if (x instanceof Leaf && y instanceof Leaf) {
      if (x.len + y.len <= CHUNK) merged = new Leaf(x.items.concat(y.items));
    } else if (x instanceof Branch && y instanceof Branch) {
      if (x.children.length + y.children.length <= BRANCH) merged = makeBranch(x.height, x.children.concat(y.children));
    }
    if (merged != null) {
      children[i] = merged;
      children.splice(i + 1, 1);
      end -= 1;
    } else {
      i += 1;
    }
  }
}

function pack<T>(height: number, children: Tree<T>[]): Tree<T>[] {
  if (children.length <= BRANCH) return [makeBranch(height, children)];
  const half = children.length >> 1;
  return [makeBranch(height, children.slice(0, half)), makeBranch(height, children.slice(half))];
}

/** Build a balanced tree from leaves. */
export function buildFromLeaves<T>(level: Tree<T>[]): Tree<T> | null {
  if (level.length === 0) return null;
  let height = 0;
  while (level.length > 1) {
    height += 1;
    const count = level.length;
    const groups = Math.ceil(count / BRANCH);
    const base = Math.floor(count / groups);
    const extra = count % groups;
    const next: Tree<T>[] = [];
    let pos = 0;
    for (let g = 0; g < groups; g++) {
      const size = base + (g < extra ? 1 : 0);
      next.push(makeBranch(height, level.slice(pos, pos + size)));
      pos += size;
    }
    level = next;
  }
  return level[0];
}

/** Split values into evenly sized leaves of at most CHUNK elements. */
export function chunkValues<T>(xs: readonly T[], from = 0, to = xs.length): Leaf<T>[] {
  const n = to - from;
  if (n <= 0) return [];
  const groups = Math.ceil(n / CHUNK);
  const base = Math.floor(n / groups);
  const extra = n % groups;
  const out: Leaf<T>[] = [];
  let pos = from;
  for (let g = 0; g < groups; g++) {
    const size = base + (g < extra ? 1 : 0);
    out.push(new Leaf(xs.slice(pos, pos + size)));
    pos += size;
  }
  return out;
}

export function forEachLeaf<T>(t: Tree<T>, f: (items: readonly T[]) => void): void {
  if (t instanceof Leaf) {
    f(t.items);
    return;
  }
  for (const c of t.children) forEachLeaf(c, f);
}

/** Visit leaves until `f` returns true; returns whether it stopped early. */
export function someLeaf<T>(t: Tree<T>, f: (items: readonly T[]) => boolean): boolean {
  if (t instanceof Leaf) return f(t.items);
  for (const c of t.children) {
    if (someLeaf(c, f)) return true;
  }
  return false;
}

export function treeMap<T, V>(t: Tree<T>, f: (x: T) => V): Tree<V> {
  if (t instanceof Leaf) return new Leaf(t.items.map((x) => f(x)));
  return new Branch(
    t.height,
    t.ends,
    t.children.map((c) => treeMap(c, f)),
  );
}

export function checkTree<T>(t: Tree<T>): void {
  if (t instanceof Leaf) {
    if (t.len === 0 || t.len > CHUNK) throw new Error(`leaf size ${t.len} out of range`);
    return;
  }
  if (t.children.length === 0 || t.children.length > BRANCH) throw new Error(`branch with ${t.children.length} children`);
  if (t.ends.length !== t.children.length) throw new Error("ends and children differ");
  let acc = 0;
  t.children.forEach((c, i) => {
    if (c.height + 1 !== t.height) throw new Error(`child height ${c.height} under ${t.height}`);
    acc += c.len;
    if (t.ends[i] !== acc) throw new Error(`bad cumulative size at ${i}`);
    checkTree(c);
  });
}

export function formatTree<T>(t: Tree<T>, show: (x: T) => string): string {
  if (t instanceof Leaf) return `[${t.items.map(show).join(" ")}]`;
  return `(${t.children.map((c) => formatTree(c, show)).join(" ")})`;
}
