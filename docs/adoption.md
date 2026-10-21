# Adoption

English | [简体中文](adoption.zh-CN.md)

The examples describe local configurations; hosted acceptance is separate. Choose a
composite for caller-owned jobs or a reusable workflow for the common Ubuntu setup.
Read the [interface contract](architecture.md) before adapting an example.

## Publish the shared repository

With authorization, connect the remote, commit, push and run CI. Validate the
interface remotely before publishing a stable version. All example `@v1` references
are placeholders; replace them with the same verified full SHA throughout a flow.
The consumer's Actions policy must allow this repository and referenced actions.

The toolkit package.json is private and manages development dependencies only.
Public interfaces are action.yml, workflow_call and the release-it preparation
preset, not an npm package or lib CLI.
Same-commit `$/actions/...` references inside recipes follow the pinned workflow
revision automatically and require GitHub.com.

## Reuse from another repository

Any repository with permission to access the toolkit can reference it; there is no
Matrix/RSP or organization-name gate. Under a job's steps, use
`xova-dev/actions/actions/npm-publish@<verified-sha>`; at job level, use
`xova-dev/actions/.github/workflows/release.yml@<verified-sha>`.
These are reference shapes, not complete workflows: supply required inputs and
permissions as shown in the independent examples. Public sharing is simplest;
private sharing requires the source repository's Actions access settings and the
caller's policy to allow it. See [GitHub reuse guidance](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows).

If hosting the toolkit under another owner/name, change external references to
that location. Internal `$/actions/...` references follow that repository and the
selected workflow revision. Consumers do not need this toolkit's pnpm/mise or
actionlint/action-validator setup; linting the toolkit is a maintainer CI concern,
without Docker.

## Configure a consumer

Start with [project configuration and runtime inputs](project-workflows.md); that guide owns settings, stages and permissions. Standard workflows have no command/setup overrides; custom jobs use composites. Consumers keep required product checks on the exact SHA.

1. Install the consumer's locked release-it 21.1.1, with Node ^22.22.2, ^24.15.0 or >=26.0.0, and npm 11.5.1+. Node 24 is the reference setup. Supply Bash/tar; select pnpm explicitly for catalog/workspace expansion. Lifecycle scripts are disabled during packing/publication; tests consume TARBALL. See the [candidate contract](architecture.md#public-actions).
2. Configure npm Trusted Publishing for the consumer owner/repository, caller workflow filename (for example publish.yml), and npm.environment-name (default npm-publish; examples public-npm/widget-npm). npm authenticates the caller, not the toolkit filename. Allow direct publish, not stage publish or long-lived tokens. Public provenance requires matching public package.json repository metadata, including case; local origin is insufficient. See [Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) and [provenance](https://docs.npmjs.com/generating-provenance-statements/).
3. Configure Pages settings and production environments separately. Cloudflare needs the consumer's locked Wrangler/configuration and explicit CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID. Shared workflows read environments/locks from configuration; direct composite jobs set their own gates. Keep credentials separate from checks.
4. On first use, verify the hosted run, registry version/dist-tag and deployed site separately. Local tests do not establish OIDC or provider acceptance. Recovery rebuilds from confirmed source in a new run; artifacts are not relabelled or fetched across runs.

## Independent examples

npm-package and subpackage include package-lock.json and no mise/pnpm dependency.
Copy each example's source tree, including hidden .github configuration, to a consumer root and place its workflow under
.github/workflows/. Their package names and repository example/project are
illustrative: use a package you own, replace repository.url with the consumer's
actual GitHub repository, and configure Trusted Publishing for that package.
Keep repository.directory aligned with the actual subpackage path (packages/widget
in this example). The subpackage example publishes one package per explicit tag, not an automatic
workspace release plan. Consumers use the shared [release-it configuration](release-it.md)
and native CLI/hooks, including namespaced tag configuration for one package.
The npm example also installs and checks the exact tarball before
publication. Generic pnpm fixtures test catalog/workspace version expansion.

docs-only includes a minimal builder without package.json and a .well-known file
to demonstrate hidden content surviving the Pages handoff. multi-site is a workflow
blueprint, not a complete application: supply npm workspaces named handbook/api,
matching scripts/output paths, a root lockfile with Wrangler, and each site's
wrangler.jsonc. Local tests cover the two artifact/restore paths, not that absent
consumer application or real Cloudflare deployment.

## Matrix

The blueprint includes xova.json; place it at .github/xova.json and the YAML files under .github/workflows in the consumer. CI runs code/docs in parallel on one SHA and reads that configuration with publication/recovery; no standalone docs.yml is needed. Product matrices stay in checks.yml; the publisher builds after those exact-source checks rather than repeating lint/types/examples. setup.cache selects npm/pnpm download caches, while docs.cache selects only pnpm. Product-specific npm/Electron caches remain in checks.yml.

The example uses one consumer-owned checks.yml for CI and publication. It preserves six OS/Node compatibility jobs and three Electron jobs on the exact native candidate. The publish entry waits for that product workflow, then calls release.yml; docs-recover is one shared recovery call. Keep the existing github-pages environment and concurrency group in configuration. Documentation checks, release and recovery use the same check(kind=docs) implementation.

Product package tests consume TARBALL for the final published file. Their fallback local packing remains available. Generic source, release-it, tarball and deployment regressions live in this toolkit; Matrix only tests its product matrix and workflow wiring.

Uncommitted orchestration cannot be referenced through an older verified toolkit SHA. Use PENDING_ACTIONS_SHA only in local consumer drafts until authorized toolkit delivery and CI verification, then replace every pending workflow reference with the same verified full SHA before consumer delivery. An existing preparation preset pin can remain independent. Toolkit CI does not validate consumer-hosted calls or nested required-check names.

## RSP

Copy examples/rsp/xova.json to .github/xova.json and its CI/Publish/recovery entries to .github/workflows. CI runs code/docs in parallel. Publish always runs complete checks on the native final candidate before release.yml and passes its checked SHA; docs-only optimization never applies to that release gate.

The code command explicitly installs the locked uv environment and runs `RSP_INSTALL_ALLOW_NETWORK=1 pnpm release:check` for offline Skill schemas and product checks. setup.cache selects pnpm/npm/uv downloads; docs.cache selects only pnpm. Installed-package tests honor the selected npm cache through NPM_CONFIG_CACHE, retaining .cache/rsp-package-install when no explicit cache is supplied. Network permission permits filling a cold download cache; it does not skip installed-package checks or authorize models, publication or deployment.

Rules and Skills remain product inputs. Do not start paid agents/judges automatically.
Explicit checks cover prepublishOnly; publication does not repeat it. Cloudflare
uses the consumer's locked Wrangler/configuration and the already-built site.

## Organization .github

Keep organization defaults and thin workflow templates there. Templates call the current standard workflows and keep commands/settings in project JSON; do not add forwarding compatibility workflows.

## Publication guarantees and limits

Native GITHUB_SHA/GITHUB_REF must match the checked-out publication tag before
candidate outputs and verification. Dispatch at the tag; selecting another tag from
main is rejected. Provenance variables are not rewritten. The cold-cache RSP
regression remains exercised with a real local dependency tarball server.

Regression tests execute independent consumer checks/builds, the real release-it
CLI, native npm/pnpm packing and composite steps. Fixtures install consumer sources
with --omit=dev and explicitly link the toolkit's locked release-it tool; CI also
installs both npm examples' full locked dependencies and runs their CLI. Remote
publication and hosted APIs are substituted. These
results do not establish live npm OIDC, GitHub artifact transport or deployment.
See [architecture](architecture.md) for support limits and artifact trust boundaries.
