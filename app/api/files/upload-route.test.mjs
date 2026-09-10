import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function loadSubjects() {
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url, {
    alias: { "@": path.resolve(new URL("../../..", import.meta.url).pathname) },
  });
  const { getUploadDirectory } = await jiti.import("./[...path]/route.ts");
  const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");
  return { allowFileRoot, getUploadDirectory };
}

test("upload rejects an explicit root retargeted after authorization", async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-upload-root-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const allowed = path.join(base, "allowed");
  const outside = path.join(base, "outside");
  fs.mkdirSync(allowed);
  fs.mkdirSync(outside);
  globalThis.__piAdditionalAllowedRoots?.clear();
  globalThis.__piAdditionalAllowedRootRealPaths?.clear();
  globalThis.__piAllowedRootsCache = undefined;

  const { allowFileRoot, getUploadDirectory } = await loadSubjects();
  assert.equal(allowFileRoot(allowed), true);
  globalThis.__piAllowedRootsCache = {
    roots: new Set([allowed.replace(/\\/g, "/")]),
    expiresAt: Date.now() + 10_000,
  };
  fs.rmdirSync(allowed);
  fs.symlinkSync(outside, allowed, process.platform === "win32" ? "junction" : "dir");

  const segments = allowed.split(/[\\/]+/).filter(Boolean);
  const result = await getUploadDirectory(segments);
  assert.ok("response" in result);
  assert.equal(result.response.status, 403);
});
