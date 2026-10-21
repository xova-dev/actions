# Architecture and interface contract

English | [简体中文](architecture.zh-CN.md)

## Scope and ownership

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
| Reusable workflow | Common Ubuntu setup around one composite; no implicit latest-release or npm-to-docs dependency. |
| release-it presets | Preparation defaults/official changelog integration; the publication preset uses the built-in npm publisher with a small candidate plugin. |
| lib/ | Internal implementation of shared invariants, not public entry points. |

## Public actions

Each action.yml owns the authoritative input/output descriptions.

| Action | Contract |
| --- | --- |
| [npm-publish](../actions/npm-publish/action.yml) | Requires release-tag and verify-command; optional expected-sha, tag-prefix (v), working-directory (.), npm-tag (auto), package-manager (npm) and package-verify-command. Returns source-sha and version after publication. |
| [docs-build](../actions/docs-build/action.yml) | Requires expected-sha, check-command, build-command, site-directory; optional working-directory (.), artifact-name (documentation), retention-days (7). Uploads an artifact and returns source-sha. |
| [docs-pages](../actions/docs-pages/action.yml) | Requires expected-sha; optional artifact-name (documentation). Validates then deploys, returning page-url. Does not need checkout or npm dependencies. |
| [docs-cloudflare](../actions/docs-cloudflare/action.yml) | Requires expected-sha, site-directory, deploy-command; optional artifact-name and working-directory. Caller checks out that commit, installs locked deployment tools and provides credentials in the step environment. |
| [latest-release](../actions/latest-release/action.yml) | Optional policy requiring release-tag and expected-sha. Returns eligible=true for the exact latest stable GitHub Release, false for other releases; API errors/source mismatches fail. |

Composites install no project tools/dependencies. Supply Node 24 and Bash; npm
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
The publication composite has two steps: candidate preflight, then native
release-it with --no-increment and the toolkit's isolated publication configDir.
The candidate plugin adds package checks; release-it's built-in npm plugin publishes
the file. Consumer release-it hooks/plugins, Git delivery and version changes are
excluded from this CI entry. Successful publication outputs are written afterward.
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

The four workflows invoke matching composites. npm-publish defaults to npm ci and
Node 24. docs-build defaults to npm ci and npm run docs:build, requiring explicit
site-directory. Select toolchain=mise and explicit pnpm commands when needed;
node-version applies to node mode. Environments are configurable. Cloudflare
site-id must identify the same deployment target across runs; distinct targets
need distinct identifiers. Pages serializes repository-wide for one Pages site.

Recipes use GitHub.com's `$/actions/...` to resolve actions from the reusable
workflow's own repository and commit, including SHA-pinned calls. GHES is outside
this recipe contract. Actionlint 1.7.12 predates that syntax: only its missing-ref
diagnostic for these paths is excluded, while tests validate targets and inputs.
Other lint diagnostics remain enabled.

Toolkit JavaScript imports the checked-in dist/semver.mjs bundle, including in
downloaded action checkouts without node_modules. scripts/build.mjs generates it
from the locked dependency and copies its license. Both distribution files stay
in Git. .gitattributes marks dist/*.mjs as generated while leaving licenses visible.
For local development, pnpm check regenerates the files, then runs tests and lint.
pnpm build:check compares the generated bytes without writing; CI runs it before
tests and lint and never automatically commits or pushes. Regression fixtures
exercise missing and modified bundle/license files and ensure check mode never
rewrites them. esbuild is a development
dependency only. Consumers continue to provide their locked release-it installation.

pnpm lint also runs action-validator 0.9.0 recursively over action.yml/action.yaml
under actions/. This validates metadata and composite-step structure, including
required shell fields and unknown properties. These schema checks do not execute
commands or fully validate composite expressions. Contract/behavior tests remain
responsible for the selected execution paths. Both tools are pinned in mise.toml;
CI uses their native binaries without Docker.

Evaluate latest-release inside the deployment job after its environment gate and
concurrency acquisition; condition the provider action on eligible=true. An early
separate policy job could become stale while deployment waits. Matrix/RSP examples
show this ordering; docs-only deliberately deploys main without release policy.
This is not an atomic lock against creation of a new release during deployment.

The policy queries the selected release by tag first. A prerelease or draft
returns eligible=false without calling releases/latest, including the first
prerelease before any stable release exists. Stable selections then query latest;
matching releases must resolve to the exact expected tag commit. Missing selected releases, authentication,
permission, service/transport errors and missing latest for a stable selection
remain failures; no API error is converted to a skip.

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

This draft restructuring replaces deployment published-sha/release-tag with
expected-sha and moves stable-release policy into callers. mise/pnpm are opt-in;
site-directory is explicit. Old SHA-only artifacts fail: rebuild instead of
inventing metadata. Consumers inherit the preparation preset and use native
release-it hooks/configuration; no separate preparation script or monorepo release
planner is provided. The CLI also prepares independently tagged subdirectory packages. See the
[release-it guide](release-it.md) for versions, authorization and staging behavior.
