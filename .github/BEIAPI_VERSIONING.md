# BeiAPI build versions

The reviewed upstream baseline and its exact source commit are pinned in
`.github/beiapi-version-base`, together with the local integration commit.
Subsequent first-parent commits increment the BeiAPI revision once each,
including docs, reverts and merges. Commits within merged branches do not inflate
the count. Rebuilding a commit does not change its version.

Stable baselines use `v1.0.0-beiapi.1`; prerelease baselines use
`v1.0.0-rc.46.beiapi.1`. Uncommitted or untracked files append `-dirty`.
Inspect the version with `bash .github/scripts/beiapi-version.sh`. Full Git
history and the recorded upstream tag are required. Selective integrations may
retain intentional exclusions; document those in the integration commits.
After a new integration, update all three metadata fields in a follow-up commit.
The integration is revision zero; its metadata follow-up becomes revision one.

Only pushes of BeiAPI version tags build production images. Ordinary branch
pushes do not. Push source to `beiapi-production`, calculate the version from a
clean checkout, then create and push exactly that tag. The workflow verifies the
version and production-branch ancestry before building. It fetches the recorded
QuantumNous/new-api release tag and checks its pinned commit. Upstream Docker,
binary and Electron release workflows exclude BeiAPI tags to avoid duplicates.

The workflow writes the resolved version to the build checkout's `VERSION` file.
The existing Dockerfile passes that same value to the frontend and Go binary.
The image also receives a version tag and OCI version label, alongside the branch
and immutable SHA tags. For manual builds, calculate the version before writing
`VERSION`; the source file stays blank so it cannot drift from Git history.
Pin deployments by SHA or digest. Publishing a tag or image does not deploy,
restart services, or change production data.
