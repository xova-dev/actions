# Xova Actions

[English](README.md) | 简体中文

用于公开 npm 包发布与文档交付的可组合 GitHub Actions，附带 release-it 预设和简短的发布 Skill。项目拥有工具链、检查、发布材料、环境和部署策略；组织默认配置与模板仍归 `xova-dev/.github`。

当前尚未发布稳定接口，所有 `@v1` 都是占位引用。接口发布并验证后，应固定到已核实的完整提交 SHA。尚未迁移消费仓库，真实 npm OIDC 与部署仍未验收。

## 选择入口

| 入口 | 职责 |
| --- | --- |
| [actions/](actions/) | 可组合步骤；调用方负责检出、工具、依赖与任务策略。 |
| [.github/workflows/](.github/workflows/) | Ubuntu 常用组合，默认 Node/npm，可显式选择消费项目的 mise。 |
| [lib/](lib/) | 内部实现，不是公共 CLI API。 |
| [release-it 预设](config/.release-it.json) | 共享准备配置与官方 Conventional Changelog 插件。 |
| [发布预设](config/npm-publish.mjs) | release-it 内置 npm 发布器，附带候选与 tarball 校验。 |
| [xova-release](skills/xova-release/SKILL.md) | 保留项目检查和授权边界的智能体指引。 |

先读[结构与接口契约](docs/architecture.zh-CN.md)，再读[接入指南](docs/adoption.zh-CN.md)。

## 独立消费样例

- [npm-package](examples/npm-package/publish.yml)：仅使用 npm，通过发布工作流接入，不需要 mise 或 pnpm。
- [subpackage](examples/subpackage/publish.yml)：子目录单包，使用 `widget@` 标签前缀，由调用方安排工具链。
- [docs-only](examples/docs-only/docs.yml)：没有 package.json 或 npm 发布，从 main 部署文档。
- [multi-site](examples/multi-site/docs.yml)：两个 npm workspace 站点的蓝图，分别使用独立产物、环境和 Cloudflare 目标；需提供 workspace、锁定的 Wrangler 及配置。

前三个目录包含可运行的最小源码。测试执行检查、构建、真实 release-it CLI 和实际 composite shell 步骤，替代发布与托管的产物/Pages API。Fixture 用 --omit=dev 安装消费源码，并显式链接工具库锁定的 release-it 安装；CI 还完整安装两个 npm 样例的锁定依赖并运行其 CLI。多站点测试覆盖两个产物与恢复路径，不运行真实 Wrangler。发布前按接入指南替换示例包名与仓库元数据；docs-only 包含隐藏的 .well-known 内容，用于检查 Pages 上传入口。

[Matrix](examples/matrix/publish.yml) 和 [RSP](examples/rsp/publish.yml) 演示项目策略：必需 CI、显式 mise/pnpm、发布后部署，以及在取得部署并发锁后检查最新稳定版本。部署适配器本身不要求 npm 或 GitHub Release。

## 发布准备

消费方可以继承 [release-it 配置](docs/release-it.zh-CN.md)，直接使用原生 CLI 和 hooks，无须复制准备脚本。预设关闭提交、标签、推送、npm 发布及 GitHub/GitLab Release。准备工具使用 release-it 21.1.1 与 @release-it/conventional-changelog 12.0.2，要求 Node ^22.22.2、^24.15.0 或 >=26.0.0。

配置消费方后，直接使用其已安装的 CLI：

```sh
pnpm exec release-it 0.4.0 --ci --dry-run
pnpm exec release-it 0.4.0 --ci
```

准备步骤在干净工作区更新版本和 changelog，不提交、不打标签、不推送、不发布，也不创建 GitHub Release。检查差异并补充版本说明、迁移指南及其他必要修改。消费方 hooks 正常执行；官方插件可能暂存新建的 changelog。详见[发布与恢复](docs/releasing.zh-CN.md)。

发布要求消费方在开发依赖中锁定 release-it 21.1.1，使用其原生 CLI 加载隔离的发布预设，由内置 npm 插件发布已验证 tarball；Git 交付和版本更新均关闭。打包默认 npm，pnpm 项目显式选择 package-manager=pnpm。可选 package-verify-command 接收绝对路径 TARBALL；发布前重新校验源码和 tarball 摘要，再发布同一份字节。内置 semver 在项目检查前拒绝无效或非规范版本，以及可解释为版本范围的 dist-tag。[评估 @publint/pack 后](docs/release-it.zh-CN.md#打包库评估)保留原生打包器和 tar；消费方无需发布包装脚本。

来源标签保留构建元数据，version 输出则标识不含构建元数据的 npm registry 版本。发布入口拒绝生效的 npm dry-run 设置，避免把预演当作发布成功。

## 开发

```sh
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm check
```

维护者的 mise 工具不配置消费项目。mise.toml 固定 actionlint 1.7.12 与 action-validator 0.9.0，CI 沿用 mise 初始化后直接运行 pnpm lint，不需要 Docker。本地 mise install 会下载缺少的工具。

pnpm check 先重新生成分发文件，再依次运行测试和 lint，任一步失败即停止。生成文件的变化应与源码变化一起审查。

semver 7.8.5 预打包在 dist/semver.mjs，许可证位于 dist/semver.LICENSE；两个文件都保留在 Git 中，消费方无需安装工具库依赖。.gitattributes 只将 dist/*.mjs 标记为 GitHub diff 中的生成代码，许可证保持可见。升级 semver 或修改打包入口后运行 pnpm check；仅需重新生成时使用 mise exec -- pnpm build。CI 用 pnpm build:check 只比对生成字节、不改写文件，然后分别运行测试和 lint，不自动提交或推送生成文件。

esbuild 0.28.2 仅用于维护构建；pnpm-workspace.yaml 显式禁用其安装脚本，使用随依赖分发的平台二进制。

Lint 入口使用 actionlint 检查工作流与样例，并通过 action-validator 的元数据 schema 递归检查 actions/ 下的 action.yml/action.yaml。Schema 检查不执行 shell 命令，也不完整检查 composite 表达式；契约与行为测试覆盖选定执行路径。Actionlint 的精确排除项仅处理旧版工具尚未支持的 GitHub.com 同提交 `$/actions/...` 语法，引用与输入契约由测试检查。详见 [GitHub 工作流语法](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsuses)。
