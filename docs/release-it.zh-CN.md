# release-it 配置

[English](release-it.md) | 简体中文

使用 release-it 原生 CLI、官方 Conventional Changelog 插件和内置 npm 发布器。消费方负责产品检查与发布内容，无须复制准备包装器或独立发布 CLI。

## 准备版本

消费方开发依赖锁定 release-it 21.1.1 和 @release-it/conventional-changelog 12.0.2；两者要求 Node ^22.22.2、^24.15.0 或 >=26.0.0。按消费方包管理器选择对应命令：

```sh
npm install --save-dev --save-exact release-it@21.1.1 @release-it/conventional-changelog@12.0.2
```

```sh
pnpm add --save-dev --save-exact release-it@21.1.1 @release-it/conventional-changelog@12.0.2
```

当前工具库修订发布并验证后，在消费方 .release-it.json 中继承固定完整 SHA 的准备预设：

```json
{
  "extends": ["github:xova-dev/actions/config#<verified-full-sha>"]
}
```

占位符不能直接使用。本地评估时改为本检出目录下 config 目录的绝对路径。自动化 fixture 使用本地继承；消费方准备版本前应验证固定预设的远端下载。工具库 package.json 保持 private。

[预设](../config/.release-it.json)关闭提交、标签、推送、npm 发布、GitHub/GitLab Release，以及 npm version 生命周期脚本；根据显式版本写入 CHANGELOG.md。在干净工作区使用已安装的 CLI：

```sh
npm exec -- release-it 0.4.0 --ci --dry-run
npm exec -- release-it 0.4.0 --ci
```

pnpm 对应命令：

```sh
pnpm exec release-it 0.4.0 --ci --dry-run
pnpm exec release-it 0.4.0 --ci
```

版本校验与更新交给原生 release-it。它加载消费方插件和 hooks，需要时用它们调用已有项目命令。Dry run 跳过写入命令及普通 hooks，预览成功不等于测试通过。审查差异与暂存区：即使 git.commit=false，官方插件仍会暂存新建的 CHANGELOG.md。失败时保留部分修改，准备不是事务；补充迁移说明等材料后，仍须检查最终候选。

子目录单包从对应目录执行，覆盖 git.tagName，例如 widget@${version}，由原生配置处理，无须另一套驱动。多包版本和依赖规划仍不属于工具库契约。

## 发布已验证候选

发布要求消费方锁定 release-it 21.1.1，并提供支持 OIDC 的 npm 11.5.1+。Action 只有两个步骤：候选预检，以及加载隔离[发布预设](../config/npm-publish.mjs)的原生 release-it CLI。Git、版本更新、GitHub/GitLab Release 和消费方 release-it hooks/plugins 均不参与，由内置 npm 插件完成发布并报告失败。

简短的[候选插件](../lib/npm-release.mjs)只补充工具库不变量：执行 verify-command 前拒绝脏的受跟踪源码或暂存区、使用所选原生工具打包、通过 tar 验证归档内的 manifest、按需通过 package-verify-command 检查文件，然后在内置发布器执行前复核源码及 tarball SHA-256。发布成功后才写入输出，不再维护独立发布引擎或 npm 认证实现。

候选预检使用工具库预打包的 semver 7.8.5，在检查前拒绝无效或非规范包版本，以及可解释为 SemVer 范围的 dist-tag。消费方不安装 semver 或工具库的构建工具。

来源版本与发布标签保留构建元数据；pnpm 可能从包内 manifest 去掉它，npm registry 元数据也会去掉它，因此公开的 version 输出使用 registry 版本。完整源码版本与原始 tarball 字节仍受校验，构建元数据不同不代表新的 npm 版本。

发布预检与后续候选检查要求 npm 生效的 dry-run 配置为 false，包括环境及 .npmrc 设置。继承的预演会被拒绝，既不报告为发布成功，也不强制变为真实发布。预览使用上文准备入口的 --dry-run。

package-manager 默认 npm；catalog:/workspace: 依赖显式选择 pnpm。两者打包时均禁用生命周期脚本，verify-command 必须显式构建。package-verify-command 在包目录接收绝对路径 TARBALL，消费该文件，不重新打包。[npm 样例](../examples/npm-package/publish.yml)离线安装并检查导出行为；省略该可选命令只检查身份和一致性，不代表产品兼容性。内置 npm 发布器将同一文件交给 OIDC/provenance，包括由 pnpm 打包的文件。

测试运行真实 release-it、npm 和 pnpm 12，仅替代远端发布与托管 API。消费 fixture 用 --omit=dev 安装源码，并接入工具库锁定的 release-it 安装，不在每项测试中重复下载开发工具。CI 单独完整安装两个 npm 样例的锁定依赖并运行其 release-it CLI。真实 OIDC、远端继承和平台验收仍未验证。

## 打包库评估

2026 年 10 月 21 日，在临时 Git fixture 中评估 @publint/pack 0.1.7，使用 Node 24.22.0、npm 11.19.1、pnpm 12.14.0，没有将它加入依赖。所评估的 npm 分发包包含 tinyexec 依赖。

| 实验 | 实际结果 |
| --- | --- |
| npm/pnpm 在 prepack 会失败时使用 ignoreScripts=true 打包 | 两者通过；解包的 manifest 与原生 tar 一致。 |
| pnpm catalog:/workspace: 依赖 | 展开为预期的 registry/workspace 版本。 |
| pnpm publishConfig.directory 的 manifest 指向另一仓库 | 能读取真实替代 manifest，仍须工具库执行身份策略。 |
| gzip 归档的 tar 头校验和损坏 | 原生 tar 失败，unpack() 仍返回 manifest。 |
| 有效 PAX 归档将 package/package.json 覆盖为 package/other.json | 原生 tar 应用覆盖后找不到 package/package.json；unpack() 返回名义上的 package/package.json。 |

归档实验说明两种解析语义存在差异，不代表普通 npm/pnpm 输出会触发这些情况。unpack() 不能直接替代当前 manifest 校验；单独使用 pack() 只减少少量适配代码，却增加 tinyexec，并改为通过 stdout 文件名匹配选择 tarball。整体替换收益不足，因此保留原生 pack/tar、最终候选检查和同一 tarball 的 SHA-256 校验。包质量工具仍可通过 package-verify-command 消费 TARBALL。

## 其他插件

其他 manifest 确需同步版本时再加入 @release-it/bumper；确需多包编排时再评估 workspace 插件。release-it-pnpm 4.6.6 声明支持 release-it 17–19，且在 bump 时发布，因此不使用。上述打包库评估解释了当前保留原生打包器的选择；已有包质量工具可以通过 package-verify-command 调用。

参考上游[插件指南](https://github.com/release-it/release-it/blob/main/docs/plugins.md)、[配置指南](https://github.com/release-it/release-it/blob/main/docs/configuration.md)和 [Conventional Changelog](https://github.com/release-it/conventional-changelog)。
