# Xova Actions

This repository owns reusable GitHub workflows, release-it presets and the
`xova-release` Skill. Consumer repositories own their checks, release content and
deployment configuration. Organization defaults and workflow templates belong to
`xova-dev/.github`.

- Reuse release-it and the official Conventional Changelog plugin through
  config/.release-it.json; do not rebuild their version/changelog lifecycle.
- Use release-it's native CLI and npm publisher. Keep custom code limited to
  candidate, tarball and deployment invariants absent from upstream tools.
- Keep preparation separate from Git delivery and publication. Package tests
  consume TARBALL; publish the same bytes using the selected npm/pnpm packer.
- Use `mise exec -- pnpm install --frozen-lockfile` and `mise exec -- pnpm check`;
  check regenerates distribution files, then runs tests and lint.
- Keep the semver bundle and its license in Git; mark only generated code as
  linguist-generated. CI uses `mise exec -- pnpm build:check` without rewriting
  files or automatically committing/pushing. Consumers do not install toolkit
  dependencies. Keep final-candidate and same-tarball checks around native tools.
- Use `mise exec -- pnpm lint`: actionlint 1.7.12 checks workflows/examples;
  action-validator 0.9.0 checks action metadata recursively under actions/.
- Test observable preparation and workflow behavior with temporary Git fixtures;
  never publish packages or deploy sites as a local test.
- Validate the final candidate commit. Release notes, migration documents and
  other necessary changes are allowed; do not require a version-only commit or
  substitute parent CI for candidate verification.
- Keep scripts deterministic and the Skill short. Project commands belong to the
  consumer; do not add Matrix- or RSP-specific branches to shared workflows.
- Standard release, deployment and recovery orchestration belongs here. Consumers
  keep thin event entries, product commands and their required product matrices;
  do not copy generic composite runners or upstream regression suites into them.
- Evaluate deployment policy inside the provider environment/concurrency gate.
  Recovery rebuilds confirmed sources and must never invoke npm publication.
- Preserve existing authorization. Implementation does not authorize committing,
  pushing, tagging, publication, deployment or installing the Skill globally.
