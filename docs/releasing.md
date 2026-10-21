# Releasing

English | [简体中文](releasing.zh-CN.md)

Establish the version and authorization, then inspect the consumer release entry
and Git state. The release-it changelog plugin summarizes commits; it does not replace release notes
or migration decisions. Read [publication limits](adoption.md#publication-guarantees-and-limits)
and the [interface scope](architecture.md#scope-and-ownership) before live delivery.

Standard callers use [shared release/recovery orchestration](project-workflows.md). Product checks finish first; the toolkit then validates the native candidate, builds documentation when selected, publishes the checked tarball and deploys only after npm success.

## Package release

1. Preview an explicit version with the consumer's release-it entry and the shared
   [preparation preset](release-it.md), then prepare in a clean worktree. Inspect
   consumer hooks and the resulting index; the official plugin may stage a new changelog.
2. Review the full diff and add release notes, migrations or examples.
3. Run project checks and commit when authorized. All necessary release materials
   may be included; no file allowlist, parent-count or special title is required.
4. With authorization, create a tag matching the package version and tag-prefix,
   push the candidate and create a GitHub Release if the project uses one.
5. Invoke release.yml at that tag; use npm-publish only for custom composition. Its explicit checks/builds and native npm/pnpm
   packing verify the final candidate. package-verify-command can test that same
   file via TARBALL. Source and bytes are rechecked before npm OIDC publication,
   without lifecycle scripts or repacking. Required upstream jobs check the same expected-sha.
6. Apply the project's site policy. Publication-coupled sites deploy only after npm
   succeeds, using its source-sha and the matching documentation artifact. docs-only
   sites can deploy independently. latest-release is optional, not a provider rule.

If OS/Node matrices are required, complete them for the exact candidate or include
them in the release graph. Shared actions do not guess required jobs; skipped or
missing checks do not become successful checks.

For manual publication at an already-confirmed v0.4.0 candidate:

```sh
gh workflow run publish.yml --ref v0.4.0 -f release-tag=v0.4.0
```

The caller entry must exist at that tag, and GitHub requires its dispatch-enabled
workflow on the default branch too. Native GITHUB_SHA/GITHUB_REF must match the
candidate and tag. Dispatching from main with another tag input fails before
verification or publication. Subpackage callers use their own matching tag prefix;
the example subpackage workflow uses a tag push instead of workflow_dispatch.

## Failure recovery

- **Preparation fails:** inspect and retain partial work before retrying.
- **Checks/packing/tarball verification fail:** correct and reverify the candidate. Changing tags still
  follows project authorization.
- **npm fails:** inspect logs and registry state before replaying; retain the
  failure. Immediate missing metadata can be propagation delay.
- **Repository preflight fails:** correct package.json repository to match the
  consumer GitHub repository, including case, then reverify the candidate.
  A Git remote or a Trusted Publisher entry does not fill missing package metadata.
- **npm succeeds, docs fail:** do not republish the immutable version. Confirm native
  npm publication using logs, the [saved result/summary](publication-results.md) and provenance even if the npm job or overall workflow failed. Use a thin
  docs-recover.yml call at the confirmed release tag with published-sha. Shared recovery
  rebuilds that source and passes it as expected-sha to deployment without invoking npm.
- **Artifacts expire or fail validation:** rebuild from the confirmed source
  using the current builder. Recovery uploads/deploys a new artifact in its own run.
  Do not substitute newer main content or invent missing metadata.

For stable-release sites, select deployment-policy=latest-stable in shared release/recovery.
It runs latest-release within the serialized provider job and conditions the adapter
on eligible=true; only custom composite callers wire these steps themselves. An old release, prerelease or draft
yields false. A first prerelease needs no existing stable release: the policy
checks its type before requesting latest. Missing releases, API failures and
stable candidate source mismatches fail. Follow the examples' ordering so environment
approval or queue waits do not leave an earlier eligibility decision stale.

Configure Trusted Publishing, environments and the provider before first use, as
in [adoption](adoption.md#configure-a-consumer). A workflow trigger or local test is
not a publication/deployment result or authorization.

## Upgrading the shared interface

Pin a verified full SHA. Validate action/workflow inputs, outputs, defaults,
failure/skip semantics and artifact format against independent npm, subpackage,
docs-only and multi-site fixtures, then affected Matrix/RSP examples. Stable
breaking changes require a new major interface; internal lib paths are not an API.
The draft v1 remains a placeholder until remote validation and publication.
