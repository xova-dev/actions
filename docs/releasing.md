# Releasing

English | [简体中文](releasing.zh-CN.md)

Establish the version and authorization, then inspect the consumer release entry
and Git state. Changelogen summarizes commits; it does not replace release notes
or migration decisions. Read [publication limits](adoption.md#publication-guarantees-and-limits)
and the [interface scope](architecture.md#scope-and-ownership) before live delivery.

## Package release

1. Preview an explicit version with release.mjs, then prepare version/changelog in
   a clean worktree. This script supports one package with v-prefixed tags; use the
   consumer's own tool for a different release model.
2. Review the full diff and add release notes, migrations or examples.
3. Run project checks and commit when authorized. All necessary release materials
   may be included; no file allowlist, parent-count or special title is required.
4. With authorization, create a tag matching the package version and tag-prefix,
   push the candidate and create a GitHub Release if the project uses one.
5. Invoke npm-publish at that tag. Its explicit checks/builds and packing verify
   the final candidate. The verified tarball is published with npm OIDC and lifecycle
   scripts disabled. Required upstream jobs must check the same expected-sha.
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
- **Checks/packing fail:** correct and reverify the candidate. Changing tags still
  follows project authorization.
- **npm fails:** inspect logs and registry state before replaying; retain the
  failure. Immediate missing metadata can be propagation delay.
- **Repository preflight fails:** correct package.json repository to match the
  consumer GitHub repository, including case, then reverify the candidate.
  A Git remote or a Trusted Publisher entry does not fill missing package metadata.
- **npm succeeds, docs fail:** do not republish the immutable version. Use a separate
  recovery entry, confirm the published commit, rebuild its documentation and pass
  that SHA as expected-sha. Matrix/RSP recovery inputs retain published-sha as the
  operator's record; the deployment action takes expected-sha.
- **Artifacts expire or use the old format:** rebuild from the confirmed source
  using the current builder. Recovery uploads/deploys a new artifact in its own run.
  Do not substitute newer main content or invent missing metadata.

For stable-release sites, run latest-release within the serialized deployment job
and condition the adapter on eligible=true. An old release, prerelease or draft
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
