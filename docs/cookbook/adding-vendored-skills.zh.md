# Cookbook：vendoring 外部 skill 集

[English](adding-vendored-skills.md) | 中文

本仓库携带一批第二方的 skill（技能）：来自 `amd/skills` 的 AMD GPU skill，已复制进 `.agents/skills/`。本指南说明这批 skill 如何复制、一次 checkout 如何证明复制结果可用，以及会话如何调用它。[subsystems/skills.zh.md](../subsystems/skills.zh.md) 负责发现优先级、调用策略与 `skill` 工具的约定；[adding-a-vendored-package.zh.md](adding-a-vendored-package.zh.md) 是 vendored 源码包的对应流程。

## 1. 复制 skill 目录

一个 skill 就是一个目录，内含 `SKILL.md`，以及该 skill 自己的 `references/`、`scripts/`、`templates/`、`evals/` 子目录。逐个目录原样复制到 `.agents/skills/<name>/`，kebab-case 名称保持不变：

```
.agents/skills/<name>/
  SKILL.md         # YAML frontmatter: name, description (+ optional whenToUse, metadata)
  reference.md     # optional supporting material the body links to
  scripts/         # optional executables the body invokes
  evals/           # optional upstream evaluation fixtures
  .federated.json  # optional upstream coordinates shipped by the source repository
```

复制整个目录而不是只复制 `SKILL.md`：正文链接 `reference.md` 或运行 `scripts/detect.py` 时，缺少这些文件就无法使用。保留上游名称，因为 frontmatter 的 `name` 必须等于目录名称，而 `skill` 工具正是按该名称寻址 skill。

在本地提供方的扫描顺序中，`.agents/skills` 的 rank 为 200（`project-agents`），低于 `<projectRoot>/.dsh/skills`，高于所有用户级根目录。因此 vendored skill 会胜过用户自己 skill 目录中的同名 skill，而 rank 100 的本仓库原创 skill 仍然胜过它。

## 2. 记录来源

`scripts/vendored-skills.manifest.json` 是 vendored 清单的唯一来源。它把整批 skill 固定到来源仓库的一个 commit，并为每个 skill 固定一个 commit，因此后续刷新可以比对发生了什么变化：

```json
{
  "vendored_from": { "repo": "amd/skills", "ref": "main", "commit": "ff5f4cc", "source_commit_date": "2026-11-05T13:22:55-07:00", "imported_at": "2026-11-06" },
  "skills": [
    { "name": "rocm-doctor", "upstream": { "repo": "ROCm/rocm-cli", "ref": "main", "commit": "e6d2f7c0d7", "license": "MIT" } }
  ]
}
```

每条 `upstream` 记录该 skill 自身的来源。`amd/skills` 的大部分 skill 来自真正拥有这套工具的项目——`rocm-doctor` 来自 `ROCm/rocm-cli`，`tracelens-analysis-orchestrator` 来自 `AMD-AGI/TraceLens`——并在该目录的 `.federated.json` 中携带这些坐标。把它们复制进清单，而不是把每个 skill 都归给聚合仓库。来源仓库自己编写的 skill，其 upstream 记为 `amd/skills`。

许可证来自同一份记录。仅当来源对该 skill 未声明许可证时，才把 `license` 保留为 `null`；在再分发的 fork 中发布 vendored 批次之前，先确认聚合仓库自身的许可证。

## 3. 证明复制结果可用

发现流程读取 skill 包构建后的 `lib/` 输出，因此先构建再检查：

```sh
pnpm install
pnpm run build
pnpm run verify-vendored-skills
```

该检查用本仓库启动随包的注册表与本地提供方，然后对清单中的每个名称断言四项事实：该 skill 被发现、它由 `project-agents` 胜出、`ctx.skills.get()` 能加载它，且加载到的正文长度可观。它为每个 `SKILL.md` 打印一段 `sha256` 前缀，因此一次通过的运行能确定被加载的确切字节；它从不打印 skill 正文。`scripts/vendored-skills.spec.ts` 在单元测试套件内执行同样的断言。

| 检查 | 证明了什么 |
|---|---|
| `verify-vendored-skills` | 清单中每个名称都被 `project-agents` 发现并且可以加载 |
| `vendored-skills.spec.ts` | 清单格式正确，且每个 `SKILL.md` 的 name 等于自己的目录名 |
| `verify-skill-invocation-metadata` | 携带 `agents/openai.yaml` 的 skill，其 Codex 与 Claude 调用元数据保持一致 |

## 4. 在会话中使用 vendored skill

随包的 profile 都提供 `skill` 工具，而每个会话的 skill 目录就是该会话工作目录的发现结果。在本 checkout 内启动 harness，这批 vendored skill 会带着各自的描述进入目录；只有当任务点名或明显匹配某个 skill 时，模型才加载其正文。在聊天会话中直接输入 `/rocm-doctor` 即可调用该 skill。在 shell 中：

```sh
pnpm dsh headless "Use the rocm-doctor skill to diagnose this ROCm install"
```

正文是给 agent 的指令，因此一个 skill 的价值取决于它所驱动的工具。`rocm-doctor` 要求会话运行的那台机器上有 `rocm` CLI；`serving-llms-on-instinct` 需要 AMD Instinct GPU 与已安装的 ROCm。缺少前置条件时该 skill 会报告无法继续——这是 skill 按书写方式正常工作，而不是发现流程失败。

## 5. vendored 正文必须满足的条件

- frontmatter 需要 `name` 与 `description`；`name` 为 kebab-case 且等于目录名。frontmatter 缺失、无法解析、或缺少这两个字段之一的正文会被跳过并记录警告，永远不会进入目录清单。
- description 是路由文本。目录清单渲染它时会被 `tool-skill` 的 `catalogDescriptionMaxLength` 截断，因此隐藏触发条件的 description 会让 skill 更难被选中，过长的 description 则会丢掉尾部。
- 只有两个调用控制键会被读取：`disable-model-invocation` 与 `user-invocable`。`allowed-tools` 或 `license` 这类未知键会被忽略而不是拒绝，因此上游 frontmatter 可以原样加载；但这两个调用键的 camelCase 拼法会被直接拒绝。
- skill 查找只下探一层。`<name>/SKILL.md` 与扁平的 `<name>.md` 是 skill；嵌套的 `references/<x>/SKILL.md` 不会被发现。上游仓库自有的嵌套 sub-skill，例如 `tracelens-analysis-orchestrator/agents/` 下的各 analyzer，提供的是被加载正文作为文件读取的指令，而不是额外的目录条目。

## 6. 刷新 vendored 批次

从被固定 commit 的后继版本重新复制，并在同一处变更中更新清单，这样记录永远不会描述树中并不存在的字节：

1. 拉取来源仓库，把它的新 commit 写入 `vendored_from`。
2. 整体替换每个 skill 目录，而不是逐文件合并，然后重新读取每个 `.federated.json` 并写入 `skills[].upstream`。
3. 运行 `pnpm run verify-vendored-skills` 与 `pnpm run verify-skill-invocation-metadata`。
4. 把打印出的 `SKILL.md` 摘要与上一次运行比对，确认哪些正文真正发生变化，并在发布前逐一复核发生变化的正文。

vendored skill 是上游文本，不是本仓库的策略。对 vendored `SKILL.md` 的本地修改必须记录在承载该修改的清单条目中，否则下一次刷新会静默地把它们还原。
