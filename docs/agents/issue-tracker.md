# Issue tracker：GitHub

本仓库的 issue、ticket 和 spec 存放在 GitHub Issues 中。所有操作使用 `gh` CLI。

## 内容语言

生成或更新以下内容时，默认使用简体中文：

- Issue 和 ticket 的标题、正文
- 验收标准、实施计划和调查结论
- Issue 评论及关闭说明
- Wayfinding map 与子 ticket 的说明

代码、命令、文件路径、API 名称、类型名、配置键、日志原文和其他使用英文更准确的技术内容保留英文。

引用用户原文时保留原始语言。用户明确要求其他语言时，以用户要求为准。

## 常用操作

- **创建 issue**：`gh issue create --title "..." --body "..."`
- **读取 issue**：`gh issue view <number> --comments`
- **列出 issue**：使用 `gh issue list`，并按需指定 label 和 state
- **评论**：`gh issue comment <number> --body "..."`
- **添加或移除 label**：使用 `gh issue edit`
- **关闭**：`gh issue close <number> --comment "..."`

在仓库 clone 内运行时，让 `gh` 根据 `git remote -v` 自动确定仓库。

多行正文使用 heredoc，正文内容遵循上述中文规则。

## Pull request 是否进入 triage

**PRs as a request surface: no.**

如果以后改为 `yes`，外部 PR 将使用与 issue 相同的 triage 状态。对 PR 生成的评论和说明同样默认使用简体中文。

GitHub 的 issue 和 PR 共用编号空间。遇到 `#42` 时，先运行 `gh pr view 42`，失败后再运行 `gh issue view 42`。

## Skill 操作约定

当 skill 要求“发布到 issue tracker”时，创建 GitHub issue。

当 skill 要求“读取相关 ticket”时，运行：

`gh issue view <number> --comments`

`to-tickets`、`to-spec`、`triage` 及其他创建或更新 issue 的 skill 必须遵循本文件的内容语言规则。

## Wayfinding 操作

Wayfinding map 是带有 `wayfinder:map` label 的 GitHub issue。子 ticket 使用 `wayfinder:<type>` label；GitHub 支持时使用 sub-issue。

阻塞关系优先使用 GitHub 原生 issue dependencies。领取工作时运行：

`gh issue edit <number> --add-assignee @me`

完成子 ticket 时：

1. 使用简体中文评论结论
2. 关闭子 ticket
3. 在 map 中添加指向结论的上下文链接

命令、label、GitHub 字段名和技术标识符保留英文。
