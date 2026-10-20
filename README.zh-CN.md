# Xova Actions

[English](README.md) | 简体中文

用于公开 npm 包发布与文档交付的可组合 GitHub Actions，附带 Changelogen 准备工具和简短的发布 Skill。项目拥有工具链、检查、发布材料、环境和部署策略；组织默认配置与模板仍归 `xova-dev/.github`。

当前仍是未发布的本地草稿，所有 `@v1` 都是占位引用。接口发布并验证后，应固定到已核实的完整提交 SHA。尚未迁移消费仓库，真实 npm OIDC 与部署仍未验收。

## 选择入口

| 入口 | 职责 |
| --- | --- |
| [actions/](actions/) | 可组合步骤；调用方负责检出、工具、依赖与任务策略。 |
| [.github/workflows/](.github/workflows/) | Ubuntu 常用组合，默认 Node/npm，可显式选择消费项目的 mise。 |
| [lib/](lib/) | 内部实现，不是公共 CLI API。 |
| [release.mjs](scripts/release.mjs) | 面向单包、显式版本的 Changelogen 预览与准备。 |
| [xova-release](skills/xova-release/SKILL.md) | 保留项目检查和授权边界的智能体指引。 |

先读[结构与接口契约](docs/architecture.zh-CN.md)，再读[接入指南](docs/adoption.zh-CN.md)。

## 独立消费样例

- [npm-package](examples/npm-package/publish.yml)：仅使用 npm，通过发布工作流接入，不需要 mise 或 pnpm。
- [subpackage](examples/subpackage/publish.yml)：子目录单包，使用 `widget@` 标签前缀，由调用方安排工具链。
- [docs-only](examples/docs-only/docs.yml)：没有 package.json 或 npm 发布，从 main 部署文档。
- [multi-site](examples/multi-site/docs.yml)：两个 npm workspace 站点的蓝图，分别使用独立产物、环境和 Cloudflare 目标；需提供 workspace、锁定的 Wrangler 及配置。

前三个目录包含可运行的最小源码。测试执行检查、构建和实际 composite shell 步骤，替代发布与托管的产物/Pages API。多站点测试覆盖两个产物与恢复路径，不运行真实 Wrangler。发布前按接入指南替换示例包名与仓库元数据；docs-only 包含隐藏的 .well-known 内容，用于检查 Pages 上传入口。

[Matrix](examples/matrix/publish.yml) 和 [RSP](examples/rsp/publish.yml) 演示项目策略：必需 CI、显式 mise/pnpm、发布后部署，以及在取得部署并发锁后检查最新稳定版本。部署适配器本身不要求 npm 或 GitHub Release。

## 发布准备

安装本工具库锁定的依赖后执行：

```sh
node /path/to/actions/scripts/release.mjs preview 0.4.0 --cwd /path/to/project
node /path/to/actions/scripts/release.mjs prepare 0.4.0 --cwd /path/to/project
```

准备步骤在干净工作区更新版本和 changelog，不提交、不打标签、不推送、不发布，也不创建 GitHub Release。检查差异并补充版本说明、迁移指南及其他必要修改。详见[发布与恢复](docs/releasing.zh-CN.md)。

## 开发

```sh
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm test
mise exec -- pnpm lint
```

维护者的 mise 工具不配置消费项目。mise.toml 固定 actionlint 1.7.12 与 action-validator 0.9.0，CI 沿用 mise 初始化后直接运行 pnpm lint，不需要 Docker。本地 mise install 会下载缺少的工具。

Lint 入口使用 actionlint 检查工作流与样例，并通过 action-validator 的元数据 schema 递归检查 actions/ 下的 action.yml/action.yaml。Schema 检查不执行 shell 命令，也不完整检查 composite 表达式；契约与行为测试覆盖选定执行路径。Actionlint 的精确排除项仅处理旧版工具尚未支持的 GitHub.com 同提交 `$/actions/...` 语法，引用与输入契约由测试检查。详见 [GitHub 工作流语法](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsuses)。
