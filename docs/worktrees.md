# Worktrees in Pi Web

Pi Web can show all Git worktrees for one project in the sidebar. Use this to keep separate checkouts for different branches while keeping related sessions grouped together.

## When the Worktree Control Appears

The worktree switcher appears when the selected directory is anywhere inside a readable Git checkout. This includes a checkout root and nested directories such as a package in a monorepo. The control is available even before the repository has a linked worktree, so you can create the first one without leaving your current directory.

It is hidden when the selected directory is outside Git or Git cannot read the repository's worktree list.

## Switching Worktrees

Pi Web preserves the selected directory's path relative to its checkout. For example, switching from:

```text
/repo/packages/app
```

to a worktree at `/repo-worktrees/feature` selects:

```text
/repo-worktrees/feature/packages/app
```

The selected directory affects:

- New sessions started from the sidebar.
- The File Explorer.
- File mentions inserted from the Explorer.

Existing sessions keep their original working directory. Opening one moves the effective working directory back to that session's checkout.

If a worktree does not contain the corresponding relative directory, it remains visible but is disabled and explains which directory is missing. Pi Web never falls back silently to that worktree's root.

## Creating a Worktree

Choose `New worktree...` and enter a branch name. Pi Web creates the checkout at:

```text
<repo>-worktrees/<sanitized-branch>
```

The directory name replaces branch separators, whitespace, and filesystem-reserved characters with `-`; the Git branch name itself is unchanged. If the branch exists, Pi Web adds a worktree for it; otherwise it creates the branch from the current `HEAD`. When the corresponding relative directory exists, Pi Web selects it automatically.

Creation can succeed even when the branch does not contain the current relative directory. In that case Pi Web keeps the new worktree, stays in the current directory, and displays an error. It does not remove the worktree or switch to its root.

## Removing a Worktree

Use the remove button next to a non-main worktree. If you remove the currently selected linked worktree, Pi Web returns to the corresponding directory in the main checkout.

Removal does not delete the Git branch, Pi Web session history, or the main checkout. Git refuses to remove a checkout with uncommitted or untracked files; Pi Web then offers force removal, which discards those files.

## Sessions and Project Grouping

Pi Web groups corresponding directories across checkouts by a canonical identity made from the main repository and checkout-relative path. Thus `/repo/packages/app` and `/linked/packages/app` share a project, while `/repo` remains a separate project. Historical sessions are grouped this way when read; session files are not modified.

If a linked worktree is later removed, its old sessions remain visible under the canonical project when Pi Web can infer the original checkout layout.

## Troubleshooting

**I do not see the worktree switcher.**
Confirm that the selected directory is inside a Git checkout and that Git can list its worktrees.

**A worktree is disabled.**
That checkout is missing the selected checkout-relative directory, or the mapped path failed a filesystem safety check. Create the directory on that branch before switching.

**A branch cannot be added as a worktree.**
Git allows a branch to be checked out in only one worktree at a time. Switch to the existing worktree or remove it first.

**The Explorer shows a different branch than the open chat.**
The Explorer follows the selected worktree directory; the chat follows the opened session. Click the session again to return the sidebar to that session's checkout.
