# Xova Actions

This repository owns reusable GitHub workflows, release preparation tools and the
`xova-release` Skill. Consumer repositories own their checks, release content and
deployment configuration. Organization defaults and workflow templates belong to
`xova-dev/.github`.

- Use `mise exec -- pnpm install --frozen-lockfile` and `mise exec -- pnpm test`.
- Use `mise exec -- pnpm lint`: actionlint 1.7.12 checks workflows/examples;
  action-validator 0.9.0 checks action metadata recursively under actions/.
- Test observable preparation and workflow behavior with temporary Git fixtures;
  never publish packages or deploy sites as a local test.
- Validate the final candidate commit. Release notes, migration documents and
  other necessary changes are allowed; do not require a version-only commit or
  substitute parent CI for candidate verification.
- Keep scripts deterministic and the Skill short. Project commands belong to the
  consumer; do not add Matrix- or RSP-specific branches to shared workflows.
- Preserve existing authorization. Implementation does not authorize committing,
  pushing, tagging, publication, deployment or installing the Skill globally.
