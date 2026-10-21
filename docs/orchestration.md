# Shared release and recovery orchestration

English | [简体中文](orchestration.zh-CN.md)

Use the high-level workflows for standard flows. Consumers retain event triggers, product checks, commands, paths, environment selections and policy choices. Generic preflight, artifact restoration, dependency ordering and provider execution belong here. No per-project composite runner or duplicate upstream regression suite is needed.

## Entry points

| Workflow | Contract |
| --- | --- |
| [release.yml](../.github/workflows/release.yml) | Check native tag/SHA, optionally build documentation, verify/build/pack/test/publish one npm tarball, then optionally deploy the built documentation after npm succeeds. |
| [docs-recover.yml](../.github/workflows/docs-recover.yml) | Require the selected native tag and the operator-confirmed published-sha, rebuild documentation and deploy a new artifact without invoking npm publication. |
| [docs-deploy.yml](../.github/workflows/docs-deploy.yml) | Route to Pages or Cloudflare, using a selected deployment policy and provider-specific permissions. |

The lower-level npm-publish/docs-build/docs-pages/docs-cloudflare recipes and composite actions remain available for custom composition. Internal nested workflow calls resolve within the toolkit revision, just like the existing same-commit composite references.

## Consumer configuration

Inside a project workflow with a release event or a tag-selected manual entry, a package-only call can be:

```yaml
jobs:
  release:
    uses: xova-dev/actions/.github/workflows/release.yml@<verified-full-sha>
    permissions:
      contents: read
      id-token: write
    with:
      release-tag: ${{ github.event.release.tag_name || inputs.release-tag }}
      expected-sha: ${{ github.sha }}
      verify-command: npm test && npm run build
      package-verify-command: npm run check:package
```

Replace the SHA placeholder before use. The consumer owns check:package; it must consume the absolute TARBALL provided by the action rather than repack. Use package-manager=pnpm for catalog/workspace protocols. The final npm-candidate checks and tarball SHA-256 checks remain in npm-publish around native release-it publication. The early [release-source](../actions/release-source/action.yml) gate checks event identity and configuration; it does not replace package/tag/HEAD or packed-manifest verification.

For required product matrices, use a consumer-owned workflow and make the release call depend on its success. Pass that checked source as expected-sha. Matrix uses one checks.yml for both CI and publication; RSP will retain its own product checks when migrated.

## Documentation and deployment

docs-provider defaults to none. Set pages or cloudflare and supply docs-check-command, docs-build-command and docs-site-directory to build documentation before publication. docs-working-directory defaults to the repository root independently of the package working-directory. docs-install-command falls back to install-command. Artifact retention defaults to seven days.

deployment-policy defaults to latest-stable in the high-level flows; always explicitly permits deployments without GitHub Release lookup. Lower-level provider recipes default to always for compatibility. Invalid selections fail. Set deploy-docs=false to build but not deploy after publication; Matrix selects true only for stable release events, retaining its manual-publication behavior.

The provider deployment job acquires its environment and concurrency lock before evaluating latest-stable. An ineligible version skips provider checkout, installation and deployment; API errors still fail. docs-concurrency-group can preserve an existing project lock and must be the same in release and recovery. Pages defaults to one repository-wide site; independent Cloudflare targets use different docs-site-id values. The policy is not an atomic lock against creation of another release.

The caller must grant contents:read and id-token:write for npm publication, plus pages:write when selecting Pages. Recovery with Pages needs pages:write/id-token:write; Cloudflare recovery only needs contents:read. Cloudflare callers pass CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID explicitly. Protected environments and Trusted Publishing remain consumer settings.

## Recovery and validation

Keep a thin workflow_dispatch entry in the consumer. It passes release-tag, published-sha and the same documentation/provider/lock settings to docs-recover.yml. The workflow must run at that confirmed tag and SHA. Operator confirmation is still required; this workflow does not infer npm publication from a tag or workflow trigger. Old artifact metadata is never relabeled.

Toolkit tests own generic source/recovery guards, release-it behavior, exact-tarball checks, provider policy ordering and artifact tampering. Consumer tests retain product behavior and minimal wiring checks. Example workflows with local calls are linted in temporary consumer layouts so local workflow contracts are checked without suppressing missing-file errors.

When a new orchestration revision is still local, consumers may use PENDING_ACTIONS_SHA as an explicit draft marker; do not point new workflow paths at an older SHA. After authorized toolkit delivery and remote CI verification, replace every pending workflow reference with the verified full SHA before consumer delivery. Existing preparation presets can remain pinned independently. Toolkit CI and local fixtures do not prove consumer-hosted nested execution, npm OIDC, artifact transport or deployment acceptance. Check required status names after extracting consumer checks into a reusable workflow.
