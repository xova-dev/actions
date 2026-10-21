# 接入与迁移

[English](adoption.md) | 简体中文

样例是拟议配置，不代表已经迁移。需要自主编排任务时选 composite，需要常用 Ubuntu 初始化时选 reusable workflow。调整样例前先读[接口契约](architecture.zh-CN.md)。

## 发布共享仓库

获得授权后连接远端、提交、推送并运行 CI，完成远端接口验证后再发布稳定版本。所有 `@v1` 都是占位引用；同一流程应替换为同一个已核实的完整 SHA。消费方的 Actions 策略需要允许此仓库及其引用的 actions。

工具库的私有 package.json 仅管理开发依赖。公共接口是 action.yml、workflow_call 和 release-it 准备预设，不是 npm 包或 lib CLI。工作流内部的同提交 `$/actions/...` 会自动跟随固定的工作流版本，要求 GitHub.com。

## 从其他仓库复用

任何有权访问工具库的仓库都可以引用，没有 Matrix/RSP 或组织名称门禁。在任务的 steps 中引用 `xova-dev/actions/actions/npm-publish@<verified-sha>`；在 jobs 层级引用 `xova-dev/actions/.github/workflows/npm-publish.yml@<verified-sha>`。这些仅展示引用形式，不是完整工作流；必需输入与权限见独立样例。公开共享最简单，私有共享需要源仓库的 Actions 访问设置和调用方策略允许。详见 [GitHub 复用说明](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)。

将工具库放到其他 owner/name 下时，外部引用改为对应位置即可；内部 `$/actions/...` 跟随该仓库及选定的工作流版本。消费方无需配置工具库维护用的 pnpm/mise 或 actionlint/action-validator；工具库自身的 CI lint 也不需要 Docker。

## 配置消费项目

1. 消费方保留 CI 与项目工具、检查。工作流默认 Node 24、npm ci；mise 项目显式选择 toolchain=mise 并提供 pnpm 命令，node-version 仅影响 node 模式。其他初始化方式使用 composite。npm-publish 要求消费方在开发依赖中锁定 release-it 21.1.1，直接使用原生 CLI 和 npm 发布器。
2. 使用 composite 时先检出目标源码并安装工具、依赖，在任务上设置权限、环境和并发。同一次运行中各站点的 artifact-name 必须唯一；独立 Cloudflare 目标使用稳定且不同的 site-id，Pages 面向仓库的单个站点。
3. 检查生命周期钩子。verify-command 必须明确完成生成、检查和构建。pnpm 项目设置 package-manager=pnpm，仅选择 mise 初始化不会切换打包器；默认 npm 会拒绝 catalog:/workspace: 依赖。打包和发布禁用生命周期脚本；可选 package-verify-command 检查绝对路径 TARBALL，应让已有包测试消费该文件，而非重新打包。提交可包含必要发布材料，但检查不能修改受跟踪的候选文件、HEAD、暂存区或已打包字节；检查开始前受跟踪源码和暂存区就须干净。提供 tar 读取包内 manifest，Ubuntu 工作流已自带。
4. 按包配置 npm Trusted Publishing：使用消费方 owner/repository、调用入口文件名（例如 publish.yml）与实际任务环境。工作流默认 npm-publish，npm-package 使用 public-npm，subpackage 使用 widget-npm。npm 认证调用方工作流，不是工具库的文件名。要求 npm 11.5.1+，以及 release-it 支持的 Node ^22.22.2、^24.15.0 或 >=26.0.0；本工具库参考配置为 Node 24。允许直接 npm publish；本接口不使用 npm stage publish 或长期 npm token，要求公开仓库 provenance。详见 [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)。
   package.json 还须声明与消费仓库 GitHub owner/name 大小写一致的公开 repository；npm-publish 在验证前与打包前分别检查，再核对真实归档内的 manifest。详见 [provenance 要求](https://docs.npmjs.com/generating-provenance-statements/)。
5. 独立配置 Pages 或 Cloudflare。工作流提供 environment-name，直接 action 使用调用任务环境。Cloudflare 需要锁定的 Wrangler、配置和显式的 CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID。适配器恢复已构建站点后执行部署命令。
6. 明确选择部署策略。纯文档项目可直接部署 main，不需要 npm 或 GitHub Release。与包发布关联的站点应要求 npm 成功，并将其 source-sha 作为 expected-sha；在部署任务通过环境、并发门禁后运行可选的 latest-release，以 eligible=true 控制部署。错误应失败，不能伪装成版本不符合条件。
7. 首次使用分别核实工作流结果、npm 版本与 dist-tag、站点。通过本地检查不代表 OIDC 或平台验收。

产物仅从同次运行取回，携带格式版本、仓库、来源 SHA 和内容摘要。默认保留七天，构建时可配置。恢复流程启动新运行，从已确认源码重新构建，再部署该次新产物，不能重标旧产物。

## 独立样例

npm-package 与 subpackage 提供 package-lock.json，不依赖 mise/pnpm。将各样例源码树复制到消费仓库根目录，把工作流放入 .github/workflows/。包名与仓库 example/project 仅作示例：发布前替换为自己拥有的包，将 repository.url 改为消费项目的实际 GitHub 仓库，并配置 Trusted Publishing。使用子目录样例时，repository.directory 须与 packages/widget 的实际路径一致。子目录样例按明确标签发布单个包，不自动规划 workspace 发布；消费方使用共享 [release-it 配置](release-it.zh-CN.md)及原生 CLI/hooks，也可为单包配置命名空间标签。npm 样例还在发布前安装并检查同一 tarball；通用 pnpm fixture 验证 catalog/workspace 版本展开。

docs-only 提供不需要 package.json 的最小构建器，并包含 .well-known 文件，演示隐藏内容传递到 Pages 上传入口。multi-site 是工作流蓝图，不是完整应用：需提供名为 handbook/api 的 npm workspace、匹配的脚本与输出路径、根锁文件中的 Wrangler，以及各站点的 wrangler.jsonc。本地测试覆盖双产物与恢复路径，不验证缺省的消费应用或真实 Cloudflare 部署。

## Matrix

迁移时替换 scripts/check-release.mjs 的版本/changelog 文件限制、直接父提交 CI 门禁及对应测试。检查最终候选，不能仅扩大文件白名单，也不能保留 chore(release) 跳过检查的规则。

样例保留三个操作系统 × 两个 Node 版本和三个 Electron 任务，全部在精确候选上通过后才发布 npm；Linux Electron 安装 Xvfb。这些要求归消费方，expected-sha 检测标签是否偏离已检查候选。样例显式选择 mise/pnpm。

按授权将本地准备与提交、标签、推送、GitHub Release 创建分开。迁移验收前保留旧入口。样例选择 package-manager=pnpm；本工具库变更不迁移实际 Matrix 仓库。接入 package-verify-command 前，还需让其已有包测试消费 TARBALL。

## RSP

样例使用 `RSP_INSTALL_ALLOW_NETWORK=1 pnpm release:check`，并安装锁定的 uv 环境以检查离线 Skill schema。网络许可使新 runner 可以填充独立的 .cache/rsp-package-install npm 缓存，pnpm/uv 安装不会填充它；RSP 其他场景的默认离线行为不变。

Rules 和 Skills 仍是产品输入，不自动启动付费 agent/judge。显式检查覆盖 prepublishOnly，发布不重复执行它。Cloudflare 使用消费方锁定的 Wrangler、配置及已构建站点。

## 组织 .github

保留组织默认配置与薄工作流模板。旧 npm-publish 入口可在审查输入、缺省检查和迁移后转为兼容调用，不能静默继承较弱的校验。

## 发布保证与边界

原生 GITHUB_SHA/GITHUB_REF 必须在候选输出与验证前匹配检出的发布标签。手动运行要选择该标签；从 main 输入另一标签会失败，不改写 provenance 变量。RSP 冷缓存回归继续通过真实的本地依赖 tarball 服务执行。

回归执行独立消费项目检查、构建、真实 release-it CLI、原生 npm/pnpm 打包及 composite 步骤。Fixture 用 --omit=dev 安装消费源码，并显式链接工具库锁定的 release-it；CI 还完整安装两个 npm 样例的锁定依赖并运行其 CLI。远端发布与托管 API 被替代，这些结果不证明真实 npm OIDC、GitHub 产物传输或部署通过。支持范围与产物信任边界见[结构说明](architecture.zh-CN.md)。
