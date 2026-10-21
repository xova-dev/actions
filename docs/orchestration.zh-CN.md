# 共享发布与恢复编排

[English](orchestration.md) | 简体中文

标准流程使用高层工作流。消费方保留事件入口、产品检查、命令、路径、环境选择和策略选择；通用前置校验、产物恢复、依赖顺序及平台执行归本仓库维护，不需要每个项目各写 composite 执行器或重复的上游回归套件。

## 入口

| 工作流 | 契约 |
| --- | --- |
| [release.yml](../.github/workflows/release.yml) | 校验原生标签/SHA，按需构建文档，检查、构建、打包、测试并发布同一 npm tarball，再按需在 npm 成功后部署已构建文档。 |
| [docs-recover.yml](../.github/workflows/docs-recover.yml) | 要求所选原生标签与操作者确认的 published-sha，重新构建并部署新文档产物，不调用 npm 发布。 |
| [docs-deploy.yml](../.github/workflows/docs-deploy.yml) | 根据所选部署策略路由到 Pages 或 Cloudflare，各平台使用相应权限。 |

底层 npm-publish/docs-build/docs-pages/docs-cloudflare 配方与 composite action 继续支持自定义组合。内部嵌套工作流与已有的同提交 composite 引用一样，跟随工具库修订。

## 消费方配置

在项目的 release 事件或选择标签的手动工作流中，纯包发布调用可以是：

```yaml
jobs:
  release:
    uses: xova-dev/actions/.github/workflows/release.yml@<verified-full-sha>
    permissions:
      contents: read
      id-token: write
    with:
      release-tag: ${{ github.event.release.tag_name || inputs.release-tag }}
      expected-sha: ${{ github.sha }}
      verify-command: npm test && npm run build
      package-verify-command: npm run check:package
```

使用前替换 SHA 占位符。check:package 属于消费方，必须消费 action 提供的绝对路径 TARBALL，而非重新打包。catalog/workspace 协议选择 package-manager=pnpm。最终 npm-candidate 与 tarball SHA-256 检查仍在 npm-publish 中包围原生 release-it 发布。前置 [release-source](../actions/release-source/action.yml) 检查事件身份与配置，不替代包、标签、HEAD 和归档内 manifest 的验证。

必需产品矩阵使用消费方自己的工作流，并让发布调用依赖其成功，将已检查来源传给 expected-sha。Matrix 的 CI 和发布共用一个 checks.yml；RSP 后续迁移时继续保留自己的产品检查。

## 文档与部署

docs-provider 默认 none。选择 pages 或 cloudflare，并提供 docs-check-command、docs-build-command 和 docs-site-directory，便会在发布前构建文档。docs-working-directory 默认仓库根目录，独立于包的 working-directory；docs-install-command 默认沿用 install-command。产物默认保留七天。

高层流程的 deployment-policy 默认 latest-stable；always 显式允许不查询 GitHub Release 的部署。底层平台配方默认 always 以保持兼容，未知选择会失败。deploy-docs=false 允许构建但不在发布后部署；Matrix 只在稳定 release 事件选择 true，保留手动发布不部署的行为。

平台部署任务先通过环境门禁、取得并发锁，再计算 latest-stable。版本不符合条件时跳过平台检出、依赖安装与部署；API 错误仍然失败。docs-concurrency-group 可沿用项目已有锁，发布和恢复必须一致。Pages 默认面向仓库单个站点；独立 Cloudflare 目标使用不同的 docs-site-id。该策略不构成阻止其他新 Release 创建的原子锁。

npm 发布调用方授予 contents:read、id-token:write，选择 Pages 时再授予 pages:write。Pages 恢复需要 pages:write/id-token:write；Cloudflare 恢复只需 contents:read。Cloudflare 调用方显式传入 CLOUDFLARE_API_TOKEN 和 CLOUDFLARE_ACCOUNT_ID。受保护环境与 Trusted Publishing 继续由消费方配置。

## 恢复与验证

消费方保留薄 workflow_dispatch 入口，向 docs-recover.yml 传递 release-tag、published-sha 以及相同的文档、平台和锁配置。运行必须位于已确认的同一标签和 SHA。仍须操作者确认 npm 已发布；工作流不会仅凭标签或触发成功推断发布完成，也不会重标旧产物。

通用来源/恢复门禁、release-it 行为、同一 tarball 检查、部署策略顺序和产物篡改回归归工具库维护。消费方保留产品行为及少量接线检查。带本地调用的工作流样例在临时消费方布局中 lint，直接校验本地工作流契约，不屏蔽文件缺失错误。

新编排修订仍在本地时，消费方可用 PENDING_ACTIONS_SHA 显式标记草稿，不能将新工作流路径指向旧 SHA。待工具库获得交付授权并通过远端 CI 后，须在交付消费项目之前，将所有占位工作流引用替换为已验证完整 SHA。原有准备预设可保持独立固定引用。工具库 CI 与本地 fixture 不证明消费项目的托管嵌套执行、npm OIDC、产物传输或部署已经验收。产品检查抽成可复用工作流后，还需核实必需状态检查名称。
