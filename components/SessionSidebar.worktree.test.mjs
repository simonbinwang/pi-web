import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { act, create } = await jiti.import("react-test-renderer");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { SessionSidebar } = await jiti.import("./SessionSidebar.tsx");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mainCwd = "/repo/packages/app";
const linkedCwd = "/linked/packages/app";

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function installBrowser(fetchImpl) {
  const values = new Map([
    ["pi-web:file-explorer:open", "false"],
    ["pi-locale", "en"],
  ]);
  let frame = 0;
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
    navigator: { languages: ["en"], language: "en" },
    requestAnimationFrame(callback) {
      const id = ++frame;
      queueMicrotask(() => callback(0));
      return id;
    },
    cancelAnimationFrame() {},
  };
  globalThis.document = {
    visibilityState: "hidden",
    documentElement: { lang: "en" },
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.requestAnimationFrame = window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
  globalThis.fetch = fetchImpl;
}

function worktreePayload(currentWorktreePath = "/repo") {
  return {
    projectRoot: mainCwd,
    projectKey: mainCwd,
    repositoryRoot: "/repo",
    checkoutRoot: currentWorktreePath,
    checkoutRelativePath: "packages/app",
    isGit: true,
    currentWorktreePath,
    worktrees: [
      {
        path: "/repo", branch: "main", isMain: true, targetCwd: mainCwd,
        available: true, isCurrent: currentWorktreePath === "/repo",
      },
      {
        path: "/linked", branch: "feature", isMain: false, targetCwd: linkedCwd,
        available: true, isCurrent: currentWorktreePath === "/linked",
      },
      {
        path: "/missing",
        branch: "missing",
        isMain: false,
        targetCwd: "/missing/packages/app",
        available: false,
        unavailableReason: "missing-relative-directory",
      },
    ],
  };
}

function commonResponse(url) {
  if (url === "/api/sessions") return response({ sessions: [] });
  if (url === "/api/home") return response({ home: "/home/test" });
  if (String(url).startsWith("/api/files/")) return response({ entries: [] });
  if (String(url).startsWith("/api/git/status")) return response({ entries: [] });
  throw new Error(`Unexpected request: ${url}`);
}

async function renderSidebar(fetchImpl, selectedCwd = mainCwd, onCwdChange = () => {}) {
  installBrowser(fetchImpl);
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(
      I18nProvider,
      null,
      React.createElement(SessionSidebar, {
        selectedSessionId: null,
        selectedCwd,
        skipInitialProjectSelection: true,
        onSelectSession() {},
        onCwdChange,
      }),
    ));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  return renderer;
}

async function openWorktreeMenu(root) {
  const switcher = root.findAllByType("button").find((button) =>
    String(button.props.title ?? "").startsWith("Switch worktree:"));
  assert.ok(switcher, "nested cwd renders the worktree control");
  await act(async () => {
    switcher.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

test("nested Sidebar renders current and unavailable worktrees, then switches with selected cwd", async (t) => {
  const calls = [];
  const cwdChanges = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith("/api/worktrees?")) return response(worktreePayload());
    if (url === "/api/worktrees" && init.method === "PATCH") return response({ targetCwd: linkedCwd });
    return commonResponse(url);
  };
  const renderer = await renderSidebar(fetchImpl, mainCwd, (cwd) => cwdChanges.push(cwd));
  t.after(() => act(() => renderer.unmount()));
  await openWorktreeMenu(renderer.root);

  const optionButtons = renderer.root.findAllByType("button");
  const current = optionButtons.find((button) => button.props.title === mainCwd);
  const linked = optionButtons.find((button) => button.props.title === linkedCwd);
  const missing = optionButtons.find((button) => String(button.props.title).includes("packages/app") && button.props.disabled);
  assert.ok(current, "current checkout target is rendered");
  assert.ok(linked, "linked checkout uses server targetCwd");
  assert.ok(missing, "missing target is visible and disabled");

  await act(async () => {
    linked.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const patch = calls.find((call) => call.init.method === "PATCH");
  assert.deepEqual(JSON.parse(patch.init.body), { cwd: mainCwd, path: "/linked" });
  assert.equal(cwdChanges.at(-1), linkedCwd);
});

test("Sidebar keeps cwd and displays the server error when creation target is missing", async (t) => {
  const cwdChanges = [];
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith("/api/worktrees?")) return response(worktreePayload());
    if (url === "/api/worktrees" && init.method === "POST") {
      return response({
        path: "/created",
        targetCwd: "/created/packages/app",
        available: false,
        unavailableReason: "missing-relative-directory",
        error: "This worktree does not contain the relative directory: packages/app",
      });
    }
    return commonResponse(url);
  };
  const renderer = await renderSidebar(fetchImpl, mainCwd, (cwd) => cwdChanges.push(cwd));
  t.after(() => act(() => renderer.unmount()));
  await openWorktreeMenu(renderer.root);

  const newButton = renderer.root.findAllByType("button").find((button) => button.props.title === "Create a worktree checkout for a branch");
  assert.ok(newButton);
  await act(async () => { newButton.props.onClick({ stopPropagation() {} }); });
  const input = renderer.root.findByProps({ placeholder: "branch name" });
  await act(async () => { input.props.onChange({ target: { value: "feature/new" } }); });
  const createButton = renderer.root.findAllByType("button").find((button) => button.children.includes("Create"));
  await act(async () => {
    createButton.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const post = calls.find((call) => call.init.method === "POST");
  assert.deepEqual(JSON.parse(post.init.body), { cwd: mainCwd, branch: "feature/new" });
  assert.equal(cwdChanges.at(-1), mainCwd);
  assert.match(JSON.stringify(renderer.toJSON()), /does not contain the relative directory/);
});

test("Sidebar refetches after removing a non-current worktree", async (t) => {
  let getCount = 0;
  const fetchImpl = async (url, init = {}) => {
    if (String(url).startsWith("/api/worktrees?")) {
      getCount += 1;
      const payload = worktreePayload();
      if (getCount > 1) payload.worktrees = payload.worktrees.filter((entry) => entry.path !== "/linked");
      return response(payload);
    }
    if (url === "/api/worktrees" && init.method === "DELETE") {
      return response({ success: true, fallbackCwd: null });
    }
    return commonResponse(url);
  };
  const renderer = await renderSidebar(fetchImpl);
  t.after(() => act(() => renderer.unmount()));
  await openWorktreeMenu(renderer.root);

  const remove = renderer.root.findAllByType("button").find((button) => String(button.props.title).startsWith("Remove worktree checkout /linked"));
  assert.ok(remove);
  await act(async () => {
    remove.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  assert.ok(getCount >= 2, "successful removal refetches server worktree state");
  assert.equal(
    renderer.root.findAllByType("button").some((button) => String(button.props.title).startsWith("Remove worktree checkout /linked")),
    false,
  );
});

test("Sidebar applies the server fallback after removing the current linked worktree", async (t) => {
  const cwdChanges = [];
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith("/api/worktrees?")) return response(worktreePayload("/linked"));
    if (url === "/api/worktrees" && init.method === "DELETE") return response({ success: true, fallbackCwd: mainCwd });
    return commonResponse(url);
  };
  const renderer = await renderSidebar(fetchImpl, linkedCwd, (cwd) => cwdChanges.push(cwd));
  t.after(() => act(() => renderer.unmount()));
  await openWorktreeMenu(renderer.root);

  const remove = renderer.root.findAllByType("button").find((button) => String(button.props.title).startsWith("Remove worktree checkout /linked"));
  assert.ok(remove);
  await act(async () => {
    remove.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const deletion = calls.find((call) => call.init.method === "DELETE");
  assert.deepEqual(JSON.parse(deletion.init.body), { cwd: linkedCwd, path: "/linked", force: false });
  assert.equal(cwdChanges.at(-1), mainCwd);
});
