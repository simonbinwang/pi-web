import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  linkLocalPiPackages,
  LOCAL_PI_PACKAGES,
  resolvePiRoot,
  validatePiRoot,
} from "../scripts/local-pi.mjs";

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value)}\n`);
}

function makeFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-web-local-pi-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const piRoot = join(root, "pi");
  const webRoot = join(root, "pi-web");
  mkdirSync(piRoot, { recursive: true });
  mkdirSync(webRoot, { recursive: true });
  writeJson(join(piRoot, "package.json"), { name: "pi-monorepo" });

  for (const [packageName, packagePath] of Object.entries(LOCAL_PI_PACKAGES)) {
    const directory = join(piRoot, packagePath);
    mkdirSync(directory, { recursive: true });
    writeJson(join(directory, "package.json"), { name: packageName });
  }

  return { piRoot, webRoot };
}

test("resolvePiRoot reads persistent config and lets PI_SOURCE_DIR override it", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-web-local-pi-config-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeJson(join(root, "local-pi.json"), { piSourceDir: "../pi" });

  assert.equal(resolvePiRoot({}, "/other", root), join(root, "../pi"));
  assert.equal(resolvePiRoot({ PI_SOURCE_DIR: "../override" }, "/workspace/pi-web", root), "/workspace/override");
});

test("resolvePiRoot explains how to configure a local checkout", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-web-local-pi-no-config-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  assert.throws(() => resolvePiRoot({}, root, root), /Create local-pi\.json/);
});

test("validatePiRoot rejects a directory with the wrong package identity", (t) => {
  const { piRoot } = makeFixture(t);
  writeJson(join(piRoot, "packages/ai/package.json"), { name: "not-pi-ai" });

  assert.throws(() => validatePiRoot(piRoot), /Expected @earendil-works\/pi-ai/);
});

test("linkLocalPiPackages replaces installed packages with stable local links", (t) => {
  const { piRoot, webRoot } = makeFixture(t);
  const installedAi = join(webRoot, "node_modules/@earendil-works/pi-ai");
  mkdirSync(installedAi, { recursive: true });
  writeFileSync(join(installedAi, "registry-copy.txt"), "old");

  const first = linkLocalPiPackages({ piRoot, webRoot });
  assert.equal(first.length, Object.keys(LOCAL_PI_PACKAGES).length);
  assert(first.every(({ changed }) => changed));

  for (const [packageName, packagePath] of Object.entries(LOCAL_PI_PACKAGES)) {
    const linkedPath = join(webRoot, "node_modules", packageName);
    assert.equal(realpathSync(linkedPath), realpathSync(join(piRoot, packagePath)));
    assert.equal(
      JSON.parse(readFileSync(join(linkedPath, "package.json"), "utf8")).name,
      packageName,
    );
  }

  const second = linkLocalPiPackages({ piRoot, webRoot });
  assert(second.every(({ changed }) => !changed));
});
