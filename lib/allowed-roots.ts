import { closeSync, constants, fstatSync, openSync, realpathSync, statSync } from "fs";
import { samePath, toSlashPath } from "./paths";

// In-memory roots that should be browsable in addition to roots derived from
// persisted sessions. Stored on globalThis so Next.js hot-reload keeps them.
declare global {
  var __piAllowedRootsCache: { roots: Set<string>; expiresAt: number } | undefined;
  var __piAdditionalAllowedRoots: Set<string> | undefined;
  var __piAdditionalAllowedRootRealPaths: Map<string, { realPath: string; fd: number; dev: bigint; ino: bigint; birthtimeNs: bigint }> | undefined;
}

/**
 * Allowed roots are internal bookkeeping keys that are never displayed, so they
 * are stored slash-normalized for consistent Set membership. Correctness does
 * not depend on it — isPathWithinRoots() re-normalizes whatever it is given.
 */
export function normalizeSlashes(filePath: string): string {
  return toSlashPath(filePath);
}

export function getAdditionalAllowedRoots(): Set<string> {
  if (!globalThis.__piAdditionalAllowedRoots) {
    globalThis.__piAdditionalAllowedRoots = new Set();
  }
  return globalThis.__piAdditionalAllowedRoots;
}

function getAdditionalAllowedRootRealPaths(): Map<string, { realPath: string; fd: number; dev: bigint; ino: bigint; birthtimeNs: bigint }> {
  if (!globalThis.__piAdditionalAllowedRootRealPaths) {
    // Roots granted before this snapshot map existed cannot be trusted after HMR.
    for (const root of globalThis.__piAdditionalAllowedRoots ?? []) {
      globalThis.__piAllowedRootsCache?.roots.delete(root);
    }
    globalThis.__piAdditionalAllowedRoots?.clear();
    globalThis.__piAdditionalAllowedRootRealPaths = new Map();
  }
  return globalThis.__piAdditionalAllowedRootRealPaths;
}

export function allowFileRoot(root: string, expectedRealPath?: string): boolean {
  if (!root) return false;
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return false;
  }
  if (expectedRealPath && !samePath(realRoot, expectedRealPath)) return false;
  const normalizedRoot = normalizeSlashes(root);
  const realPaths = getAdditionalAllowedRootRealPaths();
  getAdditionalAllowedRoots().add(normalizedRoot);
  const previous = realPaths.get(normalizedRoot);
  if (previous && previous.fd >= 0) {
    try { closeSync(previous.fd); } catch { /* already closed */ }
  }
  let fd = -1;
  try { fd = openSync(realRoot, constants.O_RDONLY); } catch { /* platform fallback below */ }
  const identity = fd >= 0
    ? fstatSync(fd, { bigint: true })
    : statSync(realRoot, { bigint: true });
  realPaths.set(normalizedRoot, {
    realPath: realRoot,
    fd,
    dev: identity.dev,
    ino: identity.ino,
    birthtimeNs: identity.birthtimeNs,
  });
  globalThis.__piAllowedRootsCache?.roots.add(normalizedRoot);
  return true;
}

export function disallowFileRoot(root: string): void {
  const normalizedRoot = normalizeSlashes(root);
  getAdditionalAllowedRoots().delete(normalizedRoot);
  const realPaths = getAdditionalAllowedRootRealPaths();
  const granted = realPaths.get(normalizedRoot);
  if (granted && granted.fd >= 0) {
    try { closeSync(granted.fd); } catch { /* already closed */ }
  }
  realPaths.delete(normalizedRoot);
  globalThis.__piAllowedRootsCache?.roots.delete(normalizedRoot);
}

/** Reject an explicit grant if the path has since been replaced or retargeted. */
export function isStableAdditionalAllowedRoot(root: string): boolean {
  const normalizedRoot = normalizeSlashes(root);
  const granted = getAdditionalAllowedRootRealPaths().get(normalizedRoot);
  let stable = false;
  if (granted && typeof granted === "object") {
    try {
      const currentRealPath = realpathSync(root);
      const currentIdentity = statSync(currentRealPath, { bigint: true });
      const grantedIdentity = granted.fd >= 0
        ? fstatSync(granted.fd, { bigint: true })
        : granted;
      stable = samePath(currentRealPath, granted.realPath)
        && currentIdentity.dev === grantedIdentity.dev
        && currentIdentity.ino === grantedIdentity.ino
        && (granted.fd >= 0 || currentIdentity.birthtimeNs === granted.birthtimeNs);
    } catch {
      stable = false;
    }
  }
  if (!stable) disallowFileRoot(root);
  return stable;
}
