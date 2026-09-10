import { execFile } from "child_process";
import { existsSync, mkdirSync, realpathSync, statSync } from "fs";
import { basename, dirname, join, relative, resolve } from "path";
import { promisify } from "util";
import { isExistingPathWithinRoots, isPathWithinRoots } from "./path-security";
import { samePath, toNativePath } from "./paths";

const execFileAsync = promisify(execFile);

// ============================================================================
// Project resolution: cwd → { projectRoot, branch }
//
// A worktree's `git rev-parse --git-common-dir` points at the *main* repo's
// .git directory, so its parent is the project root shared by all worktrees.
// Non-git directories resolve to themselves. Results are cached on globalThis
// (hot-reload safe) with a short TTL; add/remove worktree invalidates eagerly.
// ============================================================================

export interface ProjectInfo {
  /** Canonical workspace identity: main repository root + checkout-relative path. */
  projectRoot: string;
  /** Main checkout root shared by all worktrees. */
  repositoryRoot: string | null;
  /** Checkout containing cwd (main or linked). */
  checkoutRoot: string | null;
  /** Path from checkoutRoot to cwd; empty at a checkout root. */
  checkoutRelativePath: string;
  /** Current branch of the cwd, null for non-git dirs or detached HEAD */
  branch: string | null;
  /** True when cwd is inside a linked worktree (not the main checkout). */
  isWorktree: boolean;
  /** True when cwd is the top-level directory of a checkout (main or linked). */
  isTopLevel: boolean;
}

export type WorktreeUnavailableReason =
  | "missing-relative-directory"
  | "not-a-directory"
  | "outside-checkout";

export interface WorktreeInfo {
  /** Git-verified checkout root. */
  path: string;
  branch: string | null;
  isMain: boolean;
  /** cwd in this checkout corresponding to the selected checkout-relative path. */
  targetCwd: string;
  available: boolean;
  unavailableReason?: WorktreeUnavailableReason;
  /** Real path captured by the same validation that marked this target available. */
  targetRealPath?: string;
  /** Set by the HTTP projection after server-side path comparison. */
  isCurrent?: boolean;
}

declare global {
  var __piProjectCache: Map<string, { info: ProjectInfo; expiresAt: number }> | undefined;
}

const PROJECT_CACHE_TTL_MS = 60_000;

function getProjectCache(): Map<string, { info: ProjectInfo; expiresAt: number }> {
  if (!globalThis.__piProjectCache) globalThis.__piProjectCache = new Map();
  return globalThis.__piProjectCache;
}

export function invalidateProjectCache(): void {
  globalThis.__piProjectCache?.clear();
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    // Pin the message locale so error-text matching (e.g. the dirty-worktree
    // detection in the DELETE route) works regardless of system language.
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout.trim();
}

function realPathOrSelf(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return filePath;
  }
}

/**
 * addWorktree() places worktrees in `<repoRoot>-worktrees/<dir>`. When such a
 * directory no longer exists (worktree removed), group its sessions back
 * under the main repo instead of letting them dangle as a phantom project.
 * The dir name is the sanitized branch name — close enough for display.
 */
function isWorktreeContainerPath(filePath: string): boolean {
  const suffix = "-worktrees";
  const candidate = process.platform === "win32" ? filePath.toLowerCase() : filePath;
  return candidate.endsWith(suffix);
}

function inferRemovedWorktree(cwd: string): ProjectInfo | null {
  let checkoutRoot = resolve(cwd);
  while (dirname(checkoutRoot) !== checkoutRoot && !isWorktreeContainerPath(dirname(checkoutRoot))) {
    checkoutRoot = dirname(checkoutRoot);
  }
  const worktreesParent = dirname(checkoutRoot);
  if (!isWorktreeContainerPath(worktreesParent)) return null;
  const repoRoot = worktreesParent.slice(0, -"-worktrees".length);
  if (!repoRoot || !existsSync(join(repoRoot, ".git"))) return null;
  const checkoutRelativePath = relative(checkoutRoot, resolve(cwd));
  const repositoryRoot = realPathOrSelf(repoRoot);
  return {
    projectRoot: resolve(repositoryRoot, checkoutRelativePath),
    repositoryRoot,
    checkoutRoot,
    checkoutRelativePath,
    branch: basename(checkoutRoot),
    isWorktree: true,
    isTopLevel: checkoutRelativePath === "",
  };
}

export async function resolveProject(cwd: string, options: { fresh?: boolean } = {}): Promise<ProjectInfo> {
  const cache = getProjectCache();
  const cached = cache.get(cwd);
  if (!options.fresh && cached && cached.expiresAt > Date.now()) return cached.info;

  let info: ProjectInfo;
  try {
    if (!existsSync(cwd)) {
      info = inferRemovedWorktree(cwd) ?? {
        projectRoot: cwd,
        repositoryRoot: null,
        checkoutRoot: null,
        checkoutRelativePath: "",
        branch: null,
        isWorktree: false,
        isTopLevel: false,
      };
      cache.set(cwd, { info, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS });
      return info;
    }
    const out = await git(cwd, [
      "rev-parse", "--path-format=absolute",
      "--git-common-dir", "--git-dir", "--show-toplevel",
      "--abbrev-ref", "HEAD",
    ]);
    const [commonDirRaw, gitDirRaw, toplevelRaw, ref] = out.split("\n").map((l) => l.trim());
    // Only the first three lines are paths — `ref` is a branch name and must
    // keep its forward slashes (`feature/foo`).
    const [commonDir, gitDir, toplevel] = [commonDirRaw, gitDirRaw, toplevelRaw].map(toNativePath);
    // git prints resolved (symlink-free) paths; normalize cwd the same way
    const realCwd = realPathOrSelf(cwd);
    const checkoutRoot = realPathOrSelf(toplevel);
    const repositoryRoot = realPathOrSelf(dirname(commonDir));
    const checkoutRoots = new Set([checkoutRoot]);
    if (!isPathWithinRoots(realCwd, checkoutRoots) || !isExistingPathWithinRoots(realCwd, checkoutRoots)) {
      throw new Error(`cwd is outside its Git checkout: ${cwd}`);
    }
    const checkoutRelativePath = relative(checkoutRoot, realCwd);
    const isTopLevel = checkoutRelativePath === "";
    info = {
      projectRoot: resolve(repositoryRoot, checkoutRelativePath),
      repositoryRoot,
      checkoutRoot,
      checkoutRelativePath,
      branch: ref && ref !== "HEAD" ? ref : null,
      isWorktree: !samePath(gitDir, commonDir),
      isTopLevel,
    };
  } catch {
    info = {
      projectRoot: cwd,
      repositoryRoot: null,
      checkoutRoot: null,
      checkoutRelativePath: "",
      branch: null,
      isWorktree: false,
      isTopLevel: false,
    };
  }

  cache.set(cwd, { info, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS });
  return info;
}

// ============================================================================
// Worktree operations
//
// These take any directory inside the repo (a worktree, the main checkout, or
// a subdirectory) and resolve the main repo root themselves via the git
// common dir, so callers can pass session cwds directly.
// ============================================================================

/** Main repo root (parent of the shared .git dir), or throws for non-git dirs */
async function getRepoRoot(cwd: string): Promise<string> {
  const commonDir = await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return realPathOrSelf(dirname(toNativePath(commonDir)));
}

export async function listWorktrees(cwd: string): Promise<WorktreeInfo[]> {
  const project = await resolveProject(cwd);
  if (!project.repositoryRoot || !project.checkoutRoot) {
    throw new Error(`cwd is not inside a Git checkout: ${cwd}`);
  }
  const out = await git(cwd, ["worktree", "list", "--porcelain"]);
  const checkoutRelativePath = project.checkoutRelativePath;
  const worktrees: Array<Pick<WorktreeInfo, "path" | "branch" | "isMain">> = [];
  let current: (Partial<Pick<WorktreeInfo, "path" | "branch">> & { prunable?: boolean }) | null = null;

  const flush = () => {
    if (current?.path) {
      // Prunable worktrees point at missing/broken gitdirs and cannot be
      // browsed or selected usefully. Also skip vanished paths even if git has
      // not marked them prunable yet.
      if (!current.prunable && existsSync(current.path)) {
        worktrees.push({
          path: current.path,
          branch: current.branch ?? null,
          isMain: worktrees.length === 0,
        });
      }
    }
    current = null;
  };

  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      flush();
      current = { path: toNativePath(line.slice("worktree ".length).trim()) };
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
    } else if (line.startsWith("prunable") && current) {
      current.prunable = true;
    } else if (line.trim() === "") {
      flush();
    }
  }
  flush();
  return worktrees.map((worktree) => ({
    ...worktree,
    ...mapWorktreeTarget(worktree.path, checkoutRelativePath),
  }));
}

export function mapWorktreeTarget(
  checkoutPath: string,
  checkoutRelativePath: string,
): Pick<WorktreeInfo, "targetCwd" | "targetRealPath" | "available" | "unavailableReason"> {
  const targetCwd = resolve(checkoutPath, checkoutRelativePath);
  const roots = new Set([checkoutPath]);
  if (!isPathWithinRoots(targetCwd, roots)) {
    return { targetCwd, available: false, unavailableReason: "outside-checkout" };
  }
  if (!existsSync(targetCwd)) {
    return { targetCwd, available: false, unavailableReason: "missing-relative-directory" };
  }
  try {
    if (!statSync(targetCwd).isDirectory()) {
      return { targetCwd, available: false, unavailableReason: "not-a-directory" };
    }
  } catch {
    return { targetCwd, available: false, unavailableReason: "missing-relative-directory" };
  }
  let targetRealPath: string;
  try {
    targetRealPath = realpathSync(targetCwd);
  } catch {
    return { targetCwd, available: false, unavailableReason: "missing-relative-directory" };
  }
  const realCheckoutPath = realPathOrSelf(checkoutPath);
  if (
    !isExistingPathWithinRoots(targetCwd, roots)
    || !isPathWithinRoots(targetRealPath, new Set([realCheckoutPath]))
  ) {
    return { targetCwd, available: false, unavailableReason: "outside-checkout" };
  }
  return { targetCwd, targetRealPath, available: true };
}

export function findWorktreeByPath(worktrees: readonly WorktreeInfo[], candidate: string): WorktreeInfo | undefined {
  return worktrees.find((worktree) => samePath(worktree.path, candidate));
}

export function findCurrentWorktreePath(worktrees: readonly WorktreeInfo[], cwd: string): string | null {
  // resolveProject() accepts a symlink that resolves inside a checkout, so use
  // that same real cwd when identifying the owning worktree.
  const realCwd = realPathOrSelf(cwd);
  const rootsContainingCwd = worktrees.filter((worktree) => (
    isPathWithinRoots(realCwd, new Set([worktree.path]))
    && isExistingPathWithinRoots(realCwd, new Set([worktree.path]))
  ));
  // Worktree roots cannot normally overlap, but selecting the most specific
  // match makes containment deterministic even for unusual repository paths.
  return rootsContainingCwd.sort((a, b) => b.path.length - a.path.length)[0]?.path ?? null;
}

function sanitizeBranchForDir(branch: string): string {
  return branch.replace(/[\/\\:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function addWorktree(cwd: string, branch: string): Promise<{ path: string; branch: string }> {
  const trimmed = branch.trim();
  if (!trimmed) throw new Error("Branch name is required");

  const dirName = sanitizeBranchForDir(trimmed);
  if (!dirName) throw new Error(`Invalid branch name: ${branch}`);

  const repoRoot = await getRepoRoot(cwd);
  const baseDir = `${resolve(repoRoot)}-worktrees`;
  const worktreePath = join(baseDir, dirName);
  if (existsSync(worktreePath)) {
    throw new Error(`Directory already exists: ${worktreePath}`);
  }
  mkdirSync(baseDir, { recursive: true });

  // Reuse the branch if it already exists, otherwise create it at HEAD.
  let branchExists = false;
  try {
    await git(repoRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${trimmed}`]);
    branchExists = true;
  } catch {
    branchExists = false;
  }

  try {
    if (branchExists) {
      await git(repoRoot, ["worktree", "add", "--", worktreePath, trimmed]);
    } else {
      await git(repoRoot, ["worktree", "add", "-b", trimmed, "--", worktreePath]);
    }
  } catch (error) {
    throw new Error(extractGitError(error));
  }

  invalidateProjectCache();
  return { path: worktreePath, branch: trimmed };
}

export async function removeWorktree(cwd: string, worktreePath: string, force = false): Promise<void> {
  const worktrees = await listWorktrees(cwd);
  const target = findWorktreeByPath(worktrees, worktreePath);
  if (!target) throw new Error(`Not a worktree of this repository: ${worktreePath}`);
  if (target.isMain) throw new Error("Cannot remove the main worktree");

  try {
    await git(cwd, ["worktree", "remove", ...(force ? ["--force"] : []), target.path]);
  } catch (error) {
    throw new Error(extractGitError(error));
  }
  invalidateProjectCache();
}

function extractGitError(error: unknown): string {
  const stderr = (error as { stderr?: string }).stderr;
  if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
  return error instanceof Error ? error.message : String(error);
}
