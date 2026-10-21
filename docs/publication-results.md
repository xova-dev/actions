# npm publication results

English | [简体中文](publication-results.zh-CN.md)

Only after release-it's native npm publisher confirms publication does the toolkit record publication-result.json, append a GitHub job summary and upload the JSON as a same-run artifact. Merely reaching afterRelease is not proof: a skipped publisher produces no successful record. Reporting happens before any downstream documentation deployment; a later deployment failure does not remove the npm evidence.

## Contents and outputs

The JSON uses schemaVersion=1 and status=published. It records repository, packageName, version (the npm registry version), sourceVersion (including build metadata), npmTag, releaseTag, sourceSha, tarballSha256, runId, runAttempt and runUrl. Run fields are null when unavailable in local fixtures. The digest is the original SHA-256 already checked immediately before publication; reporting never repacks or changes the tarball.

The public npm-publish action and release.yml expose source-sha, version, tarball-sha256 and publication-artifact. The last output is the artifact name, not a local file path. Its safe name includes a bounded package label and a package/version fingerprint, so scoped packages and separate package identities do not collide. The artifact contains only publication-result.json; it does not upload the tarball, npm configuration, tokens or the process environment. Retention follows repository defaults.

## Documentation recovery

1. Open the npm publication job's summary, even if the overall release workflow failed. If needed, download its publication-artifact and read publication-result.json.
2. Confirm native npm publication from the job logs and provenance; a reporting or upload failure can make the npm job itself fail after publication. Check repository, packageName, version, runId/runAttempt and the recorded source. This JSON is a diagnostic record from that job, not an independent registry attestation or proof that documentation deployed.
3. In the consumer's documentation recovery entry, use releaseTag as both the workflow ref and release-tag input, and sourceSha as published-sha. The selected tag must contain that entry.
4. Recovery rebuilds from the confirmed source, uploads a fresh documentation artifact and applies the existing deployment policy and lock. It never republishes npm or relabels an old artifact.

Matrix's Recover documentation entry already takes these release-tag/published-sha fields; no project-specific recovery script or new shared-workflow input is needed.

## Failure boundaries

Failed candidate checks, pack checks, tarball verification, npm dry-run configuration, skipped publication and failed npm publication produce no successful result or publication artifact. The final candidate and original tarball checks still run before npm.

If the Markdown summary cannot be written, a visible warning is emitted and the saved JSON is still uploaded; publication outputs remain available. This presentation failure does not turn successful publication into a failed job when the result upload succeeds.

Failure to write the JSON remains fatal, with an explicit message that npm already succeeded and must not be replayed. An artifact-upload failure also fails the job, while the summary normally remains available. Neither failure guarantees a downloadable result; runner-local files are ephemeral. Inspect native npm logs, registry state and provenance instead of automatically republishing the immutable version. Expired artifacts likewise require job/provenance evidence.
