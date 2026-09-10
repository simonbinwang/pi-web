import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function loadSubjects() {
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url, {
    alias: { "@": path.resolve(new URL("../../..", import.meta.url).pathname) },
  });
  const route = await jiti.import("./route.ts");
  const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");
  const { getAdditionalAllowedRoots } = await jiti.import("../../../lib/allowed-roots.ts");
  const { resolveProject } = await jiti.import("../../../lib/worktree.ts");
  return { ...route, allowFileRoot, getAdditionalAllowedRoots, resolveProject };
}

async function git(cwd, args) {
  await execFileAsync("git", ["-C", cwd, ...args]);
}

async function repository(t) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-web-worktree-route-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const repo = path.join(tempRoot, "repo");
  const linked = path.join(tempRoot, "linked");
  await execFileAsync("git", ["init", repo]);
  await git(repo, ["config", "user.name", "Pi Web Test"]);
  await git(repo, ["config", "user.email", "pi-web-test@example.invalid"]);
  await git(repo, ["config", "commit.gpgsign", "false"]);
  await mkdir(path.join(repo, "packages", "app"), { recursive: true });
  await writeFile(path.join(repo, "packages", "app", "README.md"), "# app\n");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "initial"]);
  const { stdout: branchOutput } = await execFileAsync("git", ["-C", repo, "rev-parse", "--abbrev-ref", "HEAD"]);
  const defaultBranch = branchOutput.trim();
  await git(repo, ["worktree", "add", "-b", "feature/test", linked]);
  return { tempRoot, repo, linked, defaultBranch };
}

async function json(response) {
  return { status: response.status, body: await response.json() };
}

test("GET maps nested cwd across worktrees and keeps its canonical project separate from repo root", async (t) => {
  const { repo, linked } = await repository(t);
  const { GET, PATCH, allowFileRoot, resolveProject } = await loadSubjects();
  const nested = path.join(repo, "packages", "app");
  allowFileRoot(repo);

  const result = await json(await GET(new Request(`http://localhost/api/worktrees?cwd=${encodeURIComponent(nested)}`)));
  assert.equal(result.status, 200);
  assert.equal(result.body.checkoutRoot, repo);
  assert.equal(result.body.checkoutRelativePath, path.join("packages", "app"));
  assert.equal(result.body.currentWorktreePath, repo);
  assert.deepEqual(result.body.worktrees.map((entry) => entry.isCurrent), [true, false]);
  assert.deepEqual(
    result.body.worktrees.map(({ path: checkout, targetCwd, available }) => ({ checkout, targetCwd, available })),
    [
      { checkout: repo, targetCwd: nested, available: true },
      { checkout: linked, targetCwd: path.join(linked, "packages", "app"), available: true },
    ],
  );
  const selected = await json(await PATCH(new Request("http://localhost/api/worktrees", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: nested, path: linked }),
  })));
  assert.equal(selected.status, 200);
  assert.equal(selected.body.targetCwd, path.join(linked, "packages", "app"));

  const rootProject = await resolveProject(repo);
  const mainNestedProject = await resolveProject(nested);
  const linkedNestedProject = await resolveProject(path.join(linked, "packages", "app"));
  assert.equal(mainNestedProject.projectRoot, linkedNestedProject.projectRoot);
  assert.notEqual(mainNestedProject.projectRoot, rootProject.projectRoot);
});

test("GET authorizes only mapped nested targets, not checkout roots", async (t) => {
  const { repo, linked } = await repository(t);
  const { GET, allowFileRoot, getAdditionalAllowedRoots } = await loadSubjects();
  const nested = path.join(repo, "packages", "app");
  const linkedNested = path.join(linked, "packages", "app");
  const additionalRoots = getAdditionalAllowedRoots();
  additionalRoots.clear();
  globalThis.__piAllowedRootsCache = undefined;
  allowFileRoot(nested);

  const result = await json(await GET(new Request(`http://localhost/api/worktrees?cwd=${encodeURIComponent(nested)}`)));
  assert.equal(result.status, 200);
  assert.equal(additionalRoots.has(repo), false);
  assert.equal(additionalRoots.has(linked), false);
  assert.equal(additionalRoots.has(nested), true);
  assert.equal(additionalRoots.has(linkedNested), true);

  await rm(linkedNested, { recursive: true, force: true });
  const refreshed = await json(await GET(new Request(`http://localhost/api/worktrees?cwd=${encodeURIComponent(nested)}`)));
  assert.equal(refreshed.status, 200);
  assert.equal(additionalRoots.has(linkedNested), false);
});

test("GET fails closed for a bare repository with no containing checkout", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-web-bare-route-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const bare = path.join(tempRoot, "bare.git");
  await execFileAsync("git", ["init", "--bare", bare]);
  const { GET, allowFileRoot } = await loadSubjects();
  allowFileRoot(bare);

  const result = await json(await GET(new Request(`http://localhost/api/worktrees?cwd=${encodeURIComponent(bare)}`)));
  assert.equal(result.status, 200);
  assert.equal(result.body.isGit, false);
  assert.deepEqual(result.body.worktrees, []);
});

test("GET preserves checkout-root and non-Git behavior", async (t) => {
  const { tempRoot, repo, linked } = await repository(t);
  const { GET, allowFileRoot } = await loadSubjects();
  allowFileRoot(tempRoot);

  const rootResult = await json(await GET(new Request(`http://localhost/api/worktrees?cwd=${encodeURIComponent(repo)}`)));
  assert.equal(rootResult.status, 200);
  assert.equal(rootResult.body.checkoutRelativePath, "");
  assert.equal(rootResult.body.currentWorktreePath, repo);
  assert.deepEqual(rootResult.body.worktrees.map((entry) => entry.isCurrent), [true, false]);
  assert.deepEqual(
    rootResult.body.worktrees.map((entry) => entry.targetCwd),
    [repo, linked],
  );

  const outside = path.join(tempRoot, "outside-git");
  await mkdir(outside);
  const nonGitResult = await json(await GET(new Request(`http://localhost/api/worktrees?cwd=${encodeURIComponent(outside)}`)));
  assert.equal(nonGitResult.status, 200);
  assert.equal(nonGitResult.body.isGit, false);
  assert.deepEqual(nonGitResult.body.worktrees, []);
});

test("PATCH revalidates a mapped target and rejects missing directories", async (t) => {
  const { repo, linked } = await repository(t);
  const { GET, PATCH, allowFileRoot } = await loadSubjects();
  const nested = path.join(repo, "packages", "app");
  allowFileRoot(repo);

  await rm(path.join(linked, "packages"), { recursive: true, force: true });
  const listed = await json(await GET(new Request(`http://localhost/api/worktrees?cwd=${encodeURIComponent(nested)}`)));
  const linkedEntry = listed.body.worktrees.find((entry) => entry.path === linked);
  assert.equal(linkedEntry.available, false);
  assert.equal(linkedEntry.unavailableReason, "missing-relative-directory");

  const selected = await json(await PATCH(new Request("http://localhost/api/worktrees", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: nested, path: linked }),
  })));
  assert.equal(selected.status, 409);
  assert.equal(selected.body.unavailableReason, "missing-relative-directory");
});

test("PATCH rejects mapped files that are not directories", async (t) => {
  const { repo, linked } = await repository(t);
  const { PATCH, allowFileRoot } = await loadSubjects();
  const nested = path.join(repo, "packages", "app");
  allowFileRoot(repo);
  await rm(path.join(linked, "packages", "app"), { recursive: true, force: true });
  await writeFile(path.join(linked, "packages", "app"), "not a directory\n");

  const selected = await json(await PATCH(new Request("http://localhost/api/worktrees", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: nested, path: linked }),
  })));
  assert.equal(selected.status, 409);
  assert.equal(selected.body.unavailableReason, "not-a-directory");
});

test("PATCH refreshes checkout-relative identity when the selected symlink changes", async (t) => {
  const { repo, linked } = await repository(t);
  const { GET, PATCH, allowFileRoot } = await loadSubjects();
  allowFileRoot(repo);
  await mkdir(path.join(repo, "packages", "other"));
  await mkdir(path.join(linked, "packages", "other"));
  const selectedLink = path.join(repo, "selected-package");
  await symlink(path.join(repo, "packages", "app"), selectedLink, "dir");
  const listed = await json(await GET(new Request(`http://localhost/api/worktrees?cwd=${encodeURIComponent(selectedLink)}`)));
  assert.equal(listed.body.checkoutRelativePath, path.join("packages", "app"));
  await rm(selectedLink);
  await symlink(path.join(repo, "packages", "other"), selectedLink, "dir");

  const selected = await json(await PATCH(new Request("http://localhost/api/worktrees", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: selectedLink, path: linked }),
  })));
  assert.equal(selected.status, 200);
  assert.equal(selected.body.targetCwd, path.join(linked, "packages", "other"));
});

test("PATCH rejects a mapped target that escapes its checkout through a symlink", async (t) => {
  const { tempRoot, repo, linked } = await repository(t);
  const { PATCH, allowFileRoot } = await loadSubjects();
  const nested = path.join(repo, "packages", "app");
  allowFileRoot(repo);
  await rm(path.join(linked, "packages", "app"), { recursive: true, force: true });
  const outside = path.join(tempRoot, "outside");
  await mkdir(outside);
  await symlink(outside, path.join(linked, "packages", "app"), "dir");

  const selected = await json(await PATCH(new Request("http://localhost/api/worktrees", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: nested, path: linked }),
  })));
  assert.equal(selected.status, 409);
  assert.equal(selected.body.unavailableReason, "outside-checkout");
});

test("POST preserves nested scope and DELETE returns the main-checkout fallback", async (t) => {
  const { repo } = await repository(t);
  const { POST, DELETE, allowFileRoot } = await loadSubjects();
  const nested = path.join(repo, "packages", "app");
  allowFileRoot(repo);

  const created = await json(await POST(new Request("http://localhost/api/worktrees", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: nested, branch: "feature/created" }),
  })));
  assert.equal(created.status, 200);
  assert.equal(created.body.available, true);
  assert.equal(created.body.targetCwd, path.join(created.body.path, "packages", "app"));

  const removed = await json(await DELETE(new Request("http://localhost/api/worktrees", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: created.body.targetCwd, path: created.body.path }),
  })));
  assert.equal(removed.status, 200);
  assert.equal(removed.body.fallbackCwd, nested);
});

test("DELETE preserves dirty rejection and force-removal behavior", async (t) => {
  const { repo, linked } = await repository(t);
  const { DELETE, allowFileRoot } = await loadSubjects();
  const linkedNested = path.join(linked, "packages", "app");
  allowFileRoot(repo);
  allowFileRoot(linked);
  await writeFile(path.join(linked, "untracked.txt"), "dirty\n");

  const request = (force) => new Request("http://localhost/api/worktrees", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: linkedNested, path: linked, force }),
  });
  const refused = await json(await DELETE(request(false)));
  assert.equal(refused.status, 409);
  assert.equal(refused.body.dirty, true);

  const removed = await json(await DELETE(request(true)));
  assert.equal(removed.status, 200);
  assert.equal(removed.body.fallbackCwd, path.join(repo, "packages", "app"));
});

test("DELETE refuses to strand a nested selection without a main-checkout fallback", async (t) => {
  const { repo, linked } = await repository(t);
  const { DELETE, allowFileRoot } = await loadSubjects();
  const linkedNested = path.join(linked, "packages", "app");
  allowFileRoot(repo);
  allowFileRoot(linked);
  await rm(path.join(repo, "packages", "app"), { recursive: true, force: true });

  const removed = await json(await DELETE(new Request("http://localhost/api/worktrees", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: linkedNested, path: linked }),
  })));
  assert.equal(removed.status, 409);
  assert.match(removed.body.error, /Cannot remove the current worktree/);
});

test("POST keeps a created worktree when its relative directory is unavailable", async (t) => {
  const { repo, defaultBranch } = await repository(t);
  const { POST, allowFileRoot, getAdditionalAllowedRoots } = await loadSubjects();
  const nested = path.join(repo, "packages", "app");
  allowFileRoot(repo);
  await git(repo, ["checkout", "--orphan", "without-package"]);
  await git(repo, ["rm", "-rf", "."]);
  await writeFile(path.join(repo, "ROOT.md"), "root only\n");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "without package"]);
  await git(repo, ["checkout", defaultBranch]);

  const created = await json(await POST(new Request("http://localhost/api/worktrees", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: nested, branch: "without-package" }),
  })));
  assert.equal(created.status, 200);
  assert.equal(created.body.available, false);
  assert.equal(created.body.unavailableReason, "missing-relative-directory");
  assert.equal(getAdditionalAllowedRoots().has(created.body.path), false);
  await git(repo, ["worktree", "list", "--porcelain"]); // checkout still exists
});
