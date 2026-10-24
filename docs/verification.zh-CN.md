# 工作流验证

[English](verification.md) | 简体中文

本地 pnpm check 生成分发文件，并执行 fixture 测试和工作流/action lint。CI 只检查分发字节，不改写文件，运行相同的 fixture/lint 覆盖。本地 fixture 替换远端 npm 发布和托管 API，不发布包或部署站点。

## 可复用工作流集成验证

[CI](../.github/workflows/ci.yml) 包含四个任务：check 验证工具库，code 和 docs 并行调用实际的 [check 工作流](../.github/workflows/check.yml)，verify 等待两条路径成功后核对输出和下载的产物。前三个产出任务互相独立。两条可复用路径都选择 github.sha 和 examples/project/xova.json，均不安装项目依赖。

代码路径复用已有 npm 示例的真实断言，要求导出的 answer 等于 42。文档路径通过 docs-build composite 检查、构建 examples/docs-only 中不需要 package.json 的构建器；发布与恢复也经 check(kind=docs) 使用该 composite。上传的 documentation 产物包含隐藏文件，默认保留七天。

verify 任务执行 [test/verify-workflows.mjs](../test/verify-workflows.mjs)，不再内联验证代码。它要求两条 source-sha 输出都匹配原生 SHA，且 code-changed 为 true，确认完整代码检查已执行。通过 GitHub 下载产物后，校验仓库、来源和内容摘要，再检查预期 HTML 及 .well-known/security.txt 的完整字节。

本地 [CI 集成测试](../test/ci.test.mjs) 复用工作流回归的检查任务执行器，运行两条路径，再对真实 fixture 产物执行实际验证脚本。测试拒绝导出值为 41、输出缺失或错误、跳过完整代码检查、错误仓库以及元数据/隐藏内容被修改的情况。另有反例构建摘要有效但 HTML 或安全联系人不符合预期的产物，确认内容断言能发现一致性校验之外的问题。fixture 命令清除父进程的 Node 测试执行器上下文，保证嵌套示例测试独立执行并传递断言失败。

这些任务显式选择 node 工具链，仅使用 contents:read，不申请生产环境、发布/部署凭证、id-token:write 或 pages:write，不调用 npm-publish、Pages 或 Cloudflare 部署。本地边界回归检查两条检查路径、嵌套构建器及其共享 setup/配置 composite 步骤，仅允许预期的初始化与产物 action，并拒绝嵌套发布器、写权限及生产环境。已有发布门禁保持不变，生产工作流不增加发布绕过或模拟模式。

托管任务沿用 CI 的 push、pull_request 和 workflow_dispatch 事件。本地添加 YAML 不代表已经执行；首次托管验收须在获得单独授权、完成 Git 交付或修订已存在远端后的 dispatch 才能进行。

## 完整 CI 复用验证

[复用回归](../test/checked-ci.test.mjs) 执行实际 check.yml 最终来源门禁，区分完整检查、纯文档精简检查和失败检查；仅替代 GitHub API/CLI 与等待时钟。覆盖精确 SHA、仓库/事件/工作流/配置匹配、任务分页、产品矩阵失败、最新运行失败、指定 attempt、并发 rerun、等待上限及查询错误回退。消费方门禁用例覆盖复用与完整回退两条成功路径，以及失败、取消、缺失输出或意外跳过均不能发布；实际 tarball 测试与同字节发布回归继续保留。

回归执行实际查询 CLI，确认致命输入错误在失败前输出 input-error=true；另用失败的运行时及被超时终止的查询步骤模拟初始化和 job 超时边界。任务条件执行器仅注入实际 needs 依赖并模拟隐式 success()：移除 !cancelled() 或还原旧条件的反例必须失败。覆盖无输出/残留来源输出、完整回退成功及 SHA 匹配、回退失败/取消/跳过、错误 SHA、致命标记及整次工作流取消；查询失败和超时后的发布仍执行实际 tarball 成功/失败检查与同字节验证。

状态报告测试执行实际 warning/error shell；基于声明的 job 级 continue-on-error 验证失败汇总：查询失败且完整回退/发布成功不能拖红工作流，致命输入报告失败、完整检查失败或 tarball 验证失败仍然失败。取消查询容错、吞掉致命报告的反例必须暴露相反结果。另测失败步骤即使 conclusion 被容错为 success，也不能导出复用 SHA；致命输入标记始终保留。此模型不模拟完整的 GitHub 调度器。

本地 fixture 不证明 GitHub 实际任务/步骤元数据、失败 job 输出传递、超时调度、跨仓权限或等待行为已经托管验收，也不量化提速。首次接入的旧 CI 没有完整检查标记，会执行完整回退检查。

## 依赖缓存验证

依赖缓存回归执行实际 setup 步骤，替代托管缓存/工具 API 和 uv 目录查询，覆盖命中与未命中都先恢复缓存再真实安装、npm 缓存选择传到代码命令、文档缓存整体替换、没有锁文件或 uv 时关闭缓存，以及 uv 锁文件缺失或目录查询失败时在安装前停止。配置测试保留未知字段、类型拒绝，验证独立默认值和文档继承。原生 setup-node/actions/cache 存储及托管提速仍需后续远端 CI 证据，本地测试不证明缓存传输或耗时收益。

## Valibot 等价验证

迁移时用 3,390 个确定性的配置/任务样例对比冻结的 Ajv 8.20.0 实现，覆盖接受/拒绝、完整默认值补全和生成的输入 JSON Schema；Valibot 源码与打包后的结果均一致。实际 Matrix 配置和独立样例配置也完成了对比。这些是回归样例，不代表对所有可能 JSON 输入的形式化证明。

该对比记录的是最初迁移时的契约。此后有意按任务收窄必填范围：未使用的 code/npm 命令和文档构建配置不再阻断无关任务。当前契约样例验证调整后的行为；默认值、未知字段报错和显式无效值检查保持不变。详见[任务必填项](project-workflows.zh-CN.md)。

首轮发现空 setup/docs 数组有七处接受差异，已通过显式 JSON 对象边界检查保留原来的拒绝行为。官方转换器不支持叠加正则，因此将两条约束合成了等价表达式；转换使用 errorMode=throw，不支持的约束不能被静默省略。按任务必填和文档继承仍由解析器处理，因为 task 属于工作流输入，不是配置字段。

相同 esbuild 设置下，未压缩校验器由 27,455 降至 14,786 字节；JSON Schema 由 2,898 增至 4,579 字节。可编辑定义、默认值和任务规则集中在 config/project.mjs，移除了 Ajv compile/standalone 生成步骤、依赖和许可证。[契约样例](../test/project-cases.mjs) 与[行为测试](../test/project-config.test.mjs) 继续保留。

pnpm build 从同一源码生成运行时 bundle 和输入 JSON Schema。pnpm build:check 拒绝过期或缺失的生成文件及许可证，不改写文件；分发测试还要求不支持的 Schema 转换在替换生成产物前失败。消费配置仍是纯 JSON，消费方无需安装工具库依赖，最终候选、tarball 和部署门禁保持不变。

## 各层验证范围

本地检查任务回归执行实际 YAML 中的配置/setup/检查/构建步骤，替代托管检出、工具初始化及产物 API，覆盖产物名称/保留天数、隐藏文件、配置空值/缺失/错误、安装/检查失败、来源变化和成功输出门禁。图/契约测试要求发布与恢复共用该构建器并保留独立权限门禁，恢复回归递归检查嵌套工作流和 composite，拒绝注入发布器或提升来源/构建权限的反例。独立样例还验证受 Git 跟踪的 JSON，包括独立 main 站点显式选择 always 策略。

检查任务每个 job 读取一次配置，独立执行来源门禁。回归拒绝安装后受跟踪文件、暂存区或 HEAD 变化，确保检查命令尚无机会将其还原；检查后到成功输出前的同类变化也会失败。文档上传后配置被修改，同样无法通过最终来源门禁。另有代码/文档用例接受其他任务未补齐的配置；配置契约样例仍在全部任务中拒绝未知字段和错误类型。

隔离下载的来源门禁 fixture 仅包含 action 元数据、CLI 和 Git helper，必须在缺少配置读取器、运行时 bundle 及 npm 模块时完成来源校验，验证依赖已经分离，而不仅是不再重复读取 JSON。

本地测试覆盖候选身份、同一 tarball 字节、原生 release-it/打包行为、发布结果报告、依赖/跳过规则和产物篡改。托管集成验证补充两条检查路径的真实 workflow_call 输出，以及文档构建的产物传输覆盖，不证明跨仓访问策略、受保护环境审批、真实 npm OIDC、发布/恢复的平台执行或站点验收。这些应在消费方分别确认，不能把工具库 CI 当作生产交付。
