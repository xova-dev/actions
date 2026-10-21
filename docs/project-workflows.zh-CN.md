# 项目工作流

[English](project-workflows.md) | 简体中文

在 `.github/xova.json` 中只声明一次项目命令。共享工作流负责 setup、来源校验、打包、产物验证与部署顺序；消费方保留事件入口、产品矩阵、权限和环境。

| 路径 | 共享入口 | 副作用 |
| --- | --- | --- |
| 代码检查 | `check.yml`，kind=code | 安装依赖并检查源码，不发布、不部署。 |
| 文档检查 | `check.yml`，kind=docs | 检查、构建并上传绑定来源的站点，不部署。 |
| 代码发布 | `release.yml`，config-file | 校验原生 tag/SHA、构建文档、验证/构建/打包/测试/发布 npm，可选部署文档。 |
| 独立文档发布 | `docs-deploy.yml`，config-file | 验证并部署同次运行中已检查的站点，没有 npm 路径。 |
| 文档恢复 | `docs-recover.yml`，config-file | 校验已确认的 tag/SHA，重建并部署文档，没有 npm 路径。 |

这些入口保留独立权限边界，PR 检查只需 contents:read。所有标准工作流使用 config-file（默认 .github/xova.json），显式空值或文件缺失均失败。命令、setup 和部署参数以该文件为准，不提供工作流输入覆盖或回退；自定义任务/runner 直接组合底层操作 actions。运行时标签、预期 SHA、deploy-docs、产物名称和保留天数继续使用显式输入。

```json
{
  "schemaVersion": 1,
  "setup": {
    "toolchain": "mise",
    "install-command": "pnpm install --frozen-lockfile"
  },
  "code": {
    "check-command": "pnpm check"
  },
  "npm": {
    "package-manager": "pnpm",
    "verify-command": "pnpm build",
    "package-verify-command": "pnpm test:pack"
  },
  "docs": {
    "provider": "pages",
    "check-command": "pnpm docs:typecheck",
    "build-command": "pnpm docs:build",
    "site-directory": "docs/.vitepress/dist",
    "environment-name": "github-pages",
    "concurrency-group": "github-pages",
    "deployment-policy": "latest-stable"
  }
}
```

可编辑的 [Valibot 定义](../config/project.mjs) 负责字段、默认值和任务必填规则。pnpm build 使用官方 @valibot/to-json-schema 转换器生成[输入 JSON Schema](../config/project.schema.json)，并由 esbuild 打包运行时解析器，CI 比对两类生成产物。消费方无需安装工具库依赖，未知字段、错误类型和无效选择在命令前失败。消费配置必须位于精确、干净的来源提交中并受 Git 跟踪，不作为可执行模块导入。

setup 默认使用 Node 24、npm ci 和仓库根目录。文档默认继承其工作目录与安装命令，也可单独覆盖。纯文档项目可省略 code/npm；纯 npm 项目可省略 docs，不按产品名称设置特殊分支。

必填项跟随所选任务：

| 任务 | 结构 Schema 之外的必填项 |
| --- | --- |
| code | code.check-command。 |
| docs | docs.check-command、docs.build-command 和 docs.site-directory，provider=none 时也需要。 |
| release | npm.verify-command；仅当 docs.provider 不是 none 时要求上述三项文档构建配置。 |
| recovery | 上述三项文档构建配置，以及 pages/cloudflare 平台。 |
| deploy | pages/cloudflare 平台；Cloudflare 还需要 docs.site-directory。Pages 部署已有产物时不需要构建命令。 |

未使用的区块可以省略其任务专属命令。任一区块的未知字段、错误类型和显式无效值仍会报错，默认值及文档继承不变。生成的 JSON Schema 描述结构规则；task 来自工作流输入，因此由解析器执行上表的任务规则。

每个 check 任务仅在初始精确来源门禁中读取、归一化一次项目 JSON。安装后，代码命令前通过 check-source 检查来源；docs-build 保留检查/构建两侧的来源门禁。两条路径结束后，最终 check-source 步骤再次核对受跟踪文件、暂存区和 HEAD，成功后才提供输出，不重新读取 JSON。其他任务仍独立验证自己的检出与配置；最终包候选和同一 tarball 校验独立保留。

独立文档发布在 kind=docs 检查成功后调用 docs-deploy.yml，传入 config-file，并将检查输出作为 expected-sha；只有发布调用授予平台写权限。从 main 发布的站点显式选择 docs.deployment-policy=always；跟随版本发布的站点保留 latest-stable 并传入 release-tag。适配器先校验同次运行的产物，再执行部署。

```yaml
jobs:
  code:
    permissions:
      contents: read
    uses: xova-dev/actions/.github/workflows/check.yml@PENDING_ACTIONS_SHA
    with:
      source-sha: ${{ github.sha }}
  documentation:
    permissions:
      contents: read
    uses: xova-dev/actions/.github/workflows/check.yml@PENDING_ACTIONS_SHA
    with:
      kind: docs
      source-sha: ${{ github.sha }}
```

PENDING_ACTIONS_SHA 是显式本地草稿标记。消费方交付前，必须替换为工具库实际交付且远端 CI 通过的完整 SHA，旧 SHA 不提供新接口。config-file 默认是 .github/xova.json。产品矩阵可以在共享代码检查成功后消费 source-sha/code-changed，OS/Node profiles 和浏览器、硬件验收仍由项目决定。

普通 CI 可显式开启 detect-changes，并同时声明 code.docs-only-command 和 code.docs-only-paths（Node path.matchesGlob 模式）。push 比较事件 before SHA，PR 比较合并基点。空差异、基点缺失/不可用、缺少优化配置时均完整检查。配置自身变化始终完整检查；没有基点的手动 CI 也完整执行。发布保持 detect-changes=false，提交标题或父提交 CI 成功都不豁免最终候选。输出只在检查成功后提供，代码命令后再次核对受跟踪源码、暂存区和 HEAD。

发布必须依赖消费方对精确 SHA 的完整检查。有此前置条件时，npm.verify-command 可以只生成、构建待发布包，避免在新 job 中重复 lint、类型和示例检查；没有此前置门禁时则必须包含所有必要检查。打包禁用生命周期脚本，TARBALL 检查实际发布文件，发布前再次核对 SHA-256。跨平台测试仍可能各自打包，不声称所有平台已消费同一个晋级 tarball。

发布和恢复从标签 SHA 读取相同文档配置，共用环境、锁，以及进入这些门禁后的 latest-stable 判断。恢复仍要求操作者确认 npm 已发布；标签存在、工作流总体状态或结果 JSON 都不是独立的 registry 证明。

## 统一阶段与运行时输入

标准入口只有 check、release、docs-deploy、docs-recover，均接受 config-file。check 还接受 kind/source-sha/detect-changes；release 接受 release-tag/expected-sha/deploy-docs；恢复要求 release-tag/published-sha；部署要求 expected-sha，latest-stable 还要求 release-tag。检查/发布/恢复接受 artifact-name/retention-days（documentation/7），部署选择 artifact-name；产物参数仅用于文档。输入输出说明以 workflow_call 为准。

独立文档、发布和恢复统一使用 check(kind=docs)，传递同一 config-file 与精确来源。发布先构建文档，再发布 npm，成功后部署同次运行产物；恢复重建新产物，不调用 npm。来源/构建仅使用 contents:read，npm 拥有独立环境/并发组及 id-token:write。Pages 调用方授予 pages:write/id-token:write；Cloudflare 恢复使用 contents:read 与显式平台 secrets，不申请 npm OIDC。部署和恢复复用配置中的环境/锁。

配置统一维护 setup、命令、平台、环境和策略。多站点分别选择受 Git 跟踪的配置文件，以及独立产物名称和 site-id，见[多站点蓝图](../examples/multi-site/docs.yml)。[接入指南](adoption.zh-CN.md)维护管理员配置，[发布指南](releasing.zh-CN.md)维护操作，[验证指南](verification.zh-CN.md)定义测试边界。

## 部署策略

共享部署配方在部署任务通过环境门禁、取得并发锁后执行选定的 latest-stable 策略，再以 eligible=true 控制平台 action。标准工作流默认 latest-stable，纯文档项目在配置中显式选择 always；concurrency-group 可绑定项目已有的部署锁。独立的前置策略任务可能在部署等待期间过期。Matrix/RSP 样例选择共享流程执行此顺序；docs-only 则按项目策略直接部署 main。这不构成阻止部署期间新版本创建的原子锁。

策略首先按标签查询所选 Release。预发布或草稿直接返回 eligible=false，不请求 releases/latest，因此尚无稳定版本时的首个预发布也会正常跳过。稳定版本再查询最新 Release；匹配最新版本时，标签还须解析为预期的精确提交。所选 Release 不存在、认证或权限错误、服务或传输错误，以及选择稳定版本时缺少 latest，仍然失败；不把 API 错误转换为跳过。

## 上游参考

核对了 Vue core 的 [CI](https://github.com/vuejs/core/blob/65eae178383289b6a9f93505ab85017460f72395/.github/workflows/ci.yml)、[测试](https://github.com/vuejs/core/blob/65eae178383289b6a9f93505ab85017460f72395/.github/workflows/test.yml) 和 [发布](https://github.com/vuejs/core/blob/65eae178383289b6a9f93505ab85017460f72395/.github/workflows/release.yml)，以及 Nuxt 的 [CI](https://github.com/nuxt/nuxt/blob/fe9ca5bea14cae9a97fa60f833f043559963b355/.github/workflows/ci.yml)、[文档](https://github.com/nuxt/nuxt/blob/fe9ca5bea14cae9a97fa60f833f043559963b355/.github/workflows/docs.yml) 和 [发布](https://github.com/nuxt/nuxt/blob/fe9ca5bea14cae9a97fa60f833f043559963b355/.github/workflows/release.yml)。Vue 在标签发布时复用产品测试；Nuxt 复用 setup、按路径筛选，并用 Uppt actions 分离 pack/publish。这里采用明确归属和可复用阶段，保留当前范围的 release-it，不复制按提交消息跳过检查或 monorepo 发布 PR 自动化。[GitHub 复用指导](https://docs.github.com/en/actions/concepts/workflows-and-actions/reusing-workflow-configurations) 同样区分工作流、job 策略与 composite 步骤。
