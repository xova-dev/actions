# 接入

[English](adoption.md) | 简体中文

样例描述本地配置，托管验收仍需单独完成。需要自主编排任务时选 composite，需要常用 Ubuntu 初始化时选 reusable workflow。调整样例前先读[接口契约](architecture.zh-CN.md)。

## 发布共享仓库

获得授权后连接远端、提交、推送并运行 CI，完成远端接口验证后再发布稳定版本。所有 `@v1` 都是占位引用；同一流程应替换为同一个已核实的完整 SHA。消费方的 Actions 策略需要允许此仓库及其引用的 actions。

工具库的私有 package.json 仅管理开发依赖。公共接口是 action.yml、workflow_call 和 release-it 准备预设，不是 npm 包或 lib CLI。工作流内部的同提交 `$/actions/...` 会自动跟随固定的工作流版本，要求 GitHub.com。

## 从其他仓库复用

任何有权访问工具库的仓库都可以引用，没有 Matrix/RSP 或组织名称门禁。在任务的 steps 中引用 `xova-dev/actions/actions/npm-publish@<verified-sha>`；在 jobs 层级引用 `xova-dev/actions/.github/workflows/release.yml@<verified-sha>`。这些仅展示引用形式，不是完整工作流；必需输入与权限见独立样例。公开共享最简单，私有共享需要源仓库的 Actions 访问设置和调用方策略允许。详见 [GitHub 复用说明](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)。

将工具库放到其他 owner/name 下时，外部引用改为对应位置即可；内部 `$/actions/...` 跟随该仓库及选定的工作流版本。消费方无需配置工具库维护用的 pnpm/mise 或 actionlint/action-validator；工具库自身的 CI lint 也不需要 Docker。

## 配置消费项目

[项目配置与运行时输入](project-workflows.zh-CN.md) 统一维护字段、阶段和权限。标准工作流不再提供命令/setup 覆盖，自定义任务组合 composite；消费方保留精确 SHA 上的必需产品检查。

1. 消费方锁定 release-it 21.1.1，使用 Node ^22.22.2、^24.15.0 或 >=26.0.0，以及 npm 11.5.1+，参考环境为 Node 24。提供 Bash/tar，catalog/workspace 展开显式选择 pnpm。打包/发布关闭生命周期脚本，测试消费 TARBALL，见[候选契约](architecture.zh-CN.md#公共-actions)。
2. npm Trusted Publishing 配置实际消费方 owner/repository、调用工作流文件名（如 publish.yml）和 npm.environment-name（默认 npm-publish，样例 public-npm/widget-npm）。npm 认证调用方，不是工具库文件名。允许直接 publish，不使用 stage publish 或长期 token。公开 provenance 要求 package.json 公共 repository 元数据匹配，包含大小写；本地 origin 不足以替代。见 [Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) 和 [provenance](https://docs.npmjs.com/generating-provenance-statements/)。
3. 单独配置 Pages 设置和生产环境。Cloudflare 使用消费方锁定的 Wrangler/配置，以及显式 CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID。共享工作流从配置读取环境/锁，直接 composite 任务自行设置门禁；检查不接触生产凭证。
4. 首次使用后分别验收托管运行、registry 版本/dist-tag 和站点。本地测试不证明 OIDC 或平台验收。恢复在新运行中从已确认来源重建，不重标产物或跨运行取回。

## 独立样例

npm-package 与 subpackage 提供 package-lock.json，不依赖 mise/pnpm。将各样例源码树（包含隐藏 .github 配置）复制到消费仓库根目录，把工作流放入 .github/workflows/。包名与仓库 example/project 仅作示例：发布前替换为自己拥有的包，将 repository.url 改为消费项目的实际 GitHub 仓库，并配置 Trusted Publishing。使用子目录样例时，repository.directory 须与 packages/widget 的实际路径一致。子目录样例按明确标签发布单个包，不自动规划 workspace 发布；消费方使用共享 [release-it 配置](release-it.zh-CN.md)及原生 CLI/hooks，也可为单包配置命名空间标签。npm 样例还在发布前安装并检查同一 tarball；通用 pnpm fixture 验证 catalog/workspace 版本展开。

docs-only 提供不需要 package.json 的最小构建器，并包含 .well-known 文件，演示隐藏内容传递到 Pages 上传入口。multi-site 是工作流蓝图，不是完整应用：需提供名为 handbook/api 的 npm workspace、匹配的脚本与输出路径、根锁文件中的 Wrangler，以及各站点的 wrangler.jsonc。本地测试覆盖双产物与恢复路径，不验证缺省的消费应用或真实 Cloudflare 部署。

## Matrix

样例包含 xova.json，消费方将其放到 .github/xova.json，将 YAML 放入 .github/workflows。CI 在同一 SHA 上并行运行 code、docs，与发布和恢复读取同一配置，不再需要独立 docs.yml。产品矩阵保留在 checks.yml；发布器在精确来源检查通过后构建，不再重复 lint、类型和示例检查。setup.cache 仅选择 pnpm，文档直接继承，避免只跑 pnpm 的质量检查先写入空的 npm 缓存；checks.yml 保留产品专属 npm/Electron 缓存。产品验收步骤将 TMPDIR/TEMP/TMP 设为 runner.temp，让 Windows 隔离消费项目使用检出所在卷和已缓存的 pnpm store；仍重新安装并验证消费项目。

样例用消费方自己的 checks.yml 同时服务 CI 和发布，保留精确原生候选上的六个 OS/Node 兼容性任务与三个 Electron 任务。发布入口等待产品检查，再调用 release.yml；docs-recover 只保留一次共享恢复调用。配置中沿用 github-pages 环境与并发锁，文档检查、发布和恢复共用 check(kind=docs)。

产品包测试通过 TARBALL 消费最终发布文件，同时保留本地自行打包的入口。通用来源、release-it、tarball 与部署回归归本工具库维护，Matrix 仅检查产品矩阵和工作流接线。

未提交的编排不能通过旧的已验证 SHA 引用。PENDING_ACTIONS_SHA 仅用于消费方本地草稿；待工具库获得交付授权并通过 CI 后，须在交付消费项目之前，将所有占位工作流引用统一替换为已验证完整 SHA。原有准备预设的固定引用可独立保留。工具库 CI 不代表消费项目的托管调用或嵌套必需检查名称已经验收。

## RSP

将 examples/rsp/xova.json 放到 .github/xova.json，将 CI/Publish/恢复入口放入 .github/workflows。CI 并行运行 code、docs。Publish 始终对原生最终候选执行完整检查，再将已检查 SHA 传给 release.yml；发布门禁不使用纯文档优化。

代码命令显式安装锁定的 uv 环境，并通过 `RSP_INSTALL_ALLOW_NETWORK=1 pnpm release:check` 执行离线 Skill schema 和产品检查。setup.cache 选择 pnpm/npm/uv 下载缓存，docs.cache 只选择 pnpm。安装包测试通过 NPM_CONFIG_CACHE 接受选定 npm 缓存，未显式指定时保留 .cache/rsp-package-install。网络许可只允许填充冷下载缓存，不跳过安装包检查，也不授权模型执行、发布或部署。

Rules 和 Skills 仍是产品输入，不自动启动付费 agent/judge。显式检查覆盖 prepublishOnly，发布不重复执行它。Cloudflare 使用消费方锁定的 Wrangler、配置及已构建站点。

## 组织 .github

保留组织默认配置与薄工作流模板。模板调用当前标准工作流，命令和参数放入项目 JSON，不再增加转发兼容工作流。

## 发布保证与边界

原生 GITHUB_SHA/GITHUB_REF 必须在候选输出与验证前匹配检出的发布标签。手动运行要选择该标签；从 main 输入另一标签会失败，不改写 provenance 变量。RSP 冷缓存回归继续通过真实的本地依赖 tarball 服务执行。

回归执行独立消费项目检查、构建、真实 release-it CLI、原生 npm/pnpm 打包及 composite 步骤。Fixture 用 --omit=dev 安装消费源码，并显式链接工具库锁定的 release-it；CI 还完整安装两个 npm 样例的锁定依赖并运行其 CLI。远端发布与托管 API 被替代，这些结果不证明真实 npm OIDC、GitHub 产物传输或部署通过。支持范围与产物信任边界见[结构说明](architecture.zh-CN.md)。
