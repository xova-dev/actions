# 结构与接口契约

[English](architecture.md) | 简体中文

## 范围与职责

支持公开 npm 包的 Trusted Publishing，以及静态文档与 Pages/Cloudflare 适配器；支持带明确标签前缀的子目录单包。不编排 monorepo 多包版本或依赖升级，不发布私有包及其他 registry，不管理多版本文档和 PR 预览站点。

参考环境为 GitHub.com、GitHub 托管 Ubuntu、Bash 和 Node 24。Composite 允许调用方选择初始化方式与 runner，但尚未验收 Windows 等组合。工作流支持默认 `node` 或显式 `mise`，未知选择会失败。其他初始化方式使用 composite，不应推断未测试的 Yarn/Python 组合已通过。工具库自身的 mise.toml 和私有 package.json 仅配置维护环境。

| 职责方 | 决策 |
| --- | --- |
| 消费任务 | 事件、检出、工具、依赖、检查、环境、权限、并发、必需前置任务和部署资格。 |
| Composite action | 操作顺序、来源校验、打包发布，或产物验证与平台调用。 |
| Reusable workflow | 标准发布/恢复编排及可组合 Ubuntu 配方；消费方保留产品检查和策略选择。 |
| release-it 预设 | 准备默认配置和官方 Changelog 集成；发布预设使用内置 npm 发布器及简短的候选插件。 |
| lib/ | 公共不变量的内部实现，不是公共入口。 |

## 公共 actions

每个 action.yml 是输入与输出描述的权威来源。

| Action | 契约 |
| --- | --- |
| [npm-publish](../actions/npm-publish/action.yml) | 必填 release-tag、verify-command；可选 expected-sha、tag-prefix（v）、working-directory（.）、npm-tag（auto）、package-manager（npm）及 package-verify-command；发布成功后返回 source-sha、version。 |
| [docs-build](../actions/docs-build/action.yml) | 必填 expected-sha、check-command、build-command、site-directory；可选 working-directory（.）、artifact-name（documentation）、retention-days（7）；上传产物，返回 source-sha。 |
| [docs-pages](../actions/docs-pages/action.yml) | 必填 expected-sha；artifact-name 默认 documentation；验证后部署，返回 page-url，不需要检出或 npm 依赖。 |
| [docs-cloudflare](../actions/docs-cloudflare/action.yml) | 必填 expected-sha、site-directory、deploy-command；可选 artifact-name、working-directory；调用方检出该提交、安装锁定的部署工具，并通过步骤环境提供凭证。 |
| [release-source](../actions/release-source/action.yml) | 前置检查原生标签/SHA 及平台/策略；恢复必须提供确认的 expected-sha，不替代最终包验证。 |
| [latest-release](../actions/latest-release/action.yml) | 可选策略，必填 release-tag、expected-sha；精确匹配最新稳定 GitHub Release 时返回 eligible=true，其他版本返回 false；API 错误或来源不匹配则失败。 |

Composite 不安装项目工具与依赖。调用方提供 Node 24、Bash；npm 发布还要求 tar、锁定的 release-it 21.1.1、npm 11.5.1+、公开仓库和 Trusted Publishing。release-it 要求 Node ^22.22.2、^24.15.0 或 >=26.0.0。latest-release 还需要 gh。Pages 任务授予 pages:write、id-token:write，发布授予 id-token:write；Cloudflare 凭证通过步骤环境中的 CLOUDFLARE_API_TOKEN、CLOUDFLARE_ACCOUNT_ID 显式提供。

没有跳过校验的开关。检查失败会阻止打包、上传或部署。验证命令明确完成必要生成与构建；package-manager 选择 npm 或 pnpm，两者打包时均禁用生命周期脚本，npm 发布使用 --ignore-scripts。默认 npm 打包器拒绝 catalog:/workspace: 依赖，pnpm 项目显式选择 pnpm；测试覆盖原生 npm 和 pnpm 12 打包。可选 package-verify-command 通过绝对路径 TARBALL 检查该文件。发布前再次检查源码、暂存区、HEAD 和原始 tarball SHA-256，直接发布同一文件，不重新打包。未提供该可选命令时，包身份和一致性校验不代表产品兼容性。原生 GITHUB_SHA/GITHUB_REF 必须对应标签候选，不改写 provenance 上下文。预发布默认进入 next，不能进入 latest；稳定版本默认进入 latest，允许哪个版本推进渠道仍由调用方决定。

包验证与文档构建在执行消费方命令前要求受跟踪文件和暂存区干净，执行后再次检查。允许未跟踪或被忽略的构建输出；命令和生成输入仍由消费方负责并信任。

候选预检使用随包分发的 semver 7.8.5。package.json 的 version 必须是规范 SemVer，拒绝 v 等前缀，以及版本号、预发布数字标识中的前导零；有效的预发布和构建元数据保留在来源版本、发布标签中。npm registry 身份及公开的 version 输出不含构建元数据，例如 0.2.0+build.007 发布为 0.2.0。Dist-tag 保留 action 既有字符规则，同时不得解析为 SemVer 范围：v1、v1.4、x 和 X 都会在项目检查及候选输出前失败。

发布 composite 只有两个步骤：候选预检，以及使用 --no-increment 和工具库隔离发布 configDir 的原生 release-it。候选插件补充包检查，release-it 内置 npm 插件发布文件；本 CI 入口不加载消费方 release-it hooks/plugins，不进行 Git 交付或版本修改，发布成功后才写入输出。

预检与后续候选检查读取 npm 生效的 dry-run 配置，要求为 false。从环境或 .npmrc 继承的预演不能产生发布成功输出；action 直接拒绝，不强制覆盖成真实发布。需要预演时使用 release-it 准备入口的 dry run。

provenance 要求 package.json 的 repository 标识调用方公开的 GitHub.com 仓库，owner/name 与 GITHUB_REPOSITORY 大小写一致。支持字符串或带 url 的对象，接受 owner/repo、github:owner/repo、HTTP(S)、git、SSH 和 git+ URL，包括 git@github.com:owner/repo.git。可选的 .git 后缀和 URL 末尾斜杠会归一化；子包 directory 不参与仓库身份比较。不接受密码、git 以外的用户名、查询参数或片段。缺失或不匹配时在候选输出前失败，打包前再次检查；本地 origin 不能替代该元数据。

打包后使用 tar 读取真实归档中的 package/package.json，核对包名、版本、非私有状态和仓库，包括 pnpm 通过 publishConfig.directory 选择其他目录的情况。打包器的 JSON 输出不能代替包内 manifest 的证据。包内版本可与来源版本完全一致，或像 pnpm 一样去掉构建元数据；其他版本变化仍失败。源码版本检查保留完整原值，tarball SHA-256 仍校验交给 npm 的原始字节。构建元数据不产生独立的 npm registry 版本。

## 可复用工作流与策略

高层 release、docs-recover、docs-deploy 工作流负责来源门禁、依赖顺序与部署目标选择，详见[编排契约](orchestration.zh-CN.md)。npm-publish 与 docs-build 调用对应 composite；docs-pages 和 docs-cloudflare 是进入 docs-deploy 的兼容入口，两个平台任务统一由 docs-deploy 维护。npm-publish 默认 npm ci 和 Node 24；docs-build 默认 npm ci、npm run docs:build，要求明确 site-directory。需要 pnpm 时显式选择 toolchain=mise 并提供 pnpm 命令；node-version 仅用于 node 模式。环境名称可配置。Cloudflare 的 site-id 跨运行标识同一部署目标，不同目标使用不同标识。Pages 针对单个站点按仓库串行。

工作流使用 GitHub.com 的 `$/actions/...` 从 reusable workflow 自身同一仓库、同一提交解析 action，调用方固定 SHA 时也一样；不声明支持 GHES。Actionlint 1.7.12 早于该语法，只排除这些路径对应的缺少 ref 误报，测试负责检查目标与输入；其他 lint 诊断仍启用。

工具库 JavaScript 加载随仓库分发的 dist/semver.mjs，下载的 action 检出无需 node_modules。scripts/build.mjs 从锁定依赖生成该文件并复制许可证，两个分发文件都保留在 Git 中。.gitattributes 将 dist/*.mjs 标记为生成代码，许可证保持可见。本地 pnpm check 先生成文件，再依次运行测试和 lint；pnpm build:check 只比对生成字节、不写文件，CI 在测试和 lint 前运行，不自动提交或推送。回归 fixture 覆盖 bundle、许可证被删除或修改，并确认检查模式不重写文件。esbuild 仅是开发依赖，消费方仍需提供其锁定的 release-it 安装。

pnpm lint 还通过 action-validator 0.9.0 递归检查 actions/ 下的 action.yml/action.yaml，校验元数据与 composite 步骤结构，包括必需的 shell 字段和未知属性。这些 schema 检查不执行命令，也不完整验证 composite 表达式；选定执行路径仍由契约与行为测试负责。两个工具均在 mise.toml 中固定版本，CI 直接运行原生二进制，不需要 Docker。

共享部署配方在部署任务通过环境门禁、取得并发锁后执行选定的 latest-stable 策略，再以 eligible=true 控制平台 action。高层默认 latest-stable，底层配方默认 always 保持兼容；concurrency-group 可绑定项目已有的部署锁。独立的前置策略任务可能在部署等待期间过期。Matrix/RSP 样例选择共享流程执行此顺序；docs-only 则按项目策略直接部署 main。这不构成阻止部署期间新版本创建的原子锁。

策略首先按标签查询所选 Release。预发布或草稿直接返回 eligible=false，不请求 releases/latest，因此尚无稳定版本时的首个预发布也会正常跳过。稳定版本再查询最新 Release；匹配最新版本时，标签还须解析为预期的精确提交。所选 Release 不存在、认证或权限错误、服务或传输错误，以及选择稳定版本时缺少 latest，仍然失败；不把 API 错误转换为跳过。

## 文档产物格式

同一次运行中的产物包含 site/ 与 source.json，必填字段如下：

```json
{"schemaVersion":1,"repository":"owner/repo","sha":"<40 lowercase hex>","siteDigest":"<SHA-256>"}
```

摘要对排序后的相对文件路径与内容使用长度前缀计算。部署要求格式版本为 1、仓库等于调用仓库、SHA 等于 expected-sha、内容摘要一致。空站点、符号链接和非常规文件会失败。构建与 Cloudflare 恢复路径必须是项目子目录；越界或父目录符号链接指向外部时，在删除前失败。产物默认保留七天。
每次部署 action 调用都使用新的下载目录，避免同一任务内多次调用时混合不同站点的产物。

构建上传与 Pages 重新打包都显式包含隐藏文件，保留 .well-known/ 等内容。上游 Pages 上传器仍排除 .git 和 .github，部署内容不应放入这两个目录。本地消费测试验证隐藏文件字节和托管上传器选项，不代表真实 Pages 打包或传输已验收。

元数据验证一致性，不是独立证明；不可信生产者可以同时伪造内容和元数据。应使用可信运行，避免向不可信代码提供生产凭证。不支持跨运行取回产物。

## 兼容性

输入、输出、默认行为、失败与跳过语义、产物格式都是公共边界，lib 模块不是。草稿 v1 尚未发布；稳定接口的破坏性修改需要新的主版本。消费方固定完整 SHA，升级时验证独立 fixture 和受影响的项目样例。

此次草稿调整将部署输入 published-sha/release-tag 替换为 expected-sha，由调用方选择稳定版本策略、共享工作流负责执行；mise/pnpm 改为显式选择，site-directory 必须明确。旧的仅含 SHA 的产物会失败，应重新构建，不能补写虚构元数据。消费方继承准备预设，使用原生 release-it hooks 和配置；不再提供独立准备脚本，也不负责 monorepo 发布规划。原生 CLI 同样支持独立标签的子目录包准备。版本要求、授权及暂存行为见 [release-it 指南](release-it.zh-CN.md)。
