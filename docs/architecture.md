# Architecture and interface contract

English | [简体中文](architecture.zh-CN.md)

## Scope and ownership

[Project workflows](project-workflows.md) provide one configuration contract and shared setup for code/docs checks, release and recovery. Valibot owns definitions/defaults/task rules in config/project.mjs; the JSON Schema and runtime bundle are generated from it. Consumers install no validator dependencies.

Supported capabilities are public npm Trusted Publishing and static documentation
with Pages/Cloudflare adapters. A single package in a subdirectory with an explicit
tag prefix is supported. Monorepo version orchestration, dependency bumping,
private packages, other registries, versioned sites and PR previews are outside scope.

The reference environment is GitHub.com, GitHub-hosted Ubuntu, Bash and Node 24.
Composites allow caller-selected setup/runners; Windows and other combinations
have not been accepted. Recipes support `node` (default) or `mise` and fail on
unknown selections. Use composites for other setups, without assuming untested
Yarn/Python combinations have passed. Toolkit mise.toml and private package.json
configure maintainers only.

| Owner | Decisions |
| --- | --- |
| Consumer job | Events, checkout, tools, dependencies, checks, environments, permissions, concurrency, required upstream jobs and deployment eligibility. |
| Composite action | Operation ordering, source validation, native packing/publication or artifact validation/provider invocation. |
| Reusable workflow | Standard release/recovery orchestration and composable Ubuntu recipes; product checks and policy choices remain caller-owned. |
| release-it presets | Preparation defaults/official changelog integration; the publication preset uses the built-in npm publisher with a small candidate plugin. |
| lib/ | Internal implementation of shared invariants, not public entry points. |

## Public actions

Project configuration uses Valibot 1.5.0 in config/project.mjs. The official @valibot/to-json-schema 1.8.0 converter generates config/project.schema.json; esbuild bundles the runtime in dist/project-config.mjs with its visible dist/valibot.LICENSE. Build/check coverage includes schema source changes, stale generated JSON, missing/changed code and licenses, and unsupported conversion failures.

Each action.yml owns the authoritative input/output descriptions.

| Action | Contract |
| --- | --- |
| [setup](../actions/setup/action.yml) | Explicit toolchain selection and locked dependency installation, shared by check/build/publish/Cloudflare jobs. |
| [project-config](../actions/project-config/action.yml) | Validate tracked JSON from a clean exact source, normalize defaults, and optionally classify ordinary CI changes. |
| [check-source](../actions/check-source/action.yml) | Requires expected-sha; verifies HEAD and clean tracked files/index without reading configuration, then returns source-sha. |
| [npm-publish](../actions/npm-publish/action.yml) | Requires release-tag and verify-command; optional expected-sha, tag-prefix (v), working-directory (.), npm-tag (auto), package-manager (npm) and package-verify-command. Returns source-sha/version, tarball-sha256 and publication-artifact after publication. |
| [docs-build](../actions/docs-build/action.yml) | Requires expected-sha, check-command, build-command, site-directory; optional working-directory (.), artifact-name (documentation), retention-days (7). Uploads an artifact and returns source-sha. |
| [docs-pages](../actions/docs-pages/action.yml) | Requires expected-sha; optional artifact-name (documentation). Validates then deploys, returning page-url. Does not need checkout or npm dependencies. |
| [docs-cloudflare](../actions/docs-cloudflare/action.yml) | Requires expected-sha, site-directory, deploy-command; optional artifact-name and working-directory. Caller checks out that commit, installs locked deployment tools and provides credentials in the step environment. |
| [release-source](../actions/release-source/action.yml) | Early native tag/SHA and provider/policy validation; recovery requires a confirmed expected-sha. Does not replace final package verification. |
| [latest-release](../actions/latest-release/action.yml) | Optional policy requiring release-tag and expected-sha. Returns eligible=true for the exact latest stable GitHub Release, false for other releases; API errors/source mismatches fail. |

Operation composites install no project tools/dependencies; setup is the explicit installation action. Supply Node 24 and Bash; npm
publication also needs tar, locked release-it 21.1.1, npm 11.5.1+, a public repository
and Trusted Publishing. release-it requires Node ^22.22.2, ^24.15.0 or >=26.0.0.
latest-release also needs gh. Pages jobs grant pages:write and id-token:write;
publication grants id-token:write. Cloudflare credentials are explicit step
environment variables CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.

There is no skip-validation switch. Failed checks stop packing/upload/deployment.
Package verification and documentation builds require clean tracked files and
index before running consumer commands, then recheck afterward. Untracked or
ignored build outputs are allowed; commands and generated inputs remain trusted
consumer responsibilities.
Candidate preflight uses bundled semver 7.8.5. package.json version must be a
canonical SemVer; prefixes such as v and leading-zero numeric version/prerelease
identifiers are rejected. Valid prerelease and build metadata remain in the source
version and release tag. npm registry identity and the public version output omit
build metadata; for example 0.2.0+build.007 is published as 0.2.0. Dist-tags retain
the action's existing character policy and must not parse as a SemVer range:
v1, v1.4, x and X fail before project checks or candidate outputs.
Verification explicitly performs required generation and builds. Select npm or
pnpm via package-manager; both disable pack lifecycle scripts, and npm publication
uses --ignore-scripts. The default npm packer rejects catalog:/workspace: dependencies;
pnpm projects select pnpm explicitly. Tests cover native npm and pnpm 12 packing.
Optional package-verify-command receives the absolute TARBALL path for checks of
that file. Before publication, source/index/HEAD and the original tarball SHA-256
are checked again. The exact tarball is published without repacking. Without the
optional command, package identity/consistency does not imply product compatibility.
The publication composite runs candidate preflight, then native
release-it with --no-increment and the toolkit's isolated publication configDir.
The candidate plugin adds package checks; release-it's built-in npm plugin publishes
the file. Consumer release-it hooks/plugins, Git delivery and version changes are
excluded from this CI entry. After npm succeeds, it writes publication-result.json and a job summary, then uploads only that result as an artifact. Public outputs include source-sha/version, tarball-sha256 and publication-artifact; see the [result contract](publication-results.md).
Preflight and subsequent candidate checks read npm's effective dry-run configuration
and require false. A dry run inherited from environment or .npmrc must not produce
successful publication outputs. The action rejects it rather than overriding it
into a real publication. Use release-it's preparation preview for dry runs.
Native GITHUB_SHA/GITHUB_REF must identify the tagged publication candidate; the
action does not rewrite provenance context. Prereleases default to next and cannot
use latest. Stable versions default to latest; which versions may advance a
channel remains caller policy.

For provenance, package.json repository must identify the caller's public
GitHub.com repository with case-sensitive owner/name equality to GITHUB_REPOSITORY.
It accepts a string or an object with url: owner/repo, github:owner/repo, HTTP(S),
git, SSH and git+ URL forms, including git@github.com:owner/repo.git. An optional
.git suffix and trailing URL slash are normalized; subpackage directory is not
part of repository identity. Passwords, usernames other than git, query strings
and fragments are rejected. Missing/mismatched metadata fails before
candidate outputs and is rechecked before packing; local origin is not a substitute.
After packing, tar reads package/package.json from the actual archive. Its name,
version, non-private status and repository must match the candidate, including
when pnpm selects an alternate publishConfig.directory. Packer JSON alone is
not evidence of the archived manifest. The archived version may exactly match
the source version or omit its build metadata, as pnpm does; other version changes
fail. Source-version checks retain the full original value, and tarball SHA-256
checks still cover the exact bytes delivered to npm. Build metadata does not
create a separate npm registry version.

## Reusable workflows and policy

[Project workflows](project-workflows.md) are the single reference for configuration, stage ordering, permissions, policy. Four standard workflows call operation composites; custom jobs call those composites directly. check(kind=docs) is the sole reusable documentation check/build path for standalone checks, release and recovery. npm publication is isolated in release; recovery cannot reach it.

Internal same-commit $/actions/... and nested workflow references follow the pinned toolkit repository/commit on GitHub.com; GHES is outside this workflow contract. actionlint 1.7.12 predates that syntax: only its specific missing-ref diagnostic is excluded, while tests validate targets and inputs. Other diagnostics remain enabled.

Tracked-source identity helpers live in lib/git.mjs and are reused by configuration, check-source and documentation. check.yml reads JSON once per job and uses separate source guards before code commands and after either path; task-specific required settings are defined in [project workflows](project-workflows.md). Publication retains its extra native event/tag/package checks and source/digest checks around native release-it. Checks on either side of consumer commands protect distinct mutation boundaries.

The internal CLI loads only the selected operation module. Source guards require no configuration reader, validator bundle or npm implementation; artifact operations also avoid loading configuration/npm modules. Configuration validation still runs at each job's initial configuration gate.

The bundled semver/configuration runtime and visible licenses stay in Git, allowing downloaded actions to run without toolkit node_modules. Local pnpm check regenerates code/Schema and runs tests/lint; CI compares bytes without rewriting or Git delivery. See [verification](verification.md) for missing/modified distribution checks, action metadata validation and hosted integration limits.

## Documentation artifact schema

Artifacts from the same run contain site/ and source.json with required fields:

```json
{"schemaVersion":1,"repository":"owner/repo","sha":"<40 lowercase hex>","siteDigest":"<SHA-256>"}
```

The digest hashes sorted relative file paths and contents with length prefixes.
Deployment requires schema version 1, the caller repository, expected-sha and a
matching content digest. Empty sites, symlinks and nonregular files fail. Build and
Cloudflare restore paths must be project subdirectories; outside/symlink-parent
restore targets fail before deletion. Default retention is seven days.
Each deployment action invocation uses a fresh download directory so repeated
invocations in one job cannot merge artifacts from different sites.

Build upload and Pages repackaging explicitly include hidden files, preserving
content such as .well-known/. The upstream Pages uploader still excludes .git and
.github; do not place deployable content there. Local consumer tests verify the
hidden file bytes and the hosted uploader option, not real Pages archiving or transport.

Metadata establishes consistency, not an independent attestation: an untrusted
producer can forge content and metadata together. Use trusted runs and keep
production credentials away from untrusted code. Cross-run artifact retrieval is
outside the interface.

## Compatibility

Inputs, outputs, defaults, failure/skip behavior and artifact schema are public
boundaries; lib modules are not. The draft v1 is unpublished. Stable-interface
breaking changes require a new major version. Pin full SHAs and validate upgrades
against independent fixtures and affected project examples.

Only the current configuration-based workflows and operation composites are exposed; no deprecated entries, aliases or compatibility wrappers are retained. Preparation uses native release-it and consumer hooks; see the [release-it guide](release-it.md).
