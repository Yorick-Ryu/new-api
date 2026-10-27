<!--
For project-owner requests, agents use this template as required by AGENTS.md. For other agent-created PRs, read `.agents/github/PR.md` and use it as the entire PR body.
-->
# PR Notice

Chinese template: `.github/PULL_REQUEST_TEMPLATE.md`

> [!IMPORTANT]
>
> - AI-assisted descriptions are welcome. Review and condense the full text before submitting, keep only the points maintainers need to re-check, and **take responsibility** for it. Do not paste unfiltered AI-generated text in the PR body or in later comments. Repeated submissions of this kind may result in a block.
> - Do not report issues when pass-through is enabled; pass-through sends content as-is and does not go through new-api processing logic.
> - Please complete this template before submitting.

## Related Issue
- For new features, please fill in the Issue number below. If none exists yet, please create one first. Please discuss the feature in the Issue rather than using the PR in its place.
- For large or directional changes, please reach agreement with maintainers in the linked Issue before opening a PR.
- Bug fixes should link a corresponding Issue. Design trade-offs, misunderstandings, or mismatched expectations are a better fit for a discussion or feature request.

- Closes #

## Type of change
- [ ] Bug fix
- [ ] New feature
- [ ] Performance / Refactor
- [ ] Documentation

## Description
(Briefly describe what changed and why it works. Do not paste unfiltered AI-generated text. If that is hard to summarize, consider splitting the scope or aligning with maintainers in an Issue first.)

## Proof of Work
(Record how this was verified: the actual commands or steps and the observed results. Stating only that `go build` or tests passed is not valid proof. For UI changes, include a screenshot or recording. For bug fixes, describe the reproduction and the result after the fix.)

## BeiAPI source, version and release

<!-- Target beiapi-production. See .github/BEIAPI_VERSIONING.md.
Only a matching BeiAPI version tag push builds the image; branch pushes do not.
Record source integration, image publication and deployment separately. -->

- Upstream baseline version and SHA:
- Ported upstream commits, adaptations and retained exclusions:
- Fork version (`bash .github/scripts/beiapi-version.sh`):
- Local integration commit when advancing the baseline:
- Release tag, image SHA / digest and build link:
- Deployment status and read-only acceptance:

## BeiAPI compatibility and rollback

- Config / API / default changes:
- Data migrations, billing impact and rollback residue, or not applicable:
- Rollback conditions, target image and verification gaps:
- Actual validation commands, outcomes and evidence; explain checks not run:

## Agent disclosure

- Agent, scope and human review:
- Model and reasoning effort (write unknown when unavailable):

## Checklist
- [ ] **Human review:** Whether or not the description was AI-generated, I have reviewed and condensed the full text, retained only the points needed for review, and take responsibility for its accuracy and completeness. I have not pasted unfiltered AI-generated text in the PR body or in later comments.
- [ ] **Not a duplicate:** I have searched existing [Issues](https://github.com/QuantumNous/new-api/issues) and [PRs](https://github.com/QuantumNous/new-api/pulls) and confirmed this is not a duplicate.
- [ ] **Feature issue:** If this PR is a New feature, I have linked a corresponding Issue; if none existed, I created one first.
- [ ] **Prior discussion:** If this is a large or directional change, I have discussed it with maintainers in the linked Issue and reached agreement.
- [ ] **Scope:** This PR is not a Coding Plan, reverse-engineered channel, third-party API wrapper, or a change to the Codex channel type.
- [ ] **Not pass-through:** This PR is not about forwarding behavior after enabling pass-through; pass-through sends content as-is and does not go through new-api processing logic.
- [ ] **Focused change:** This PR is a single focused change and does not include unrelated code.
- [ ] **Local verification:** I verified the changed path and recorded the commands and observed results. Stating only that `go build` or tests passed is not valid proof.
- [ ] **Security:** This change does not include secrets and follows the project's coding guidelines.
