# 发布

[English](releasing.md) | 简体中文

先确认版本与授权，再检查消费项目发布入口和 Git 状态。release-it Changelog 插件汇总提交，不替代版本说明或迁移决策。真实交付前阅读[发布边界](adoption.zh-CN.md#发布保证与边界)和[接口范围](architecture.zh-CN.md#范围与职责)。

## 包发布

1. 使用消费方 release-it 入口和共享[准备预设](release-it.zh-CN.md)预览显式版本，再在干净工作区准备。审查消费方 hooks 和结果暂存区，官方插件可能暂存新建的 changelog。
2. 检查完整差异，补充版本说明、迁移或示例。
3. 执行项目检查，获得授权后提交。允许包含全部必要发布材料，不要求文件白名单、父提交数量或特殊标题。
4. 获得授权后，创建匹配包版本和 tag-prefix 的标签，推送候选；项目使用 GitHub Release 时再创建 Release。
5. 在该标签调用 npm-publish，通过显式检查、构建和原生 npm/pnpm 打包验证最终候选。package-verify-command 可以通过 TARBALL 检查同一文件；发布前再次检查源码及字节，以 npm OIDC 发布，不执行生命周期脚本、不重新打包。必需前置任务检查同一个 expected-sha。
6. 按项目站点策略部署。与包发布关联的站点等待 npm 成功，使用其 source-sha 和匹配的文档产物；docs-only 可以独立部署。latest-release 是可选策略，不是平台规则。

要求操作系统/Node 矩阵时，应对精确候选完成检查，或将它们放入发布图。共享 action 不猜测必需任务，跳过或缺失不能当作成功。

对已确认的 v0.4.0 候选手动发布：

```sh
gh workflow run publish.yml --ref v0.4.0 -f release-tag=v0.4.0
```

调用入口必须存在于该标签，GitHub 还要求默认分支中存在支持 dispatch 的工作流。原生 GITHUB_SHA/GITHUB_REF 必须匹配候选和标签；从 main 输入另一个标签会在验证或发布前失败。子目录调用方使用自己的匹配标签前缀，子目录样例通过推送标签触发，不使用 workflow_dispatch。

## 失败恢复

- **准备失败**：检查并保留部分修改，再决定是否重试。
- **检查、打包或 tarball 校验失败**：修正并重新验证候选；修改标签仍遵循项目授权。
- **npm 失败**：重试前检查日志与 registry 状态，保留失败事实；立即缺失元数据可能是传播延迟。
- **仓库预检失败**：修正 package.json 的 repository，使其与消费项目 GitHub 仓库大小写一致，再重新验证候选。Git remote 或 Trusted Publisher 配置不能补足缺失的包元数据。
- **npm 成功、文档失败**：不重复发布不可变版本；使用独立恢复入口，确认已发布提交，重新构建其文档，并将该 SHA 传给 expected-sha。Matrix/RSP 的操作入口保留 published-sha 记录，部署 action 接收 expected-sha。
- **产物过期或仍是旧格式**：从已确认源码使用当前构建器重新构建；恢复流程在自己的运行中上传并部署新产物，不能替换为更新的 main 内容或补写虚构元数据。

稳定版本站点应在串行部署任务内部运行 latest-release，以 eligible=true 控制适配器。旧版本、预发布或草稿返回 false；策略先检查所选 Release 类型，再请求 latest，因此首个预发布不要求已有稳定版本。Release 不存在、API 错误或稳定候选来源不匹配仍然失败。按样例顺序执行，避免环境审批或排队使先前判断过期。

首次使用前按[接入指南](adoption.zh-CN.md#配置消费项目)配置 Trusted Publishing、环境和平台。触发工作流或通过本地测试不等于发布、部署结果，也不授予相关权限。

## 升级共享接口

固定已核实的完整 SHA。使用独立 npm、子目录、纯文档和多站点 fixture 验证 action/workflow 的输入、输出、默认行为、失败/跳过语义及产物格式，再检查受影响的 Matrix/RSP 样例。稳定接口的破坏性修改需要新的主版本，内部 lib 路径不是 API；草稿 v1 在远端验证与发布前仍是占位引用。
