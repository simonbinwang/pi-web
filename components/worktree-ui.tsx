import type { CSSProperties, ReactNode } from "react";

export type WorktreeUnavailableReason =
  | "missing-relative-directory"
  | "not-a-directory"
  | "outside-checkout";

export interface WorktreeUiEntry {
  path: string;
  targetCwd: string;
  available: boolean;
  unavailableReason?: WorktreeUnavailableReason;
  isMain: boolean;
  branch: string | null;
  /** Server-authoritative checkout identity; browser code must not compare paths. */
  isCurrent?: boolean;
}

export interface WorktreeUiState {
  forCwd: string;
  projectRoot: string;
  projectKey: string;
  isGit: boolean;
  repositoryRoot: string | null;
  checkoutRoot: string | null;
  currentWorktreePath: string | null;
  checkoutRelativePath: string;
  worktrees: WorktreeUiEntry[];
}

export interface WorktreeUiItem extends WorktreeUiEntry {
  disabled: boolean;
}

/** Browser-facing projection of the server contract; it does no path mapping. */
export function worktreeControlModel(
  state: WorktreeUiState | null,
  selectedCwd: string | null,
  selectedProjectKey: string | null,
): { visible: boolean; current: WorktreeUiEntry | null; entries: WorktreeUiItem[] } {
  const visible = Boolean(
    state?.isGit
    && selectedCwd
    && selectedProjectKey === state.projectKey,
  );
  const entries = (state?.worktrees ?? []).map((entry) => ({
    ...entry,
    disabled: !entry.available,
  }));
  const current = entries.find((entry) => entry.isCurrent) ?? null;
  return { visible, current, entries };
}

export function WorktreeSelectButton({
  entry,
  busy,
  title,
  onSelect,
  style,
  children,
}: {
  entry: WorktreeUiItem;
  busy: boolean;
  title: string;
  onSelect: (entry: WorktreeUiItem) => void;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <button
      onClick={() => onSelect(entry)}
      disabled={entry.disabled || busy}
      title={title}
      style={style}
    >
      {children}
    </button>
  );
}

export function selectableWorktreeCwd(entry: WorktreeUiEntry): string | null {
  return entry.available ? entry.targetCwd : null;
}

export function cwdAfterSelect(
  currentCwd: string,
  result: { targetCwd?: string },
): string {
  return result.targetCwd ?? currentCwd;
}

export function cwdAfterCreate(
  currentCwd: string,
  result: { targetCwd?: string; available?: boolean; error?: string },
): string {
  return result.available && result.targetCwd ? result.targetCwd : currentCwd;
}

export function cwdAfterRemove(
  currentCwd: string,
  result: { fallbackCwd?: string | null },
): string {
  return result.fallbackCwd ?? currentCwd;
}
