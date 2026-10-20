# Xova Actions

English | [简体中文](README.zh-CN.md)

Composable GitHub Actions for public npm publication and documentation delivery,
plus Changelogen preparation and a short release Skill. Projects own their tools,
checks, release contents, environments and deployment policy. Organization defaults
and workflow templates stay in `xova-dev/.github`.

This is an unpublished local draft. Every `@v1` example is a placeholder. Pin a
verified full commit SHA after publishing and validating the interface. No consumer
repository has been migrated; npm OIDC and real deployments remain unvalidated.

## Choose an entry

| Entry | Responsibility |
| --- | --- |
| [actions/](actions/) | Composable steps; caller owns checkout, tools, dependencies and job policy. |
| [.github/workflows/](.github/workflows/) | Ubuntu recipes with Node/npm defaults and optional consumer mise setup. |
| [lib/](lib/) | Internal implementations; not a public CLI API. |
| [release.mjs](scripts/release.mjs) | Explicit-version Changelogen preview/preparation for one package. |
| [xova-release](skills/xova-release/SKILL.md) | Agent guidance preserving project checks and authorization. |

Read the [architecture and interface contract](docs/architecture.md), then the
[adoption guide](docs/adoption.md).

## Independent consumers

- [npm-package](examples/npm-package/publish.yml): npm-only project using the publication recipe; no mise or pnpm.
- [subpackage](examples/subpackage/publish.yml): one subdirectory package with a `widget@` tag prefix and caller-owned setup.
- [docs-only](examples/docs-only/docs.yml): no package.json or npm release; deploys documentation from main.
- [multi-site](examples/multi-site/docs.yml): blueprint for two npm-workspace sites, separate artifacts, environments and Cloudflare targets. Supply workspaces, locked Wrangler and configurations.

The first three directories contain runnable minimal sources. Tests execute
checks/builds and shipped composite shell steps, substituting publication and
hosted artifact/Pages APIs. The multi-site test exercises two artifact/restore
paths; it does not run real Wrangler. Before publication, replace the illustrative
package names and repository metadata as described in the adoption guide. The
docs-only fixture includes hidden .well-known content for the Pages handoff.

[Matrix](examples/matrix/publish.yml) and [RSP](examples/rsp/publish.yml) demonstrate
project policy: required CI, explicit mise/pnpm, publication before deployment,
and latest-stable eligibility checked inside the serialized deployment job.
Deployment adapters themselves require neither npm nor a GitHub Release.

## Release preparation

Install this toolkit's locked dependencies, then invoke:

```sh
node /path/to/actions/scripts/release.mjs preview 0.4.0 --cwd /path/to/project
node /path/to/actions/scripts/release.mjs prepare 0.4.0 --cwd /path/to/project
```

Preparation updates version/changelog in a clean worktree without committing,
tagging, pushing, publishing or creating a GitHub Release. Review the result and
add necessary release notes, migrations and other changes. See
[releasing and recovery](docs/releasing.md).

## Development

```sh
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm test
mise exec -- pnpm lint
```

Maintainer mise tools do not configure consumers. mise.toml pins actionlint 1.7.12
and action-validator 0.9.0. CI installs both through the existing mise setup and
runs pnpm lint directly, without Docker. Local mise install downloads missing tools.

The lint entry checks workflows/examples with actionlint and recursively validates
action.yml/action.yaml under actions/ with action-validator's metadata schema.
Schema checks do not execute shell commands or fully check composite expressions;
contract and behavior tests exercise the selected runtime paths. The actionlint
exclusion covers only its missing support for GitHub.com's same-commit
`$/actions/...` syntax; tests validate those references and input contracts. See
[GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsuses).
