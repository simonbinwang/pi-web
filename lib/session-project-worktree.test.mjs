import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function git(cwd, args) {
  await execFileAsync("git", ["-C", cwd, ...args]);
}

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./session-reader.ts");
}

test("historical sessions are grouped by nested canonical identity without rewriting files", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-web-session-worktree-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const repo = path.join(tempRoot, "repo");
  const linked = path.join(tempRoot, "linked");
  await execFileAsync("git", ["init", repo]);
  await git(repo, ["config", "user.name", "Pi Web Test"]);
  await git(repo, ["config", "user.email", "pi-web-test@example.invalid"]);
  await git(repo, ["config", "commit.gpgsign", "false"]);
  await mkdir(path.join(repo, "packages", "app"), { recursive: true });
  await writeFile(path.join(repo, "packages", "app", "README.md"), "app\n");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "initial"]);
  await git(repo, ["worktree", "add", "-b", "feature/history", linked]);

  const sessionContents = [
    '{"type":"session","id":"main","cwd":"main"}\n',
    '{"type":"session","id":"linked","cwd":"linked"}\n',
    '{"type":"session","id":"root","cwd":"root"}\n',
  ];
  const sessionPaths = await Promise.all(sessionContents.map(async (content, index) => {
    const filePath = path.join(tempRoot, `session-${index}.jsonl`);
    await writeFile(filePath, content);
    return filePath;
  }));
  const sessions = [
    { id: "main", cwd: path.join(repo, "packages", "app"), path: sessionPaths[0], modified: "2026-01-01" },
    { id: "linked", cwd: path.join(linked, "packages", "app"), path: sessionPaths[1], modified: "2026-01-02" },
    { id: "root", cwd: repo, path: sessionPaths[2], modified: "2026-01-03" },
  ];

  const { attachSessionProjectInfo } = await loadSubject();
  const grouped = await attachSessionProjectInfo(sessions);
  assert.equal(grouped[0].projectKey, grouped[1].projectKey);
  assert.equal(grouped[0].projectRoot, grouped[1].projectRoot);
  assert.notEqual(grouped[0].projectKey, grouped[2].projectKey);
  assert.deepEqual(
    await Promise.all(sessionPaths.map((filePath) => readFile(filePath, "utf8"))),
    sessionContents,
  );
});
