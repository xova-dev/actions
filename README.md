# Xova Actions

English | [简体中文](README.zh-CN.md)

Composable GitHub Actions for public npm publication and documentation delivery,
plus release-it presets and a short release Skill. Projects own their tools,
checks, release contents, environments and deployment policy. Organization defaults
and workflow templates stay in `xova-dev/.github`.

The stable interface has not been released. Every `@v1` example is a placeholder. Pin a
verified full commit SHA after publishing and validating the interface. Matrix has a
local integration draft; no consumer migration has passed hosted acceptance, and
npm OIDC and real deployments remain unvalidated.

For standard publication and documentation recovery, start with the [shared orchestration](docs/orchestration.md). Consumers keep product checks and thin event entries; generic source validation, deployment sequencing and recovery stay here.

## Choose an entry

| Entry | Responsibility |
| --- | --- |
| [actions/](actions/) | Composable steps; caller owns checkout, tools, dependencies and job policy. |
| [.github/workflows/](.github/workflows/) | Ubuntu recipes with Node/npm defaults and optional consumer mise setup. |
| [lib/](lib/) | Internal implementations; not a public CLI API. |
| [release-it preset](config/.release-it.json) | Shared preparation defaults and the official Conventional Changelog plugin. |
| [publication preset](config/npm-publish.mjs) | release-it's built-in npm publisher with candidate and tarball checks. |
| [xova-release](skills/xova-release/SKILL.md) | Agent guidance preserving project checks and authorization. |

Read the [architecture and interface contract](docs/architecture.md), then the
[adoption guide](docs/adoption.md).

## Independent consumers

- [npm-package](examples/npm-package/publish.yml): npm-only project using the publication recipe; no mise or pnpm.
- [subpackage](examples/subpackage/publish.yml): one subdirectory package with a `widget@` tag prefix and caller-owned setup.
- [docs-only](examples/docs-only/docs.yml): no package.json or npm release; deploys documentation from main.
- [multi-site](examples/multi-site/docs.yml): blueprint for two npm-workspace sites, separate artifacts, environments and Cloudflare targets. Supply workspaces, locked Wrangler and configurations.

The first three directories contain runnable minimal sources. Tests execute
checks/builds, the real release-it CLI and shipped composite shell steps, substituting
publication and hosted artifact/Pages APIs. Fixtures install consumer sources with
--omit=dev and explicitly link the toolkit's locked release-it installation; CI
also installs both npm examples' full locked dependencies and runs their CLI.
The multi-site test exercises two artifact/restore
paths; it does not run real Wrangler. Before publication, replace the illustrative
package names and repository metadata as described in the adoption guide. The
docs-only fixture includes hidden .well-known content for the Pages handoff.

[Matrix](examples/matrix/publish.yml) and [RSP](examples/rsp/publish.yml) demonstrate
project policy: required CI, explicit mise/pnpm, publication before deployment,
and latest-stable eligibility checked inside the serialized deployment job.
Deployment adapters themselves require neither npm nor a GitHub Release.

## Release preparation

Consumers can inherit the [release-it configuration](docs/release-it.md) and use
its native CLI and hooks without copying a preparation script. The preset disables
commit, tag, push, npm publication and GitHub/GitLab Releases. Preparation uses
release-it 21.1.1 and @release-it/conventional-changelog 12.0.2, requiring Node
^22.22.2, ^24.15.0 or >=26.0.0.

After configuring the consumer, use its installed CLI directly:

```sh
pnpm exec release-it 0.4.0 --ci --dry-run
pnpm exec release-it 0.4.0 --ci
```

Preparation updates version/changelog in a clean worktree without committing,
tagging, pushing, publishing or creating a GitHub Release. Review the result and
add necessary release notes, migrations and other changes. Consumer hooks run
normally; the official plugin may stage a newly created changelog. See
[releasing and recovery](docs/releasing.md).

Publication requires a locked release-it 21.1.1 development dependency in the
consumer and runs its native CLI with an isolated publication preset. The built-in
npm plugin publishes the verified tarball; Git delivery and version bumps are disabled.
Packing uses npm by default, or explicit package-manager=pnpm.
Optional package-verify-command receives the absolute TARBALL path. The source and
tarball digest are rechecked before publishing those same bytes. Bundled semver
rejects invalid/noncanonical versions and dist-tags that are version ranges before
project checks. Native packers and tar are retained after the
[@publint/pack evaluation](docs/release-it.md#packing-library-evaluation); no consumer
release wrapper is required.
The source tag retains build metadata, while the version output identifies the
npm registry version without it. Publication rejects an effective npm dry-run
setting instead of treating a preview as success.

## Development

```sh
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm check
```

Maintainer mise tools do not configure consumers. mise.toml pins actionlint 1.7.12
and action-validator 0.9.0. CI installs both through the existing mise setup and
runs pnpm lint directly, without Docker. Local mise install downloads missing tools.

pnpm check regenerates the distribution files, then runs tests and lint, stopping
on the first failure. Review any generated changes together with the source changes.

semver 7.8.5 is distributed in dist/semver.mjs with dist/semver.LICENSE; keep both
files in Git so consumers do not need to install toolkit dependencies.
.gitattributes marks only dist/*.mjs as generated for GitHub diffs; licenses remain
visible. After upgrading semver or changing the bundle entry, run pnpm check
or mise exec -- pnpm build to regenerate only. CI uses pnpm build:check to compare
generated bytes without rewriting files, then runs tests and lint separately.
CI never automatically commits or pushes generated files.
esbuild 0.28.2 is a maintainer-only build tool; its install script is explicitly
disabled in pnpm-workspace.yaml and its packaged platform binary is used instead.

The lint entry checks workflows/examples with actionlint and recursively validates
action.yml/action.yaml under actions/ with action-validator's metadata schema.
Schema checks do not execute shell commands or fully check composite expressions;
contract and behavior tests exercise the selected runtime paths. The actionlint
exclusion covers only its missing support for GitHub.com's same-commit
`$/actions/...` syntax; tests validate those references and input contracts. See
[GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsuses).
