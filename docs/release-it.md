# release-it configuration

English | [简体中文](release-it.zh-CN.md)

Use release-it's native CLI, official Conventional Changelog plugin and built-in
npm publisher. Consumers own their product checks and release content. There is
no preparation wrapper or separate publication CLI to copy.

## Prepare a version

Use release-it 21.1.1 and @release-it/conventional-changelog 12.0.2 in the consumer's
locked development dependencies. Both require Node ^22.22.2, ^24.15.0 or >=26.0.0.
Choose the command matching the consumer's package manager:

```sh
npm install --save-dev --save-exact release-it@21.1.1 @release-it/conventional-changelog@12.0.2
```

```sh
pnpm add --save-dev --save-exact release-it@21.1.1 @release-it/conventional-changelog@12.0.2
```

After this toolkit revision is published and verified, inherit its preparation
preset from a pinned full SHA in the consumer's .release-it.json:

```json
{
  "extends": ["github:xova-dev/actions/config#<verified-full-sha>"]
}
```

The placeholder is not usable. For local evaluation, inherit this checkout's
absolute config directory instead. Tests use local inheritance; remote retrieval
is not yet verified. The toolkit package.json stays private.

The [preset](../config/.release-it.json) disables commit/tag/push, npm publication,
GitHub/GitLab Releases and npm version lifecycle scripts. It writes CHANGELOG.md
for the explicit version. In a clean worktree, use the installed CLI:

```sh
npm exec -- release-it 0.4.0 --ci --dry-run
npm exec -- release-it 0.4.0 --ci
```

For pnpm:

```sh
pnpm exec release-it 0.4.0 --ci --dry-run
pnpm exec release-it 0.4.0 --ci
```

Native release-it validates and updates the version. It loads consumer plugins
and hooks; add existing project commands there when needed. Dry runs skip write
commands and ordinary hooks, so preview success is not a test result. Inspect
the diff and index: the official plugin stages a newly created CHANGELOG.md even
with git.commit=false. Retain partial work on failure; preparation is not transactional.
Run required checks again on the final candidate, including later migration notes.

For a subdirectory package, run there and override git.tagName, for example
widget@${version}. Native configuration handles this without another driver.
Multi-package version/dependency planning remains outside the toolkit contract.

## Publish the verified candidate

Publication requires the consumer's locked release-it 21.1.1 installation and npm
11.5.1+ for OIDC. The action performs two steps: candidate preflight, then the
native release-it CLI with the isolated [publication preset](../config/npm-publish.mjs).
Git, version bumps, GitHub/GitLab Releases and consumer release-it hooks/plugins
are excluded. The built-in npm plugin handles publication and reports failure.

The small [candidate plugin](../lib/npm-release.mjs) adds only toolkit invariants:
reject dirty tracked sources/index before verify-command, pack with the selected
native tool, validate the archived manifest with tar, optionally test the file
through package-verify-command, then revalidate source and tarball SHA-256 before
the built-in publisher runs. Outputs are written only after publication succeeds.
There is no separate publishing engine or npm authentication implementation.
Candidate preflight uses the toolkit's bundled semver 7.8.5 to reject invalid or
noncanonical package versions and dist-tags that are SemVer ranges before checks.
Consumers install neither semver nor the toolkit's build tool.
The source version and release tag retain build metadata. pnpm may omit it from
the packed manifest, and npm registry metadata always omits it; the public version
output therefore uses that registry version. The full source version and original
tarball bytes remain checked. Different build metadata is not a new npm version.

Publication preflight and later candidate checks require npm's effective dry-run
configuration to be false, including environment and .npmrc settings. An inherited
dry run is rejected rather than reported as publication or forced into a real
publish. Use the preparation --dry-run entry above for previews.

package-manager defaults to npm; select pnpm for catalog:/workspace: dependencies.
Both packers disable lifecycle scripts. verify-command must build explicitly.
package-verify-command receives the absolute TARBALL path in the package directory;
consume that file rather than pack again. The [npm example](../examples/npm-package/publish.yml)
installs it offline and checks its exported behavior. Omitting this optional
command checks identity/consistency, not product compatibility. The built-in npm
publisher publishes the same file for OIDC/provenance, including pnpm-packed files.

Tests use real release-it, npm and pnpm 12, replacing only remote publication and
hosted APIs. Consumer fixtures install sources with --omit=dev and receive the
toolkit's locked release-it installation; they do not download dev tools in every test.
CI separately installs both npm examples' complete locked dependencies and runs
their release-it CLI.
Live OIDC, remote inheritance and provider acceptance remain unverified.

## Packing library evaluation

On October 21, 2026, @publint/pack 0.1.7 was evaluated in temporary Git fixtures
with Node 24.22.0, npm 11.19.1 and pnpm 12.14.0. It was not added as a dependency.
The evaluated npm distribution includes tinyexec as a dependency.

| Experiment | Observed result |
| --- | --- |
| npm/pnpm pack with ignoreScripts=true and a failing prepack hook | Both passed; extracted manifests matched native tar. |
| pnpm catalog:/workspace: dependencies | Expanded to the expected registry/workspace versions. |
| pnpm publishConfig.directory with another repository in its manifest | The actual alternate manifest was exposed; toolkit identity policy is still needed. |
| Gzipped archive with a damaged tar header checksum | Native tar failed; unpack() still returned the manifest. |
| Valid PAX archive overriding package/package.json to package/other.json | Native tar applied the override and found no package/package.json; unpack() returned the nominal package/package.json name. |

These archive experiments show differences in parsing semantics, not evidence
that ordinary npm/pnpm output triggers them. unpack() is not a direct substitute
for the current manifest verification. pack() alone would remove only a small
adapter while adding tinyexec and selecting a tarball via stdout filename matching.
The combined replacement does not justify its cost here: retain native pack/tar,
the final candidate checks and the exact-tarball SHA-256 check. Package-quality
tools can still consume TARBALL through package-verify-command.

## Additional plugins

Add @release-it/bumper only when other manifests need version synchronization;
evaluate workspace plugins when multiple packages actually need orchestration.
release-it-pnpm 4.6.6 declares release-it 17–19 support and publishes during bump,
so it is not used here. The packing evaluation above explains the current choice
to retain native packers. Existing package-quality tools can run through
package-verify-command.

See upstream [plugins](https://github.com/release-it/release-it/blob/main/docs/plugins.md),
[configuration](https://github.com/release-it/release-it/blob/main/docs/configuration.md)
and [Conventional Changelog](https://github.com/release-it/conventional-changelog).
