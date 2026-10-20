# 结构与接口契约

[English](architecture.md) | 简体中文

## 范围与职责

支持公开 npm 包的 Trusted Publishing，以及静态文档与 Pages/Cloudflare 适配器；支持带明确标签前缀的子目录单包。不编排 monorepo 多包版本或依赖升级，不发布私有包及其他 registry，不管理多版本文档和 PR 预览站点。

参考环境为 GitHub.com、GitHub 托管 Ubuntu、Bash 和 Node 24。Composite 允许调用方选择初始化方式与 runner，但尚未验收 Windows 等组合。工作流支持默认 `node` 或显式 `mise`，未知选择会失败。其他初始化方式使用 composite，不应推断未测试的 Yarn/Python 组合已通过。工具库自身的 mise.toml 和私有 package.json 仅配置维护环境。

| 职责方 | 决策 |
| --- | --- |
| 消费任务 | 事件、检出、工具、依赖、检查、环境、权限、并发、必需前置任务和部署资格。 |
| Composite action | 操作顺序、来源校验、打包发布，或产物验证与平台调用。 |
| Reusable workflow | 单个 composite 的常用 Ubuntu 初始化，不隐含最新版本策略或 npm 到文档的依赖。 |
| lib/ | 公共不变量的内部实现，不是公共入口。 |

## 公共 actions

每个 action.yml 是输入与输出描述的权威来源。

| Action | 契约 |
| --- | --- |
| [npm-publish](../actions/npm-publish/action.yml) | 必填 release-tag、verify-command；可选 expected-sha、tag-prefix（v）、working-directory（.）、npm-tag（auto）；发布成功后返回 source-sha、version。 |
| [docs-build](../actions/docs-build/action.yml) | 必填 expected-sha、check-command、build-command、site-directory；可选 working-directory（.）、artifact-name（documentation）、retention-days（7）；上传产物，返回 source-sha。 |
| [docs-pages](../actions/docs-pages/action.yml) | 必填 expected-sha；artifact-name 默认 documentation；验证后部署，返回 page-url，不需要检出或 npm 依赖。 |
| [docs-cloudflare](../actions/docs-cloudflare/action.yml) | 必填 expected-sha、site-directory、deploy-command；可选 artifact-name、working-directory；调用方检出该提交、安装锁定的部署工具，并通过步骤环境提供凭证。 |
| [latest-release](../actions/latest-release/action.yml) | 可选策略，必填 release-tag、expected-sha；精确匹配最新稳定 GitHub Release 时返回 eligible=true，其他版本返回 false；API 错误或来源不匹配则失败。 |

Composite 不安装项目工具与依赖。调用方提供 Node 24、Bash；npm 发布需要 npm 11.5.1+、公开仓库和 Trusted Publishing；latest-release 还需要 gh。Pages 任务授予 pages:write、id-token:write，发布授予 id-token:write；Cloudflare 凭证通过步骤环境中的 CLOUDFLARE_API_TOKEN、CLOUDFLARE_ACCOUNT_ID 显式提供。

没有跳过校验的开关。检查失败会阻止打包、上传或部署。验证命令明确完成必要生成与构建，npm 打包与发布使用 --ignore-scripts，拒绝受跟踪源码或暂存区变动。原生 GITHUB_SHA/GITHUB_REF 必须对应标签候选，不改写 provenance 上下文。预发布默认进入 next，不能进入 latest；稳定版本默认进入 latest，允许哪个版本推进渠道仍由调用方决定。

provenance 要求 package.json 的 repository 标识调用方公开的 GitHub.com 仓库，owner/name 与 GITHUB_REPOSITORY 大小写一致。支持字符串或带 url 的对象，接受 owner/repo、github:owner/repo、HTTP(S)、git、SSH 和 git+ URL，包括 git@github.com:owner/repo.git。可选的 .git 后缀和 URL 末尾斜杠会归一化；子包 directory 不参与仓库身份比较。不接受密码、git 以外的用户名、查询参数或片段。缺失或不匹配时在候选输出前失败，打包前再次检查；本地 origin 不能替代该元数据。

## 可复用工作流与策略

四个工作流调用对应 composite。npm-publish 默认 npm ci 和 Node 24；docs-build 默认 npm ci、npm run docs:build，要求明确 site-directory。需要 pnpm 时显式选择 toolchain=mise 并提供 pnpm 命令；node-version 仅用于 node 模式。环境名称可配置。Cloudflare 的 site-id 跨运行标识同一部署目标，不同目标使用不同标识。Pages 针对单个站点按仓库串行。

工作流使用 GitHub.com 的 `$/actions/...` 从 reusable workflow 自身同一仓库、同一提交解析 action，调用方固定 SHA 时也一样；不声明支持 GHES。Actionlint 1.7.12 早于该语法，只排除这些路径对应的缺少 ref 误报，测试负责检查目标与输入；其他 lint 诊断仍启用。

pnpm lint 还通过 action-validator 0.9.0 递归检查 actions/ 下的 action.yml/action.yaml，校验元数据与 composite 步骤结构，包括必需的 shell 字段和未知属性。这些 schema 检查不执行命令，也不完整验证 composite 表达式；选定执行路径仍由契约与行为测试负责。两个工具均在 mise.toml 中固定版本，CI 直接运行原生二进制，不需要 Docker。

应在部署任务通过环境门禁、取得并发锁后执行 latest-release，再以 eligible=true 控制平台 action。独立的前置策略任务可能在部署等待期间过期。Matrix/RSP 样例展示此顺序；docs-only 则按项目策略直接部署 main。这不构成阻止部署期间新版本创建的原子锁。

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

此次草稿调整将部署输入 published-sha/release-tag 替换为 expected-sha，把稳定版本策略移到调用方；mise/pnpm 改为显式选择，site-directory 必须明确。旧的仅含 SHA 的产物会失败，应重新构建，不能补写虚构元数据。Changelogen 准备工具仍面向单包与 v 前缀标签，不推断 monorepo 发布计划。
