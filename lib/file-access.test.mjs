import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Loaded through jiti so the module's own extensionless imports resolve the way
// the app resolves them (tsconfig moduleResolution: "bundler"); bare
// `import("./path-security.ts")` only works while that file has no imports.
async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./path-security.ts");
}

test("session-derived roots authorize actual cwds but not canonical identity paths", async () => {
  const { createJiti } = await import("jiti");
  const { sessionCwdRoots } = await createJiti(import.meta.url).import("./file-access.ts");
  const roots = sessionCwdRoots([{
    cwd: "/repo-worktrees/feature/packages/app",
    projectRoot: "/repo/packages/app",
  }]);

  assert.deepEqual([...roots], ["/repo-worktrees/feature/packages/app"]);
});

test("invalidates an explicit root when its real target changes", async (t) => {
  const { createJiti } = await import("jiti");
  const { allowFileRoot, isExistingFilePathAllowed } = await createJiti(import.meta.url).import("./file-access.ts");
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-explicit-root-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const allowed = path.join(base, "allowed");
  const outside = path.join(base, "outside");
  fs.mkdirSync(allowed);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
  globalThis.__piAdditionalAllowedRoots?.clear();
  globalThis.__piAdditionalAllowedRootRealPaths?.clear();
  allowFileRoot(allowed);
  const roots = new Set(globalThis.__piAdditionalAllowedRoots);

  fs.rmdirSync(allowed);
  fs.symlinkSync(outside, allowed, process.platform === "win32" ? "junction" : "dir");
  assert.equal(isExistingFilePathAllowed(path.join(allowed, "secret.txt"), roots), false);
});

test("invalidates an explicit root recreated at the same path", async (t) => {
  const { createJiti } = await import("jiti");
  const { allowFileRoot, isExistingFilePathAllowed } = await createJiti(import.meta.url).import("./file-access.ts");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-recreated-root-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  globalThis.__piAdditionalAllowedRoots?.clear();
  globalThis.__piAdditionalAllowedRootRealPaths?.clear();
  assert.equal(allowFileRoot(root), true);
  const roots = new Set(globalThis.__piAdditionalAllowedRoots);

  fs.rmdirSync(root);
  fs.mkdirSync(root);
  assert.equal(isExistingFilePathAllowed(root, roots), false);
  assert.equal(globalThis.__piAdditionalAllowedRoots?.has(root), false);
});

test("rejects an explicit grant when the path changed after validation", async (t) => {
  const { createJiti } = await import("jiti");
  const { allowFileRoot } = await createJiti(import.meta.url).import("./file-access.ts");
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-grant-race-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const inside = path.join(base, "inside");
  const outside = path.join(base, "outside");
  const link = path.join(base, "link");
  fs.mkdirSync(inside);
  fs.mkdirSync(outside);
  fs.symlinkSync(inside, link, process.platform === "win32" ? "junction" : "dir");
  const validatedRealPath = fs.realpathSync(link);
  fs.rmSync(link);
  fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  globalThis.__piAdditionalAllowedRoots?.clear();
  globalThis.__piAdditionalAllowedRootRealPaths?.clear();

  assert.equal(allowFileRoot(link, validatedRealPath), false);
  assert.equal(globalThis.__piAdditionalAllowedRoots?.has(link), false);
});

test("legacy HMR roots stay rejected after snapshot state is reinitialized", async (t) => {
  const { createJiti } = await import("jiti");
  const { isExistingFilePathAllowed } = await createJiti(import.meta.url).import("./file-access.ts");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-hmr-root-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const normalizedRoot = root.replace(/\\/g, "/");
  const roots = new Set([normalizedRoot]);
  globalThis.__piAdditionalAllowedRoots = new Set([normalizedRoot]);
  globalThis.__piAdditionalAllowedRootRealPaths = undefined;
  globalThis.__piAllowedRootsCache = { roots, expiresAt: Date.now() + 10_000 };

  assert.equal(isExistingFilePathAllowed(root, roots), false);
  assert.equal(isExistingFilePathAllowed(root, roots), false);
});

test("rejects an existing path that escapes an allowed root through a symlink", async (t) => {
  const { isExistingPathWithinRoots, isPathWithinRoots } = await loadSubject();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-file-access-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const allowed = path.join(base, "allowed");
  const outside = path.join(base, "outside");
  fs.mkdirSync(allowed);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
  const link = path.join(allowed, "link");
  fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  const target = path.join(link, "secret.txt");
  const roots = new Set([allowed]);

  assert.equal(isPathWithinRoots(target, roots), true);
  assert.equal(isExistingPathWithinRoots(target, roots), false);
});
