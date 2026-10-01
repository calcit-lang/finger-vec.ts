import { FingerVec } from "./index.mjs";

declare const console: { log(...xs: unknown[]): void };
declare const performance: { now(): number };

function time(name: string, f: () => void): void {
  const start = performance.now();
  f();
  console.log(name.padEnd(36), (performance.now() - start).toFixed(2).padStart(9), "ms");
}

const n = 100000;
let sink = 0;
let v = FingerVec.empty<number>();
time("pushRight 100k", () => {
  for (let i = 0; i < n; i++) v = v.pushRight(i);
});
let p = FingerVec.empty<number>();
time("pushLeft 100k", () => {
  for (let i = 0; i < n; i++) p = p.pushLeft(i);
});
const source = Array.from({ length: n }, (_, i) => i);
let b = FingerVec.empty<number>();
time("from array 100k", () => {
  b = FingerVec.from(source);
});
const idx = Array.from({ length: n }, (_, i) => (i * 2654435761) % n);
time("get 100k scattered", () => {
  for (const i of idx) sink += b.get(i) as number;
});
time("iterate 100k", () => {
  for (const x of v) sink += x;
});
time("rest until empty 100k", () => {
  let r = v;
  while (r.len() > 0) r = r.rest();
});
time("assoc 100k scattered", () => {
  let u = b;
  for (const i of idx) u = u.assoc(i, i);
});
let c = FingerVec.empty<number>();
time("concat acc+[x] 20k", () => {
  for (let i = 0; i < 20000; i++) c = c.concat(FingerVec.of(i));
});
let m = b;
time("insert middle 20k", () => {
  for (let i = 0; i < 20000; i++) m = m.insert(m.len() >> 1, i);
});
console.log("depths:", v.depth(), c.depth(), m.depth(), sink > 0);
