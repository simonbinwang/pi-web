import { NextResponse } from "next/server";
import { existsSync } from "fs";
import {
  addWorktree,
  findCurrentWorktreePath,
  findWorktreeByPath,
  listWorktrees,
  removeWorktree,
  resolveProject,
  type WorktreeInfo,
} from "@/lib/worktree";
import {
  allowFileRoot,
  disallowFileRoot,
  getAllowedFileRoots,
  isExistingFilePathAllowed,
  isFilePathAllowed,
} from "@/lib/file-access";
import { projectIdentityKey } from "@/lib/project-identity";
import { samePath } from "@/lib/paths";

/** Same gate as /api/files: only actual session cwds and explicitly
 * allowed, real-path-stable dirs may be inspected or mutated here. */
async function checkCwdAllowed(cwd: string): Promise<NextResponse | null> {
  const allowedRoots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, allowedRoots) || !isExistingFilePathAllowed(cwd, allowedRoots)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  return null;
}

function authorizeMappedTarget(worktree: WorktreeInfo): boolean {
  return Boolean(
    worktree.available
    && worktree.targetRealPath
    && allowFileRoot(worktree.targetCwd, worktree.targetRealPath),
  );
}

function unavailableMessage(worktree: WorktreeInfo, checkoutRelativePath: string): string {
  if (worktree.unavailableReason === "missing-relative-directory") {
    return `This worktree does not contain the relative directory: ${checkoutRelativePath || "."}`;
  }
  if (worktree.unavailableReason === "not-a-directory") {
    return `The mapped worktree target is not a directory: ${worktree.targetCwd}`;
  }
  return `The mapped worktree target is outside the checkout: ${worktree.targetCwd}`;
}

async function worktreeContext(cwd: string) {
  const project = await resolveProject(cwd, { fresh: true });
  const gitCwd = existsSync(cwd) ? cwd : project.projectRoot;
  const worktrees = await listWorktrees(gitCwd);
  return { project, worktrees };
}

// GET /api/worktrees?cwd= → repository/checkout identity plus mapped worktree targets.
export async function GET(req: Request) {
  try {
    const cwd = new URL(req.url).searchParams.get("cwd");
    if (!cwd) return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    const denied = await checkCwdAllowed(cwd);
    if (denied) return denied;

    const project = await resolveProject(cwd, { fresh: true });
    let worktrees: WorktreeInfo[] = [];
    let currentWorktreePath: string | null = null;
    let isGit = true;
    try {
      worktrees = await listWorktrees(existsSync(cwd) ? cwd : project.projectRoot);
      currentWorktreePath = findCurrentWorktreePath(worktrees, cwd);
      worktrees = worktrees.map((worktree) => ({
        ...worktree,
        isCurrent: currentWorktreePath !== null && samePath(worktree.path, currentWorktreePath),
      }));
    } catch {
      isGit = false;
    }
    // Authorize only corresponding nested targets that passed lexical and
    // real-path containment. A nested session must not expose checkout siblings.
    worktrees = worktrees.map((worktree) => {
      if (authorizeMappedTarget(worktree)) return worktree;
      disallowFileRoot(worktree.targetCwd);
      return worktree.available
        ? { ...worktree, available: false, unavailableReason: "outside-checkout", targetRealPath: undefined }
        : worktree;
    });

    return NextResponse.json({
      projectRoot: project.projectRoot,
      projectKey: projectIdentityKey(project.projectRoot),
      repositoryRoot: project.repositoryRoot,
      checkoutRoot: project.checkoutRoot,
      checkoutRelativePath: project.checkoutRelativePath,
      isGit,
      isTopLevel: project.isTopLevel,
      currentWorktreePath,
      worktrees,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH /api/worktrees body: { cwd, path } → freshly validated mapped cwd.
export async function PATCH(req: Request) {
  try {
    const body = await req.json() as { cwd?: string; path?: string };
    if (!body.cwd || typeof body.cwd !== "string") {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    if (!body.path || typeof body.path !== "string") {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }
    const denied = await checkCwdAllowed(body.cwd);
    if (denied) return denied;

    const { project, worktrees } = await worktreeContext(body.cwd);
    const target = findWorktreeByPath(worktrees, body.path);
    if (!target) {
      return NextResponse.json({ error: `Not a worktree of this repository: ${body.path}` }, { status: 400 });
    }
    if (!target.available) {
      disallowFileRoot(target.targetCwd);
      return NextResponse.json({
        error: unavailableMessage(target, project.checkoutRelativePath),
        unavailableReason: target.unavailableReason,
        targetCwd: target.targetCwd,
      }, { status: 409 });
    }
    if (!authorizeMappedTarget(target)) {
      disallowFileRoot(target.targetCwd);
      return NextResponse.json({
        error: "The mapped worktree target changed during validation",
        unavailableReason: "outside-checkout",
        targetCwd: target.targetCwd,
      }, { status: 409 });
    }
    return NextResponse.json({ targetCwd: target.targetCwd });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// POST /api/worktrees body: { cwd, branch } → created checkout and mapped target.
export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: string; branch?: string };
    if (!body.cwd || typeof body.cwd !== "string") {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    if (!body.branch || typeof body.branch !== "string") {
      return NextResponse.json({ error: "branch is required" }, { status: 400 });
    }
    const denied = await checkCwdAllowed(body.cwd);
    if (denied) return denied;
    if (!existsSync(body.cwd)) {
      return NextResponse.json({ error: `Directory does not exist: ${body.cwd}` }, { status: 400 });
    }

    const project = await resolveProject(body.cwd, { fresh: true });
    const created = await addWorktree(body.cwd, body.branch);
    // Re-list after creation: the response uses the same authoritative mapper
    // as GET/PATCH and does not roll back a checkout whose nested target is absent.
    const worktrees = await listWorktrees(body.cwd);
    const mapped = findWorktreeByPath(worktrees, created.path);
    if (!mapped) throw new Error(`Created worktree was not reported by Git: ${created.path}`);
    const mappedForResponse: WorktreeInfo = mapped.available && !authorizeMappedTarget(mapped)
      ? { ...mapped, available: false, unavailableReason: "outside-checkout", targetRealPath: undefined }
      : mapped;
    if (!mappedForResponse.available) disallowFileRoot(mappedForResponse.targetCwd);
    return NextResponse.json({
      ...created,
      targetCwd: mappedForResponse.targetCwd,
      available: mappedForResponse.available,
      ...(mappedForResponse.unavailableReason ? {
        unavailableReason: mappedForResponse.unavailableReason,
        error: unavailableMessage(mappedForResponse, project.checkoutRelativePath),
      } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// DELETE /api/worktrees body: { cwd, path, force? }
export async function DELETE(req: Request) {
  try {
    const body = await req.json() as { cwd?: string; path?: string; force?: boolean };
    if (!body.cwd || typeof body.cwd !== "string") {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    if (!body.path || typeof body.path !== "string") {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }
    const denied = await checkCwdAllowed(body.cwd);
    if (denied) return denied;

    const { project, worktrees } = await worktreeContext(body.cwd);
    const target = findWorktreeByPath(worktrees, body.path);
    if (!target) throw new Error(`Not a worktree of this repository: ${body.path}`);
    const currentPath = findCurrentWorktreePath(worktrees, body.cwd);
    const main = worktrees.find((worktree) => worktree.isMain);
    const removesCurrentCheckout = Boolean(currentPath && samePath(target.path, currentPath));
    if (removesCurrentCheckout && !main?.available) {
      const reason = main
        ? unavailableMessage(main, project.checkoutRelativePath)
        : "The main worktree is unavailable";
      return NextResponse.json({ error: `Cannot remove the current worktree: ${reason}` }, { status: 409 });
    }
    const fallbackCwd = removesCurrentCheckout ? main!.targetCwd : null;
    if (removesCurrentCheckout && !authorizeMappedTarget(main!)) {
      return NextResponse.json({
        error: "Cannot remove the current worktree: The main worktree target changed during validation",
      }, { status: 409 });
    }

    await removeWorktree(body.cwd, target.path, body.force === true);
    disallowFileRoot(target.targetCwd);
    return NextResponse.json({ success: true, fallbackCwd });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const dirty = /contains modified or untracked files|is dirty/i.test(message);
    return NextResponse.json({ error: message, dirty }, { status: dirty ? 409 : 400 });
  }
}
