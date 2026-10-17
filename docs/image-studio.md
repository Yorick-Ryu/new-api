# Image Studio routing

The workbench uses the authenticated dashboard session and a server-held,
image-only API key. Options are read-only: `GET /api/image-studio/options`
returns models, supported controls and the estimated routing group. Discover
models from the user's permitted Auto groups in order, respecting any saved
key-specific Auto groups and model restrictions. Normal relay authentication
rechecks key status, expiry, quota, IP restrictions and current permissions.

`gemini-3.1-flash-image` uses non-streaming Chat Completions with text/image
modalities. The selector, result cards and details display its product name,
`Nano Banana 2`; requests, pricing and saved history retain the API model ID.
The workbench accepts up to 4 reference images for both Gemini and
GPT image models, using the same upload controls and workflow. Gemini offers
native aspect-ratio and resolution controls (`512`, `1K`, `2K`, `4K`, default
`1K`) instead of GPT size/quality settings. Its ratio picker uses the same
common presets as GPT: automatic, `1:1`, `16:9`, `9:16`, `3:4`, and `4:3`.
The validated selections persist
with each job and pass through Chat `image_config` to the upstream; selecting
a ratio does not rewrite the prompt. Omitted parameters retain model defaults.
The workbench's 1–4 batch selector submits independent requests, each using
`n=1`; the current upstream rejects multiple candidates. One candidate may
contain multiple images, which are all retained within the existing four-image
response bound. Images in message `images` data URLs
enter the same temporary delivery, browser history and download path as other
workbench images. Other Gemini Chat models are not automatically image models.
See [Google's reference-image and output-count guidance](https://ai.google.dev/gemini-api/docs/image-generation).
Although 14 references and a two-image single response were verified on this
channel, the workbench intentionally limits reference input to 4. Output counts
requested in the prompt are not guaranteed by the model.

All workbench requests use wallet funding, including accounts configured for
subscription-only API use. Fixed request prices and group ratios come from
current pricing configuration; no price is embedded in the workbench. Unknown
or image-less upstream results are not automatically generated again. A
successful upstream response can still incur its ordinary request charge when
it contains no usable image; the job then reports an unconfirmed result.

New workbench keys use `auto`. On submission, an existing key upgrades only if
it still matches the original default policy: original name, enabled, no expiry,
unlimited quota, no IP/Auto-group/retry customization, and an exact match to
the legacy default-group image allowlist. The key ID and credential are retained;
cache invalidation precedes the update, and a security audit records the key ID.
Customized keys keep their controls and only show their accessible models. To
use Gemini with a customized legacy key, its owner must explicitly allow the
model and suitable Auto routing in API Keys. Missing model permissions are never
silently expanded on an already-Auto key.

No schema migration is required. Before deploying, preserve the current image
and the managed-key policy metadata needed for rollback. An older workbench
accepts only `default` keys: reverting to it also requires reviewing newly
created/upgraded `auto` workbench keys and preserving subsequent owner edits.
Do not revert wallet balances or consumption history with the application.
