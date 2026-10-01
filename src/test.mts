import { FingerVec, CHUNK } from "./index.mjs";
declare const console: { log(...xs: unknown[]): void };

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    throw new Error(msg);
  }
}
function eqArr<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

class Rng {
  constructor(private s: number) {}
  next(): number {
    this.s ^= this.s << 13;
    this.s ^= this.s >>> 17;
    this.s ^= this.s << 5;
    return this.s >>> 0;
  }
  below(n: number): number {
    return n <= 0 ? 0 : this.next() % n;
  }
}

function check(v: FingerVec<number>, m: number[], ctx: string): void {
  v.checkStructure();
  assert(v.len() === m.length, `${ctx}: len ${v.len()} != ${m.length}`);
  assert(eqArr(v.toArray(), m), `${ctx}: toArray differs`);
  assert(eqArr([...v], m), `${ctx}: iterator differs`);
  const walked: number[] = [];
  v.forEach((x) => walked.push(x));
  assert(eqArr(walked, m), `${ctx}: forEach differs`);
  assert(v.first() === m[0] && v.last() === m[m.length - 1], `${ctx}: first/last`);
  for (let i = 0; i < m.length; i += 7) assert(v.get(i) === m[i], `${ctx}: get ${i}`);
  assert(v.get(m.length) === undefined, `${ctx}: get past end`);
}

let counter = 0;
function randomVec(rng: Rng): [FingerVec<number>, number[]] {
  const k = rng.below(4);
  const n = k === 0 ? rng.below(4) : k === 1 ? rng.below(40) : k === 2 ? rng.below(300) : rng.below(3000);
  const m: number[] = [];
  for (let i = 0; i < n; i++) m.push(++counter);
  if (rng.below(2) === 0) return [FingerVec.from(m), m];
  let v = FingerVec.empty<number>();
  for (const x of m) v = v.pushRight(x);
  return [v, m];
}

function run(seed: number, steps: number): void {
  const rng = new Rng(seed);
  let [v, m] = randomVec(rng);
  const snapshots: [FingerVec<number>, number[]][] = [];
  for (let step = 0; step < steps; step++) {
    const x = ++counter;
    const op = rng.below(14);
    switch (op) {
      case 0:
      case 1:
        v = v.pushRight(x);
        m.push(x);
        break;
      case 2:
      case 3:
        v = v.pushLeft(x);
        m.unshift(x);
        break;
      case 4:
        v = v.dropLeft();
        m.shift();
        break;
      case 5:
        v = v.dropRight();
        m.pop();
        break;
      case 6:
        if (m.length > 0) {
          const i = rng.below(m.length);
          v = v.assoc(i, x);
          m[i] = x;
        }
        break;
      case 7:
        if (m.length > 0) {
          const i = rng.below(m.length);
          const after = rng.below(2) === 0;
          v = v.insert(i, x, after);
          m.splice(after ? i + 1 : i, 0, x);
        }
        break;
      case 8:
        if (m.length > 0) {
          const i = rng.below(m.length);
          v = v.dissoc(i);
          m.splice(i, 1);
        }
        break;
      case 9: {
        const a = rng.below(m.length + 1);
        const b = a + rng.below(m.length - a + 1);
        v = v.slice(a, b);
        m = m.slice(a, b);
        break;
      }
      case 10:
      case 11: {
        const [w, wm] = randomVec(rng);
        if (rng.below(2) === 0) {
          v = v.concat(w);
          m = m.concat(wm);
        } else {
          v = w.concat(v);
          m = wm.concat(m);
        }
        break;
      }
      case 12: {
        const i = rng.below(m.length + 1);
        const [l, r] = v.split(i);
        check(l, m.slice(0, i), `split left seed ${seed}`);
        check(r, m.slice(i), `split right seed ${seed}`);
        v = rng.below(2) === 0 ? l.concat(r) : FingerVec.concatAll(l, r);
        break;
      }
      default:
        v = v.reverse();
        m.reverse();
    }
    check(v, m, `seed ${seed} step ${step} op ${op}`);
    if (step % 50 === 0) snapshots.push([v, m.slice()]);
    if (m.length > 20000) {
      v = v.slice(0, 5000);
      m = m.slice(0, 5000);
    }
  }
  for (const [sv, sm] of snapshots) check(sv, sm, `snapshot seed ${seed}`);
}

function bound(n: number): number {
  let c = Math.max(1, Math.ceil(n / 8));
  let h = 1;
  while (c > 1) {
    c = Math.ceil(c / 8);
    h++;
  }
  return h + 1;
}

const tests: [string, () => void][] = [
  ["model, many seeds", () => {
    for (let s = 1; s <= 40; s++) run(s * 7919, 400);
  }],
  ["model, long run", () => run(123456789, 4000)],
  ["concat single items stays shallow", () => {
    let right = FingerVec.empty<number>();
    let left = FingerVec.empty<number>();
    for (let i = 0; i < 20000; i++) {
      right = right.concat(FingerVec.of(i));
      left = FingerVec.of(i).concat(left);
    }
    for (const v of [right, left]) {
      v.checkStructure();
      assert(v.depth() <= bound(v.len()), `depth ${v.depth()}`);
    }
    assert(right.get(12345) === 12345, "right get");
    assert(left.get(0) === 19999, "left get");
  }],
  ["concat medium lists stays shallow", () => {
    let acc = FingerVec.empty<number>();
    for (let i = 0; i < 2000; i++) {
      const xs: number[] = [];
      for (let k = i * 50; k < i * 50 + 50; k++) xs.push(k);
      acc = acc.concat(FingerVec.from(xs));
    }
    acc.checkStructure();
    assert(acc.len() === 100000, "len");
    assert(acc.depth() <= bound(acc.len()), `depth ${acc.depth()}`);
    for (let i = 0; i < 100000; i += 997) assert(acc.get(i) === i, `get ${i}`);
  }],
  ["insert in the middle stays shallow", () => {
    let v = FingerVec.from(Array.from({ length: 1000 }, (_, i) => i));
    for (let i = 0; i < 20000; i++) v = v.insert(v.len() >> 1, i);
    v.checkStructure();
    assert(v.depth() <= bound(v.len()), `depth ${v.depth()}`);
  }],
  ["errors and empty behavior", () => {
    const v = FingerVec.of(1, 2, 3);
    const throws = (f: () => unknown) => {
      try {
        f();
        return false;
      } catch {
        return true;
      }
    };
    assert(throws(() => v.slice(2, 4)), "slice past end");
    assert(throws(() => v.slice(3, 2)), "slice inverted");
    assert(v.slice(1, 1).len() === 0, "empty slice");
    assert(throws(() => v.assoc(3, 0)), "assoc past end");
    assert(throws(() => v.dissoc(3)), "dissoc past end");
    assert(throws(() => v.insert(3, 0)), "insert past end");
    const e = FingerVec.empty<number>();
    assert(throws(() => e.rest()), "rest empty");
    assert(throws(() => e.butlast()), "butlast empty");
    assert(eqArr(e.insert(0, 9).toArray(), [9]), "insert into empty");
    assert(e.dropLeft().len() === 0, "dropLeft empty");
    assert(FingerVec.from([]).isEmpty(), "from empty");
  }],
  ["equals, indexOf, findIndex, map", () => {
    const a = FingerVec.from(Array.from({ length: 100 }, (_, i) => i));
    let b = FingerVec.empty<number>();
    for (let i = 99; i >= 0; i--) b = b.pushLeft(i);
    assert(a.equals(b), "equals");
    assert(!a.equals(b.dropRight()), "not equals");
    assert(a.indexOf(50) === 50 && a.indexOf(-1) === -1, "indexOf");
    assert(a.findIndex((x) => x > 98) === 99, "findIndex");
    assert(eqArr(a.map((x) => x * 2).toArray(), a.toArray().map((x) => x * 2)), "map");
    assert(CHUNK === 32, "chunk size");
  }],
];

let passed = 0;
for (const [name, f] of tests) {
  try {
    f();
    passed++;
    console.log(`ok   ${name}`);
  } catch (e) {
    console.log(`FAIL ${name}: ${(e as Error).message}`);
  }
}
console.log(`${passed}/${tests.length} passed`);
if (passed !== tests.length || failures > 0) {
  (globalThis as any).process.exitCode = 1;
}
