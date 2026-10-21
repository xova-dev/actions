# Project workflows

English | [简体中文](project-workflows.zh-CN.md)

Declare commands once in `.github/xova.json`. Shared workflows own setup, source checks, packing, artifact validation and deployment ordering. Consumers retain event triggers, product matrices, permissions and environments.

| Path | Shared entry | Side effects |
| --- | --- | --- |
| Code checks | `check.yml`, kind=code | Install and check source; no publication/deployment. |
| Documentation checks | `check.yml`, kind=docs | Check, build and upload a source-bound site; no deployment. |
| Package release | `release.yml`, config-file | Validate native tag/SHA, build docs, verify/build/package/test/publish npm, optionally deploy docs. |
| Independent documentation delivery | `docs-deploy.yml`, config-file | Validate and deploy the already checked site from the same run; no npm path. |
| Documentation recovery | `docs-recover.yml`, config-file | Validate confirmed tag/SHA, rebuild and deploy docs; no npm path. |

These are separate permission boundaries: PR checks need contents:read only. All standard workflows use config-file (default .github/xova.json). Empty selections and missing files fail. Commands/setup/deployment come from that file without workflow-input overrides or fallback. Custom jobs/runners compose the operation actions directly. Runtime release tag, expected SHA, deploy-docs, artifact name and retention remain explicit inputs.

```json
{
  "schemaVersion": 1,
  "setup": {
    "toolchain": "mise",
    "install-command": "pnpm install --frozen-lockfile"
  },
  "code": {
    "check-command": "pnpm check"
  },
  "npm": {
    "package-manager": "pnpm",
    "verify-command": "pnpm build",
    "package-verify-command": "pnpm test:pack"
  },
  "docs": {
    "provider": "pages",
    "check-command": "pnpm docs:typecheck",
    "build-command": "pnpm docs:build",
    "site-directory": "docs/.vitepress/dist",
    "environment-name": "github-pages",
    "concurrency-group": "github-pages",
    "deployment-policy": "latest-stable"
  }
}
```

The editable [Valibot definition](../config/project.mjs) owns settings, defaults and task requirements. pnpm build uses the official @valibot/to-json-schema converter to generate the [input JSON Schema](../config/project.schema.json) and esbuild to bundle the runtime parser; CI checks both generated outputs. Consumers install no toolkit dependencies. Unknown fields, types and selections fail before commands. Consumer configuration must be tracked inside the exact clean checkout and is never imported as executable code.

setup defaults to Node 24, npm ci and repository root. Documentation inherits its working directory/install command unless overridden. A docs-only project can omit code/npm; an npm-only project can omit docs. No product name has special behavior.

Required settings follow the selected task:

| Task | Required settings beyond the structural Schema |
| --- | --- |
| code | code.check-command. |
| docs | docs.check-command, docs.build-command and docs.site-directory, including provider=none. |
| release | npm.verify-command; the three docs build settings above only when docs.provider is not none. |
| recovery | The three docs build settings above and a pages/cloudflare provider. |
| deploy | A pages/cloudflare provider; Cloudflare also requires docs.site-directory. Pages does not need build commands to deploy an existing artifact. |

Unused sections may omit their task-specific commands. Unknown fields, invalid types and explicitly invalid values still fail in every section; defaults and docs inheritance are unchanged. The generated JSON Schema describes structural rules, while the parser enforces this task table because task is a workflow input.

Each check job reads and normalizes project JSON once at its initial exact-source gate. After installation, code uses check-source before its command; docs-build retains its own source guards around checks/builds. The final check-source step checks tracked files, index and HEAD again after either path before exporting successful outputs, without rereading JSON. Other jobs validate their own checkout/configuration independently. Final package candidate and same-tarball checks remain separate and unchanged.

For independent documentation publication, call docs-deploy.yml after successful kind=docs checks, passing config-file and the check output as expected-sha. Only the delivery call receives provider write permissions. A site published from main explicitly selects docs.deployment-policy=always; release-coupled sites retain latest-stable and pass release-tag. The adapter validates the same-run artifact before deployment.

```yaml
jobs:
  code:
    permissions:
      contents: read
    uses: xova-dev/actions/.github/workflows/check.yml@PENDING_ACTIONS_SHA
    with:
      source-sha: ${{ github.sha }}
  documentation:
    permissions:
      contents: read
    uses: xova-dev/actions/.github/workflows/check.yml@PENDING_ACTIONS_SHA
    with:
      kind: docs
      source-sha: ${{ github.sha }}
```

PENDING_ACTIONS_SHA is an explicit local draft marker. Before consumer delivery, replace it with the full SHA of the delivered toolkit revision with passing remote CI; an older SHA cannot provide this new interface. config-file defaults to .github/xova.json. Product matrices can consume source-sha/code-changed after successful code checks, and still own OS/Node profiles and browser/hardware acceptance.

Ordinary CI can opt into detect-changes and declare both code.docs-only-command and code.docs-only-paths (Node path.matchesGlob patterns). Pushes compare the event before SHA; PRs compare the merge base. Empty changes, missing/unavailable bases or absent optimization settings run full checks. Configuration changes always run full checks; manual CI without a base does too. Release callers keep detect-changes=false: neither commit titles nor parent CI exempt the final candidate. Outputs are gated by successful checks; tracked source/index/HEAD are rechecked after code commands.

Release must depend on the consumer's complete checks for that exact SHA. With that gate, npm.verify-command can generate/build the package without repeating lint/types/examples in a fresh job. Without that gate it must include all required checks. Packing disables lifecycle scripts; TARBALL tests the actual publication file, whose SHA-256 is rechecked. Cross-platform tests may still pack separate files; this is not a claim of one tarball promoted across every platform.

Release and recovery read the same docs settings at the tagged SHA, with shared environments/locks and latest-stable evaluation after those gates. Recovery still requires operator confirmation of npm publication. A tag, overall workflow status or result JSON is not independent registry proof.

## Standard stages and runtime inputs

The four entries are check, release, docs-deploy and docs-recover. All accept config-file. check also accepts kind/source-sha/detect-changes; release accepts release-tag/expected-sha/deploy-docs; recovery requires release-tag/published-sha; delivery requires expected-sha and a release-tag for latest-stable. Check/release/recovery accept artifact-name/retention-days (documentation/7); delivery selects artifact-name. Artifact settings apply only to documentation. Input/output descriptions in workflow_call are authoritative.

Standalone docs, release and recovery all use check(kind=docs) with the same config-file and exact source. Release builds docs before npm, then deploys the same-run artifact after npm succeeds. Recovery rebuilds a new artifact without npm. Source/build jobs use contents:read only; npm has its own environment/concurrency and id-token:write. Pages callers grant pages:write/id-token:write; Cloudflare recovery needs contents:read and explicit provider secrets, without npm OIDC. Both paths reuse configured environments/locks.

Configuration owns setup, commands, providers, environments and policies. Multiple sites select separate tracked configuration files with distinct artifact names and site IDs; see the [multi-site blueprint](../examples/multi-site/docs.yml). [Adoption](adoption.md) covers administrator setup, [releasing](releasing.md) covers operations, and [verification](verification.md) defines test limits.

## Deployment policy

Shared provider workflows evaluate an opted-in latest-stable policy inside the deployment job after its environment gate and
concurrency acquisition; condition the provider action on eligible=true. An early
separate policy job could become stale while deployment waits. Matrix/RSP examples
select the shared flow enforcing this ordering; docs-only deliberately deploys main without release policy.
This is not an atomic lock against creation of a new release during deployment.

The policy queries the selected release by tag first. A prerelease or draft
returns eligible=false without calling releases/latest, including the first
prerelease before any stable release exists. Stable selections then query latest;
matching releases must resolve to the exact expected tag commit. Missing selected releases, authentication,
permission, service/transport errors and missing latest for a stable selection
remain failures; no API error is converted to a skip.

## Upstream references

Reviewed Vue core [CI](https://github.com/vuejs/core/blob/65eae178383289b6a9f93505ab85017460f72395/.github/workflows/ci.yml), [tests](https://github.com/vuejs/core/blob/65eae178383289b6a9f93505ab85017460f72395/.github/workflows/test.yml) and [release](https://github.com/vuejs/core/blob/65eae178383289b6a9f93505ab85017460f72395/.github/workflows/release.yml), plus Nuxt [CI](https://github.com/nuxt/nuxt/blob/fe9ca5bea14cae9a97fa60f833f043559963b355/.github/workflows/ci.yml), [docs](https://github.com/nuxt/nuxt/blob/fe9ca5bea14cae9a97fa60f833f043559963b355/.github/workflows/docs.yml) and [release](https://github.com/nuxt/nuxt/blob/fe9ca5bea14cae9a97fa60f833f043559963b355/.github/workflows/release.yml). Vue reuses product tests for tagged publication. Nuxt shares setup, filters paths and separates pack/publish through Uppt actions. We adopt explicit ownership and reusable stages, keep release-it for this scope, and do not copy commit-message skips or monorepo release-PR automation. [GitHub reuse guidance](https://docs.github.com/en/actions/concepts/workflows-and-actions/reusing-workflow-configurations) separates workflow/job policy from composite steps.
