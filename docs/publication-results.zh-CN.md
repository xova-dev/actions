# npm 发布结果

[English](publication-results.md) | 简体中文

仅当 release-it 的原生 npm 发布器确认发布成功后，工具库才生成 publication-result.json、追加 GitHub 任务摘要，并将 JSON 上传为同次运行的产物。不能仅凭进入 afterRelease 判定成功：跳过发布不会生成成功记录。报告发生在后续文档部署之前，文档部署失败不会删除 npm 发布证据。

## 内容与输出

JSON 使用 schemaVersion=1、status=published，记录 repository、packageName、version（npm registry 版本）、sourceVersion（包含构建元数据）、npmTag、releaseTag、sourceSha、tarballSha256、runId、runAttempt 和 runUrl。本地 fixture 缺少运行信息时，对应字段为 null。摘要使用发布前已复核的原始 tarball SHA-256，报告过程不重新打包或修改 tarball。

公开 npm-publish action，以及 release.yml 都输出 source-sha、version、tarball-sha256 和 publication-artifact。最后一项是产物名称，不是本地路径。安全名称包含限长包名标签和包名/版本指纹，避免 scoped package 与不同包身份相互冲突。产物仅包含 publication-result.json，不上传 tarball、npm 配置、token 或进程环境，保留期沿用仓库默认值。

## 文档恢复

1. 即使整个发布工作流失败，也先查看 npm 发布任务的摘要；需要时下载 publication-artifact，读取 publication-result.json。
2. 从任务日志和 provenance 确认原生 npm 发布操作；报告或上传失败可能让 npm 任务本身在发布后失败。检查 repository、packageName、version、runId/runAttempt 及准确来源。JSON 是该任务生成的诊断记录，不是独立的 registry 证明，也不表示文档已部署。
3. 在消费方文档恢复入口中，将 releaseTag 同时用作工作流 ref 和 release-tag 输入，将 sourceSha 用作 published-sha。所选标签必须包含该入口。
4. 恢复从已确认来源重建、上传新的文档产物，并执行已有部署策略和并发锁；不重复发布 npm，也不重标旧产物。

Matrix 的 Recover documentation 入口已经接收这两个 release-tag/published-sha 字段，不需要项目专属恢复脚本或新增共享工作流输入。

## 失败边界

候选检查、打包、tarball 校验、npm dry-run 配置失败，以及跳过发布或 npm 发布失败时，不生成成功记录或发布结果产物。最终候选和原始 tarball 的校验仍在 npm 发布前执行。

Markdown 摘要无法写入时，会发出可见警告，继续上传已保存的 JSON，并保留发布输出；若结果上传成功，这种展示失败不会把成功发布变成失败任务。

JSON 写入失败仍会使任务失败，错误信息明确指出 npm 已成功、不能重发。产物上传失败同样会使任务失败，通常仍可查看摘要。这两类失败均不保证存在可下载结果，runner 本地文件也不会持久保留。应核对原生 npm 日志、registry 状态及 provenance，不能自动重复发布不可变版本。产物过期后同样需要任务记录及 provenance。
