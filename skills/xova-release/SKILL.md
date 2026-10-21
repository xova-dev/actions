---
name: xova-release
description: Prepare or execute a project's release using release-it and Xova Actions. Use for consumers of this toolkit; follow the project's own checks and release policy.
---

# Xova Release

Read the project's instructions, release workflow, package scripts and Git state.
Establish the requested version, candidate and existing authorization. Preserve
unrelated work; reuse authorization already given.

For preparation, use the project's installed release-it CLI with the shared
preparation preset. Preview the explicit version with --dry-run before writing.
Inspect consumer hooks and the resulting diff/index; the official plugin may stage
a new changelog. Keep commit, tag, push and publication disabled until authorized. Review
user-facing changes and add necessary release notes, migration documents or
examples; generated commit summaries do not establish their completeness.

Verify the final candidate, including the project's required package and document
checks. Release commits may include all necessary changes; parent CI and a
`chore(release)` title do not exempt them from verification. Keep paid model or
external acceptance runs within separately established authorization.

Select the native npm/pnpm packer. Package checks can consume the action's TARBALL
through package-verify-command; never repack a different file for publication.

For authorized delivery, follow the project's commit, tag, push and GitHub Release
commands. The npm and documentation workflows consume the same candidate; a
successful trigger alone is not publication or deployment. Check workflow results,
registry version/dist-tag and the intended site. Allow for registry propagation
before classifying an immediate missing version as a publishing failure. Registry
versions omit SemVer build metadata; keep the source tag unchanged.

On failure, inspect which effects occurred before replaying. An existing npm
version is immutable; repair a failed documentation deployment independently.
Report actual results and remaining gaps. This Skill grants no Git, remote,
publication, deployment or installation authority.
