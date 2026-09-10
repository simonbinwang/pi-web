import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url, { jsx: { runtime: "automatic" } }).import("./worktree-ui.tsx");
}

const nestedState = {
  isGit: true,
  projectKey: "/repo/packages/app",
  currentWorktreePath: "/server-identity-only",
  checkoutRelativePath: "packages/app",
  worktrees: [
    { path: "/repo", targetCwd: "/repo/packages/app", available: true, isMain: true, isCurrent: true },
    { path: "/linked", targetCwd: "/linked/packages/app", available: true, isMain: false, isCurrent: false },
    { path: "/missing", targetCwd: "/missing/packages/app", available: false, unavailableReason: "missing-relative-directory", isMain: false, isCurrent: false },
  ],
};

test("nested Git workspaces show the control and identify the containing checkout", async () => {
  const { worktreeControlModel } = await loadSubject();
  const model = worktreeControlModel(nestedState, "/repo/packages/app", "/repo/packages/app");
  assert.equal(model.visible, true);
  assert.equal(model.current?.path, "/repo");
  assert.equal(model.current?.isCurrent, true);
  assert.equal(model.entries[2].disabled, true);
  assert.equal(model.entries[2].unavailableReason, "missing-relative-directory");
  assert.equal(nestedState.checkoutRelativePath, "packages/app");
});

test("selection rows expose disabled state and wire the server target entry", async () => {
  const { cwdAfterSelect, selectableWorktreeCwd, WorktreeSelectButton, worktreeControlModel } = await loadSubject();
  assert.equal(selectableWorktreeCwd(nestedState.worktrees[1]), "/linked/packages/app");
  assert.equal(selectableWorktreeCwd(nestedState.worktrees[2]), null);
  assert.equal(
    cwdAfterSelect("/repo/packages/app", { targetCwd: "/linked/packages/app" }),
    "/linked/packages/app",
  );

  const model = worktreeControlModel(nestedState, "/repo/packages/app", nestedState.projectKey);
  let selected = null;
  const availableButton = WorktreeSelectButton({
    entry: model.entries[1], busy: false, title: model.entries[1].targetCwd,
    onSelect: (entry) => { selected = entry.targetCwd; }, children: "feature",
  });
  assert.equal(availableButton.props.disabled, false);
  availableButton.props.onClick();
  assert.equal(selected, "/linked/packages/app");

  const unavailableButton = WorktreeSelectButton({
    entry: model.entries[2], busy: false, title: "Missing relative directory: packages/app",
    onSelect: () => assert.fail("disabled entry selected"), children: "missing",
  });
  assert.equal(unavailableButton.props.disabled, true);
  assert.match(unavailableButton.props.title, /packages\/app/);
});

test("creation errors retain cwd while removal applies the server fallback", async () => {
  const { cwdAfterCreate, cwdAfterRemove } = await loadSubject();
  assert.equal(cwdAfterCreate("/repo/packages/app", {
    targetCwd: "/created/packages/app",
    available: false,
    error: "missing packages/app",
  }), "/repo/packages/app");
  assert.equal(cwdAfterCreate("/repo/packages/app", {
    targetCwd: "/created/packages/app",
    available: true,
  }), "/created/packages/app");
  assert.equal(cwdAfterRemove("/linked/packages/app", { fallbackCwd: "/repo/packages/app" }), "/repo/packages/app");
});
