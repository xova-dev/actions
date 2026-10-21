# Adoption and migration

English | [简体中文](adoption.zh-CN.md)

The examples are proposed configurations, not completed migrations. Choose a
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
`xova-dev/actions/.github/workflows/npm-publish.yml@<verified-sha>`.
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

1. Keep CI and project tools/checks in the consumer. For the recipes, defaults are
   Node 24 and npm ci. Select toolchain=mise and explicit pnpm commands for a mise
   project; node-version only affects node mode. For other setup, use composites.
   npm-publish requires release-it 21.1.1 in the consumer's locked development
   dependencies; the native CLI and npm publisher are used directly.
2. With a composite, check out the intended source and install tools/dependencies
   before invoking it. Set permissions, environment and concurrency on the job.
   Each site's artifact-name must be unique within a run. Use stable, distinct
   Cloudflare site-id values for independent targets; Pages has one repository site.
3. Audit lifecycle hooks. Explicit verify-command must generate, check and build
   the package. Set package-manager=pnpm for pnpm projects; mise setup alone does
   not select a packer. The default npm packer rejects catalog:/workspace: dependencies.
   Packing/publication disable lifecycle scripts. Optional package-verify-command
   checks the absolute TARBALL file; adapt existing tests to consume it rather than
   pack again. Necessary release materials are allowed; checks must not mutate
   tracked candidate files, HEAD, the index or the packed bytes. Tracked sources
   and index must already be clean before checks begin. Supply tar for reading
   the packed manifest; the Ubuntu recipe already includes it.
4. Configure npm Trusted Publishing per package using the consumer owner/repository,
   caller entry filename (for example publish.yml), and the actual job environment.
   The recipe defaults to npm-publish; npm-package uses public-npm and subpackage
   uses widget-npm. npm authenticates the caller workflow, not the toolkit filename.
   Use npm 11.5.1+ and a release-it-supported Node version: ^22.22.2, ^24.15.0 or
   >=26.0.0 (this toolkit's reference setup is Node 24).
   Enable direct npm publish in allowed actions. This interface does not use npm
   stage publish or long-lived npm tokens. Public-repository provenance is required.
   package.json must also declare a public repository matching the consumer's
   GitHub owner/name, including case. npm-publish checks this before verification
   and again before packing, then validates the actual archived manifest. See [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
   and [provenance requirements](https://docs.npmjs.com/generating-provenance-statements/).
5. Configure Pages or Cloudflare independently. Recipes expose environment-name;
   direct actions use the caller job environment. For Cloudflare, provide locked
   Wrangler/configuration and explicit CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID.
   The adapter restores the built site, then runs the supplied deployment command.
6. Choose deployment policy explicitly. A docs-only project may deploy main with
   no npm or GitHub Release. For publication-coupled sites, require successful npm
   and pass its source-sha as expected-sha. Run optional latest-release inside the
   deployment job after its environment/concurrency gates, then condition deployment
   on eligible=true. Errors must fail rather than masquerade as an ineligible release.
7. On first use, check workflow results, npm version/dist-tag and the site separately.
   Local checks do not prove OIDC or provider acceptance.

Artifacts are retrieved only from the same run and carry a versioned schema,
repository, source SHA and content digest. Default retention is seven days and is
configurable at build time. Recovery starts a new run, rebuilds from the confirmed
source and deploys that run's new artifact. Do not relabel an old artifact.

## Independent examples

npm-package and subpackage include package-lock.json and no mise/pnpm dependency.
Copy each example's source tree to a consumer root and place its workflow under
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

Replace scripts/check-release.mjs and its version/changelog-only and direct-parent
CI gate together with their tests. Verify the final candidate; do not just enlarge
a file allowlist or keep skipping chore(release) checks.

The example retains three operating systems × two Node versions and three Electron
jobs, all checking the exact candidate before npm. Linux Electron installs Xvfb.
These requirements remain in the consumer. expected-sha detects a tag moving away
from the previously checked candidate. The example explicitly selects mise/pnpm.

Separate local preparation from commit, tag, push and GitHub Release creation
according to authorization. Keep the old entry until migration is accepted. The
example selects package-manager=pnpm; this toolkit change does not migrate the
actual Matrix repository. Its package tests still need adaptation to consume
TARBALL before connecting package-verify-command.

## RSP

The example uses `RSP_INSTALL_ALLOW_NETWORK=1 pnpm release:check` and installs the
locked uv environment for offline Skill schemas. The network opt-in lets a fresh
runner populate the distinct .cache/rsp-package-install npm cache; pnpm/uv installs
do not populate it. RSP's default offline behavior elsewhere stays unchanged.

Rules and Skills remain product inputs. Do not start paid agents/judges automatically.
Explicit checks cover prepublishOnly; publication does not repeat it. Cloudflare
uses the consumer's locked Wrangler/configuration and the already-built site.

## Organization .github

Keep organization defaults and thin workflow templates there. An old shared
npm-publish workflow may become a compatibility caller after its inputs, omitted
checks and migration are reviewed. Do not silently inherit weaker validation.

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
