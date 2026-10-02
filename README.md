## FingerVec (TypeScript)

A persistent (immutable, structurally shared) vector built for the [Calcit](https://github.com/calcit-lang/calcit) JavaScript runtime. It replaces the list part of [@calcit/ternary-tree](https://github.com/calcit-lang/ternary-tree.ts). The Rust twin lives in [finger-vec.rs](https://github.com/calcit-lang/finger-vec.rs); both use the same layout and algorithms.

![npm](https://img.shields.io/npm/v/@calcit/finger-vec?style=flat-square)

### Layout

```text
front buffer | relaxed B-tree of chunks | back buffer
```

- Elements live in chunks of up to 32 items; lists of 32 items or fewer are one array.
- The middle is a relaxed B-tree (branching factor 32, cumulative sizes, all leaves at the same depth), as in RRB vectors.
- Buffers at both ends make pushes and pops cheap. Appending to the newest version of a list writes into its own back array instead of copying; older versions never read past their own end, so they are unaffected.
- Concatenation joins along the seam and merges the nodes there, so concatenating in a loop keeps the height logarithmic.

| Operation | Cost |
| --- | --- |
| `get`, `assoc` | `O(log₃₂ n)` |
| `pushLeft`, `pushRight`, `dropLeft`, `dropRight` | amortized `O(1)` plus a chunk copy |
| `concat`, `split`, `slice`, `insert`, `dissoc` | `O(log n)` |
| `FingerVec.from(array)` | `O(n)` |

### Usage

```ts
import { FingerVec } from "@calcit/finger-vec";

const xs = FingerVec.of(1, 2, 3);
const ys = xs.pushRight(4).pushLeft(0);
ys.toArray(); // [0, 1, 2, 3, 4]
xs.len(); // 3, unchanged

const [left, right] = ys.split(2);
left.concat(right).equals(ys); // true
ys.slice(1, 3).toArray(); // [1, 2]
for (const x of ys) console.log(x);
```

Main methods: `len`, `get`, `first`, `last`, `pushLeft`/`prepend`, `pushRight`/`append`, `dropLeft`, `dropRight`, `rest`, `butlast`, `assoc`, `dissoc`, `insert(idx, item, after)`, `insertAt`, `assocBefore`, `assocAfter`, `split`, `slice`, `take`, `skip`, `concat`, `FingerVec.concatAll`, `reverse`, `map`, `forEach`, `findIndex`, `indexOf`, `toArray`, `equals`, `items()` and `for...of`. `get` returns `undefined` out of range; `rest`, `butlast`, `assoc`, `dissoc`, `insert` and `slice` throw on invalid input, matching the ternary-tree functions Calcit used.

### Performance

Measured against `@calcit/ternary-tree 0.0.26` on Node 22, Linux x86-64, single runs:

| Case | ternary-tree | FingerVec | Speedup |
| --- | ---: | ---: | ---: |
| append 100k | 70.00 ms | 24.87 ms | 2.8× |
| prepend 100k | 82.35 ms | 48.84 ms | 1.7× |
| from array 100k | 19.46 ms | 0.95 ms | 20× |
| random `get` 100k | 58.10 ms | 20.59 ms | 2.8× |
| `rest` until empty, 100k | 32.91 ms | 18.94 ms | 1.7× |
| random `assoc` 100k | 148.21 ms | 90.48 ms | 1.6× |
| `concat acc [x]` 5k, then `get` every item | 118.18 ms | 1.65 ms | 72× |
| insert in the middle 3k | 174.84 ms | 32.33 ms | 5.4× |
| queue: append + rest 100k | 110.77 ms | 22.44 ms | 4.9× |
| 32-item list: from array ×300k | 543.96 ms | 30.94 ms | 18× |
| 8-item list: append to the same base ×300k | 24.65 ms | 48.42 ms | 0.5× |
| `concat acc [x]` 5k | 6.33 ms | 9.41 ms | 0.7× |

Appending repeatedly to one shared small list copies its chunk each time, which is slower than ternary-tree's small nodes. The ternary tree, on the other hand, reaches depth 2,501 after 5,000 concatenations and overflows the stack after a few thousand middle insertions; FingerVec stays at depth 3–4. Run `npm run bench` for FingerVec numbers on your machine.

### Development

打包和发布时会自动执行 TypeScript 构建。运行 `npm run test:package` 会检查真实 tarball 的文件列表，并在独立临时项目中验证公开类型与 Node 导入；测试不依赖仓库内的源码或本地模块链接。

发布通过 `.github/workflows/npm-publish.yaml` 使用 npm OIDC trusted publishing，不依赖发布 token。
npm 的 trusted publisher 配置须指定 `calcit-lang/finger-vec.ts` 和文件名 `npm-publish.yaml`；当前 job 没有 GitHub Environment，该选项留空。保存配置后可通过 Release 或手动运行同一 workflow 发布；2FA 保持启用。

```bash
npm install
npx tsc
node lib/test.mjs
node lib/bench.mjs
```

Tests compare random operation sequences against arrays, check structural invariants after every step, and assert depth bounds for concatenation loops and middle insertion.

### License

MIT
