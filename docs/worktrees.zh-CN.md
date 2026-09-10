# Pi Web 里的 Worktree

Pi Web 会在侧边栏显示同一 Git 项目的所有 worktree。你可以为不同分支保留独立 checkout，同时把相关会话归在同一项目下。

## 什么时候会看到 Worktree 控件

只要所选目录位于可读取的 Git checkout 内，worktree 切换器就会出现。这既包括 checkout 根目录，也包括 monorepo package 等任意子目录。即使仓库尚无 linked worktree，控件也会显示，因此无需离开当前目录即可创建第一个 worktree。

所选目录不在 Git 中，或 Git 无法读取仓库的 worktree 列表时，控件才会隐藏。

## 切换 Worktree

Pi Web 会保留所选目录相对于 checkout 的路径。例如，从：

```text
/repo/packages/app
```

切换到 `/repo-worktrees/feature` 时，实际选择的是：

```text
/repo-worktrees/feature/packages/app
```

所选目录会影响：

- 从侧边栏新建的会话。
- File Explorer。
- 从 Explorer 插入的文件 mention。

已有会话会保留创建时的 working directory。打开已有会话时，有效工作目录会回到该会话原本的 checkout。

如果某个 worktree 不包含对应的相对目录，它仍会显示在列表中，但无法选择，并会说明缺少哪个目录。Pi Web 不会静默回退到该 worktree 的根目录。

## 新建 Worktree

选择 `新建 worktree…` 并输入 branch name。Pi Web 会把 checkout 创建在：

```text
<repo>-worktrees/<sanitized-branch>
```

目录名会把 branch 分隔符、空白和文件系统保留字符替换为 `-`；Git branch name 本身不会改变。如果 branch 已存在，Pi Web 会为它添加 worktree；否则从当前 `HEAD` 创建 branch。对应相对目录存在时，Pi Web 会自动选择该目录。

即使 branch 中不存在当前相对目录，worktree 创建本身仍可能成功。此时 Pi Web 会保留新 worktree、停留在当前目录并显示错误，不会删除 worktree，也不会切换到它的根目录。

## 删除 Worktree

可使用 non-main worktree 右侧的删除按钮。删除当前选中的 linked worktree 后，Pi Web 会回到 main checkout 中对应的相对目录。

删除操作不会删除 Git branch、Pi Web 历史会话或 main checkout。如果 checkout 中有未提交或未跟踪文件，Git 会拒绝删除；Pi Web 随后会提供 force remove。强制删除会丢弃这些文件。

## 会话和项目分组

Pi Web 使用“main repository + checkout-relative path”形成 canonical identity，并据此归组对应目录。因此 `/repo/packages/app` 与 `/linked/packages/app` 属于同一项目，而 `/repo` 仍是独立项目。历史会话会在读取时按此规则归组，不会修改 session 文件。

linked worktree 被删除后，只要 Pi Web 能从原 checkout 布局推断身份，其旧会话仍会保留在 canonical project 下。

## 常见问题

**为什么看不到 worktree 切换器？**
请确认所选目录位于 Git checkout 内，并且 Git 能列出该仓库的 worktree。

**为什么某个 worktree 无法选择？**
该 checkout 缺少当前 checkout-relative directory，或映射路径未通过文件系统安全检查。请先在对应 branch 中创建该目录。

**为什么某个 branch 不能创建 worktree？**
Git 不允许同一个 branch 同时被多个 worktree checkout。请切换到已有 worktree，或先删除它。

**Explorer 和当前聊天看起来不在同一个 branch？**
Explorer 跟随当前选择的 worktree 目录；聊天跟随打开的会话。重新点击会话即可让侧边栏回到该会话所在的 checkout。
