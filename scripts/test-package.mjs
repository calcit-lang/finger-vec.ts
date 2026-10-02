import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const consumer = mkdtempSync(join(tmpdir(), "finger-vec-packed-consumer-"));
try {
  const packResult = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", consumer], {
    cwd: root, encoding: "utf8",
  }));
  // npm 12 keys pack results by package name; earlier versions return an array.
  const packages = Array.isArray(packResult) ? packResult : Object.values(packResult);
  assert.equal(packages.length, 1, "Expected exactly one packed package");
  const [packed] = packages;
  assert.equal(packed.name, "@calcit/finger-vec");
  const files = packed.files.map(({ path }) => path).sort();
  assert.deepEqual(files, [
    "README.md", "lib/index.d.mts", "lib/index.mjs", "lib/tree.d.mts", "lib/tree.mjs", "package.json",
  ]);
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", join(consumer, packed.filename)], {
    cwd: consumer, stdio: "inherit",
  });
  writeFileSync(join(consumer, "consumer.mts"), `import { FingerVec } from "@calcit/finger-vec";
const original: FingerVec<number> = FingerVec.of(1, 2, 3);
const changed: FingerVec<number> = original.pushRight(4).pushLeft(0);
const actual: number[] = changed.toArray();
if (JSON.stringify(actual) !== "[0,1,2,3,4]" || original.len() !== 3) throw new Error("Packed vector contract failed");
const [left, right] = changed.split(2);
if (!left.concat(right).equals(changed)) throw new Error("Packed tree import failed");
`);
  writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify({
    compilerOptions: { strict: true, module: "NodeNext", moduleResolution: "NodeNext", target: "es2020", types: [] },
    files: ["consumer.mts"],
  }));
  execFileSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", join(consumer, "tsconfig.json")], {
    cwd: consumer, stdio: "inherit",
  });
  execFileSync(process.execPath, [join(consumer, "consumer.mjs")], { cwd: consumer, stdio: "inherit" });
  console.log("Packed package file list, TypeScript declarations and Node runtime passed");
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
