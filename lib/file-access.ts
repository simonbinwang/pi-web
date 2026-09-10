import { readdirSync } from "fs";
import { homedir } from "os";
import path from "path";
import {
  getAdditionalAllowedRoots,
  isStableAdditionalAllowedRoot,
  normalizeSlashes,
} from "./allowed-roots";
import { isExistingPathWithinRoots, isPathWithinRoots } from "./path-security";
import { listAllSessions } from "./session-reader";
export { allowFileRoot, disallowFileRoot, normalizeSlashes } from "./allowed-roots";
export { isWindowsAbsolutePath } from "./paths";

// Short-TTL cache for the allowed-roots set. Without this, every file list/read
// request re-scans every pi session on disk just to check access. 5s is short
// enough that newly-created cwds appear promptly; stored on globalThis so it
// survives Next.js hot-reload.
declare global {
  var __piAllowedRootsCache: { roots: Set<string>; expiresAt: number } | undefined;
}

const ALLOWED_ROOTS_TTL_MS = 5_000;

/** Persisted sessions authorize their actual checkout cwd, never a canonical identity path. */
export function sessionCwdRoots(sessions: readonly { cwd?: string }[]): Set<string> {
  return new Set(
    sessions.flatMap((session) => session.cwd ? [normalizeSlashes(session.cwd)] : []),
  );
}

export async function getAllowedFileRoots(): Promise<Set<string>> {
  const now = Date.now();
  const cached = globalThis.__piAllowedRootsCache;
  if (cached && cached.expiresAt > now) return cached.roots;

  const sessions = await listAllSessions();
  const roots = sessionCwdRoots(sessions);

  // Also allow ~/pi-cwd-* directories created by the default-cwd endpoint.
  try {
    for (const name of readdirSync(homedir())) {
      if (/^pi-cwd-\d{8}$/.test(name)) {
        roots.add(normalizeSlashes(path.join(homedir(), name)));
      }
    }
  } catch {
    // ignore if home is unreadable
  }

  for (const root of getAdditionalAllowedRoots()) roots.add(root);

  globalThis.__piAllowedRootsCache = { roots, expiresAt: now + ALLOWED_ROOTS_TTL_MS };
  return roots;
}

/** Authorize a path lexically, without touching the filesystem. */
export function isFilePathAllowed(target: string, allowedRoots: Set<string>): boolean {
  return isPathWithinRoots(target, allowedRoots);
}

/** Authorize an existing path after resolving symbolic links. */
export function isExistingFilePathAllowed(target: string, allowedRoots: Set<string>): boolean {
  const additionalRoots = getAdditionalAllowedRoots();
  const stableRoots = new Set(
    [...allowedRoots].filter((root) => (
      !additionalRoots.has(root) || isStableAdditionalAllowedRoot(root)
    )),
  );
  return isExistingPathWithinRoots(target, stableRoots);
}
