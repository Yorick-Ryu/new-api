# BeiAPI build versions

The reviewed upstream baseline, its source commit, the local integration commit,
and the manual BeiAPI `revision` are stored in `.github/beiapi-version-base`.
Increment `revision` once for each change explicitly requested by the owner.
Keep one increment for the entire request, including follow-up commits for the
same change. Routine commits, merges, upstream syncs and rebuilds do not advance
the number on their own.

Stable baselines use `v1.0.0-beiapi.1`; prerelease baselines use
`v1.0.0-rc.46.beiapi.1`. Uncommitted or untracked files append `-dirty`.
Inspect the version with `bash .github/scripts/beiapi-version.sh`. Full Git
history and the recorded upstream tag are required. Selective integrations may
retain intentional exclusions; document those in the integration commits.
When the approved upstream release version changes, update the baseline fields
and reset `revision` to zero. For each new release, use an unused version tag.
Published tags stay on their original commits.

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
