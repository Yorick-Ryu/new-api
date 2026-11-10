# Codex capability profiles

`codex_catalog_profiles.json` is a model-keyed capability registry from the
installed OpenAI Codex CLI 0.153.2 bundled catalog (`codex debug models
--bundled`). It preserves opaque tool fields and instructions. It was checked
against BeiAPI's temporary Nginx catalog on 2026-09-05.

The `gpt-6-sol` and `gpt-6-luna` profiles come from the official
`openai/codex` catalog at commit
[`39598ed17885970828acd42a6370131ed0190a98`](https://github.com/openai/codex/blob/39598ed17885970828acd42a6370131ed0190a98/codex-rs/models-manager/models.json).
Their capabilities and model messages are preserved; availability fields are
omitted because NewAPI supplies authorization and visibility. Source profiles may
retain legacy `base_instructions`, but responses emit only
`model_messages.instructions_template`. Legacy-only profiles are promoted without
discarding other messages. Codex 0.147.0 made the old field optional (upstream
`df72fdb415ee`), before explicit `model_catalog_url` support shipped in 0.156.0
(`888be42a20c5`). The catalog has no old-client branch.

System settings → Models → Codex can synchronize the current public
`openai/codex` main-branch catalog and edit per-model capability overrides.
`CodexOfficialModelProfiles` stores the validated revision and snapshot;
`CodexModelProfiles` stores manual overrides. Catalog requests read these
settings immediately. Codex ordering uses the per-model `priority` override
(lower values first), independently of marketplace `ModelDisplayOrder`. Official
sync updates default priorities; manual overrides take precedence. Channel
permissions remain authoritative.

The legacy `gpt-5.3-codex-spark` profile comes from the existing CLIProxyAPI
Codex client registry (`02e3d33c`, `internal/registry/models/codex_client_models.json`).
It retains its own 128K/text-only capabilities rather than inheriting Astra's.

This registry does **not** decide model availability. `controller.ListModels`
first applies the existing enabled-channel/group, token-model and billing
filters. `BuildCodexModelCatalog` uses the resulting names to select profiles,
marks configured regular models visible, and keeps automatic modes hidden.
No registry-only model is added to the response. Both the client catalog and
desktop setup require a bundled, synced official, or manually saved Codex
profile; advertising a Responses endpoint alone does not add a model. Manually
saved custom profiles inherit conservative defaults for omitted fields, with
no guessed reasoning levels or vendor-specific tools.

Update capability defaults from a reviewed Codex release when its schema or
model capabilities change. Preserve source attribution under the OpenAI Codex
Apache-2.0 license. Never export user config, cached account-specific catalogs,
credentials or request headers as profiles. Ordinary channel additions and
removals require no registry change for models already described here.

Design reference: Wei-Shaw/sub2api PR #5926 (route-aware catalogs); this
implementation uses NewAPI's existing authorization and availability query.
