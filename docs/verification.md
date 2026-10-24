# Workflow verification

English | [简体中文](verification.zh-CN.md)

Use pnpm check for local distribution generation, fixture tests and workflow/action lint. CI checks distribution bytes without rewriting them and runs the same fixture/lint coverage. Local fixtures replace remote npm publication and hosted APIs; they do not publish packages or deploy sites.

## Reusable workflow integration

[CI](../.github/workflows/ci.yml) has four jobs: check validates the toolkit, code and docs call the actual [check workflow](../.github/workflows/check.yml) in parallel, and verify requires both paths to succeed before checking their outputs and the downloaded artifact. All three producer jobs run independently. Both reusable paths select github.sha and examples/project/xova.json; neither installs project dependencies.

The code path reuses the existing npm example's assertion that its exported answer equals 42. The docs path checks and builds the package-free examples/docs-only builder through the docs-build composite, also used by release and recovery through check(kind=docs). It uploads the documentation artifact including hidden files with the default seven-day retention.

The verify job runs [test/verify-workflows.mjs](../test/verify-workflows.mjs), with no inline verification code. It requires both source-sha outputs to equal the native SHA and code-changed to be true, confirming that the full code path ran. After downloading the artifact through GitHub, it validates the repository, source and content digest, then checks the expected HTML and exact .well-known/security.txt bytes.

Local [CI integration tests](../test/ci.test.mjs) execute both paths through the same check-job helper used by the workflow regressions, then run the actual verifier against real fixture artifacts. They reject an exported answer of 41, missing or wrong workflow outputs, skipped code checks, wrong repositories and modified metadata/hidden content. Separate cases build unexpected HTML or security contacts with valid digests, proving that content assertions add coverage beyond artifact consistency. Fixture commands clear the parent Node test-runner context so nested example tests run independently and propagate assertion failures.

These jobs explicitly select the node toolchain and use only contents:read. They request no production environment, publishing/deployment credentials, id-token:write or pages:write, and never invoke npm-publish, Pages or Cloudflare deployment. A local boundary regression traverses both check paths, the nested builder and their shared setup/configuration composite steps, allows only the expected setup/artifact actions, and rejects nested publishers, write permissions and production environments. Existing release guards remain intact; there is no publication bypass or simulation mode in the production workflows.

The hosted jobs run on the existing CI push, pull_request and workflow_dispatch events. Adding their YAML locally does not execute them: their first hosted acceptance requires separately authorized Git delivery or dispatch with the revision available remotely.

## Complete CI reuse verification

[Reuse regressions](../test/checked-ci.test.mjs) execute check.yml's final source guard to distinguish complete, reduced docs-only and failed checks, replacing only the GitHub API/CLI and wait clock. Cases cover exact SHA/repository/event/workflow/configuration matching, job pagination, product-matrix failure, latest-run failure, attempt selection, concurrent reruns, bounded waits and lookup-error fallback. Consumer gates cover both reused CI and complete fallback checks, rejecting failures, cancellation, missing outputs and unexpected skips. Actual tarball tests and same-byte publication regressions remain in place.

Regressions execute the actual lookup CLI and require fatal input errors to emit input-error=true before failure. Failed runtimes and timeout-killed lookup steps simulate initialization and host job-timeout boundaries. The condition evaluator selects each job's actual needs and models implicit success(); removing !cancelled() or restoring the old predicate must fail the recovery cases. Coverage includes missing/stale outputs, successful complete fallback with matching SHA, failed/cancelled/skipped fallback, wrong SHA, fatal markers and whole-workflow cancellation. Publication after lookup failure/timeout still exercises actual tarball success/failure checks and same-byte verification.

Status-reporting tests execute the shipped warning/error shell and model failure aggregation from declared job-level continue-on-error settings. A failed lookup followed by successful complete fallback/publication must not fail the workflow; fatal input reports, failed complete checks and failed tarball checks still do. Disabling lookup tolerance or swallowing fatal reports must produce opposite results. Failed step outcomes cannot export reusable SHA even with a tolerated success conclusion; fatal input markers remain available. This model does not simulate the full GitHub scheduler.

Local fixtures do not establish hosted GitHub job/step metadata, failed-job output propagation, timeout scheduling, access permissions, waiting behavior or measured speed gains. Older CI without the complete-check marker performs the full fallback checks on first adoption.

## Dependency cache verification

Dependency-cache regressions execute the shipped setup steps, replacing hosted cache/tool APIs and the uv directory lookup. They cover hits/misses before real installation, npm cache selection reaching the code command, docs cache replacement, disabled caches without lockfiles/uv, and missing uv locks or failed lookup stopping before installation. Configuration tests preserve unknown-field/type rejection and validate independent defaults and docs inheritance. Native setup-node/actions/cache storage and hosted speed gains require subsequent remote CI evidence; local tests do not establish cache transport or timing.

## Valibot equivalence verification

The migration compared 3,390 deterministic configuration/task cases against the frozen Ajv 8.20.0 implementation, including acceptance/rejection, complete normalized defaults and the generated input JSON Schema. Source and bundled Valibot results matched. The actual Matrix configuration and the independent example configuration were also compared. These are regression cases, not a formal proof over every possible JSON input.

That comparison records the original migration contract. Task-scoped requirements were subsequently narrowed deliberately: unused code/npm commands and documentation build settings no longer block unrelated tasks. The current corpus tests this contract; defaults, unknown-field rejection and explicit invalid-value checks remain intact. See the [task requirements](project-workflows.md).

The first pass found seven acceptance differences for empty setup/docs arrays. An explicit JSON object boundary check preserves their rejection. Two regex checks were combined into one equivalent expression because the official converter rejects stacked regex actions; conversion uses errorMode=throw so unsupported constraints cannot silently disappear. Task-dependent requirements and documentation inheritance stay in the parser because task is a workflow input, not a configuration property.

Under identical esbuild settings, the uncompressed validator changed from 27,455 to 14,786 bytes; JSON Schema changed from 2,898 to 4,579 bytes. The editable definition/defaults/task rules now live together in config/project.mjs, and Ajv compile/standalone generation and its dependency/license were removed. The [contract corpus](../test/project-cases.mjs) and [behavior tests](../test/project-config.test.mjs) remain.

pnpm build generates the runtime bundle and input JSON Schema from the same source. pnpm build:check rejects stale or missing generated files and licenses without rewriting them; distribution tests also require unsupported Schema conversion to fail before replacing generated artifacts. Consumer configuration stays pure JSON, consumers install no toolkit dependencies, and final-candidate/tarball/deployment guards are unchanged.

## What each layer proves

Local check-job regression executes the shipped YAML with real configuration/setup/check/build steps, replacing hosted checkout/tool/artifact APIs. It covers artifact name/retention and hidden files, empty/missing/invalid configuration, install/check failures, source changes and successful-output gating. Graph/contract tests require release and recovery to use that same builder and preserve separate permission gates; the recovery regression traverses nested workflows and composites and rejects injected publishers or elevated source/build grants. Independent examples also validate their tracked JSON, including explicit always policy for independent main-branch sites.

Checks read configuration once per job and run independent source guards. Regression cases reject tracked-file, staged-index and HEAD mutations after installation before check commands can restore them, and after checks before successful outputs. A changed configuration after documentation upload also fails the final source gate. Separate code/docs cases accept incomplete settings belonging to other tasks; the configuration corpus still rejects unknown fields and invalid types across all tasks.

An isolated downloaded source-guard fixture contains only its action metadata, CLI and Git helper. It must validate the source without configuration readers, runtime bundles or npm modules, proving dependency separation as well as the absence of repeated JSON reads.

Local tests cover candidate identity, exact tarball bytes, native release-it/pack behavior, publication-result reporting, dependency/skip rules and artifact tampering. Hosted integration adds real workflow_call output coverage for both check paths and artifact transport coverage for documentation builds. It does not prove cross-repository access policy, protected environment approvals, live npm OIDC, release/recovery provider execution or real site acceptance. Confirm those separately in the consumer without treating toolkit CI as production delivery.
