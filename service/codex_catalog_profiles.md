# Codex capability profiles

`codex_catalog_profiles.json` is a model-keyed capability registry from the
installed OpenAI Codex CLI 0.153.2 bundled catalog (`codex debug models
--bundled`). It preserves opaque tool fields and instructions. It was checked
against BeiAPI's temporary Nginx catalog on 2026-09-05.

This registry does **not** decide model availability. `controller.ListModels`
first applies the existing enabled-channel/group, token-model and billing
filters. `BuildCodexModelCatalog` uses the resulting names to select profiles,
marks configured regular models visible, and keeps automatic modes hidden.
No registry-only model is added to the response. Unknown models are included
only when NewAPI explicitly advertises a Responses endpoint; their fallback
is text-only, with no guessed reasoning levels or vendor-specific tools.

Update capability defaults from a reviewed Codex release when its schema or
model capabilities change. Preserve source attribution under the OpenAI Codex
Apache-2.0 license. Never export user config, cached account-specific catalogs,
credentials or request headers as profiles. Ordinary channel additions and
removals require no registry change for models already described here.

Design reference: Wei-Shaw/sub2api PR #5926 (route-aware catalogs); this
implementation uses NewAPI's existing authorization and availability query.
