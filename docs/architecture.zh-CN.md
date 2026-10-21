# 结构与接口契约

[English](architecture.md) | 简体中文

## 范围与职责

[项目工作流](project-workflows.zh-CN.md) 以一份配置契约和共享 setup 覆盖代码/文档检查、发布与恢复。Valibot 在 config/project.mjs 中定义字段、默认值和任务规则，JSON Schema 与运行时 bundle 由它生成，消费方无需安装校验依赖。

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

项目配置在 config/project.mjs 中使用 Valibot 1.5.0。官方 @valibot/to-json-schema 1.8.0 转换器生成 config/project.schema.json，esbuild 将运行时打包到 dist/project-config.mjs，dist/valibot.LICENSE 保持可见。构建/检查覆盖定义源码变化、JSON 产物过期、代码和许可证缺失或被修改，以及不支持的转换失败。

每个 action.yml 是输入与输出描述的权威来源。

| Action | 契约 |
| --- | --- |
| [setup](../actions/setup/action.yml) | 显式选择工具链并安装锁定依赖，检查、构建、发布和 Cloudflare 任务共同使用。 |
| [project-config](../actions/project-config/action.yml) | 校验干净、精确来源中的受跟踪 JSON，补全默认值，可选分类普通 CI 改动。 |
| [check-source](../actions/check-source/action.yml) | 必填 expected-sha；不读取配置，仅核对 HEAD、受跟踪文件和暂存区，成功后返回 source-sha。 |
| [npm-publish](../actions/npm-publish/action.yml) | 必填 release-tag、verify-command；可选 expected-sha、tag-prefix（v）、working-directory（.）、npm-tag（auto）、package-manager（npm）及 package-verify-command；发布成功后返回 source-sha、version、tarball-sha256 和 publication-artifact。 |
| [docs-build](../actions/docs-build/action.yml) | 必填 expected-sha、check-command、build-command、site-directory；可选 working-directory（.）、artifact-name（documentation）、retention-days（7）；上传产物，返回 source-sha。 |
| [docs-pages](../actions/docs-pages/action.yml) | 必填 expected-sha；artifact-name 默认 documentation；验证后部署，返回 page-url，不需要检出或 npm 依赖。 |
| [docs-cloudflare](../actions/docs-cloudflare/action.yml) | 必填 expected-sha、site-directory、deploy-command；可选 artifact-name、working-directory；调用方检出该提交、安装锁定的部署工具，并通过步骤环境提供凭证。 |
| [release-source](../actions/release-source/action.yml) | 前置检查原生标签/SHA 及平台/策略；恢复必须提供确认的 expected-sha，不替代最终包验证。 |
| [latest-release](../actions/latest-release/action.yml) | 可选策略，必填 release-tag、expected-sha；精确匹配最新稳定 GitHub Release 时返回 eligible=true，其他版本返回 false；API 错误或来源不匹配则失败。 |

操作类 composite 不安装项目工具与依赖；setup 是显式的安装 action。调用方提供 Node 24、Bash；npm 发布还要求 tar、锁定的 release-it 21.1.1、npm 11.5.1+、公开仓库和 Trusted Publishing。release-it 要求 Node ^22.22.2、^24.15.0 或 >=26.0.0。latest-release 还需要 gh。Pages 任务授予 pages:write、id-token:write，发布授予 id-token:write；Cloudflare 凭证通过步骤环境中的 CLOUDFLARE_API_TOKEN、CLOUDFLARE_ACCOUNT_ID 显式提供。

没有跳过校验的开关。检查失败会阻止打包、上传或部署。验证命令明确完成必要生成与构建；package-manager 选择 npm 或 pnpm，两者打包时均禁用生命周期脚本，npm 发布使用 --ignore-scripts。默认 npm 打包器拒绝 catalog:/workspace: 依赖，pnpm 项目显式选择 pnpm；测试覆盖原生 npm 和 pnpm 12 打包。可选 package-verify-command 通过绝对路径 TARBALL 检查该文件。发布前再次检查源码、暂存区、HEAD 和原始 tarball SHA-256，直接发布同一文件，不重新打包。未提供该可选命令时，包身份和一致性校验不代表产品兼容性。原生 GITHUB_SHA/GITHUB_REF 必须对应标签候选，不改写 provenance 上下文。预发布默认进入 next，不能进入 latest；稳定版本默认进入 latest，允许哪个版本推进渠道仍由调用方决定。

包验证与文档构建在执行消费方命令前要求受跟踪文件和暂存区干净，执行后再次检查。允许未跟踪或被忽略的构建输出；命令和生成输入仍由消费方负责并信任。

候选预检使用随包分发的 semver 7.8.5。package.json 的 version 必须是规范 SemVer，拒绝 v 等前缀，以及版本号、预发布数字标识中的前导零；有效的预发布和构建元数据保留在来源版本、发布标签中。npm registry 身份及公开的 version 输出不含构建元数据，例如 0.2.0+build.007 发布为 0.2.0。Dist-tag 保留 action 既有字符规则，同时不得解析为 SemVer 范围：v1、v1.4、x 和 X 都会在项目检查及候选输出前失败。

发布 composite 先执行候选预检，再运行使用 --no-increment 和工具库隔离发布 configDir 的原生 release-it。候选插件补充包检查，release-it 内置 npm 插件发布文件；本 CI 入口不加载消费方 release-it hooks/plugins，不进行 Git 交付或版本修改。npm 成功后才生成 publication-result.json 和任务摘要，再将该 JSON 上传为产物。公开输出包括 source-sha/version、tarball-sha256 和 publication-artifact，详见[结果契约](publication-results.zh-CN.md)。

预检与后续候选检查读取 npm 生效的 dry-run 配置，要求为 false。从环境或 .npmrc 继承的预演不能产生发布成功输出；action 直接拒绝，不强制覆盖成真实发布。需要预演时使用 release-it 准备入口的 dry run。

provenance 要求 package.json 的 repository 标识调用方公开的 GitHub.com 仓库，owner/name 与 GITHUB_REPOSITORY 大小写一致。支持字符串或带 url 的对象，接受 owner/repo、github:owner/repo、HTTP(S)、git、SSH 和 git+ URL，包括 git@github.com:owner/repo.git。可选的 .git 后缀和 URL 末尾斜杠会归一化；子包 directory 不参与仓库身份比较。不接受密码、git 以外的用户名、查询参数或片段。缺失或不匹配时在候选输出前失败，打包前再次检查；本地 origin 不能替代该元数据。

打包后使用 tar 读取真实归档中的 package/package.json，核对包名、版本、非私有状态和仓库，包括 pnpm 通过 publishConfig.directory 选择其他目录的情况。打包器的 JSON 输出不能代替包内 manifest 的证据。包内版本可与来源版本完全一致，或像 pnpm 一样去掉构建元数据；其他版本变化仍失败。源码版本检查保留完整原值，tarball SHA-256 仍校验交给 npm 的原始字节。构建元数据不产生独立的 npm registry 版本。

## 工作流与策略

[项目工作流](project-workflows.zh-CN.md) 统一维护配置、阶段顺序、权限、策略。四个标准工作流调用操作 composite，自定义任务直接组合 composite。check(kind=docs) 是独立检查、发布和恢复共用的唯一 reusable 文档检查/构建路径。npm 发布隔离在 release 中，恢复无法到达它。

内部同提交 $/actions/... 与嵌套工作流引用跟随固定的工具库仓库/提交，契约面向 GitHub.com，不覆盖 GHES。actionlint 1.7.12 尚不支持该语法，仅排除对应 missing-ref 诊断，由测试验证引用和输入；其他诊断继续启用。

受 Git 跟踪的来源身份检查集中在 lib/git.mjs，由配置、check-source 和文档复用。check.yml 每个任务读取一次 JSON，在代码命令前和两条路径结束后使用独立来源门禁；按任务必填项见[项目工作流](project-workflows.zh-CN.md)。发布保留额外的原生事件/tag/包检查，以及原生 release-it 前后的源码/摘要检查。产品命令两侧检查保护不同的变更边界。

内部 CLI 仅加载所选操作的模块。来源门禁不依赖配置读取器、校验器 bundle 或 npm 实现；产物操作也不加载配置/npm 模块。配置校验仍在每个任务的初始配置门禁执行。

semver/配置运行时 bundle 及可见许可证保留在 Git，下载的 action 无须工具库 node_modules。本地 pnpm check 生成代码/Schema 并运行测试/lint；CI 只比对字节，不改写或交付 Git。分发缺失/篡改检查、action 元数据验证和托管集成验证边界见[验证指南](verification.zh-CN.md)。

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

只提供当前配置式工作流与操作 composite，不保留弃用入口、别名或兼容包装。准备继续使用原生 release-it 和消费方 hooks，见 [release-it 指南](release-it.zh-CN.md)。
