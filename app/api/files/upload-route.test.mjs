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
  const { POST } = await jiti.import("./[...path]/route.ts");
  const { NextRequest } = await jiti.import("next/server");
  const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");
  return { allowFileRoot, NextRequest, POST };
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

  const { allowFileRoot, NextRequest, POST } = await loadSubjects();
  assert.equal(allowFileRoot(allowed), true);
  globalThis.__piAllowedRootsCache = {
    roots: new Set([allowed.replace(/\\/g, "/")]),
    expiresAt: Date.now() + 10_000,
  };
  fs.rmdirSync(allowed);
  fs.symlinkSync(outside, allowed, process.platform === "win32" ? "junction" : "dir");

  const segments = allowed.split(/[\\/]+/).filter(Boolean);
  const request = new NextRequest(`http://localhost/api/files/${segments.join("/")}?type=upload-check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileNames: ["probe.txt"] }),
  });
  const response = await POST(request, { params: Promise.resolve({ path: segments }) });
  assert.equal(response.status, 403);
});
