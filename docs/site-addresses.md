# API and business site addresses

- `ServerAddress`: model API origin; retained for existing integrations.
- `SiteAddress`: business origin for reset emails, notification links, default
  payment returns/callbacks, and Passkey defaults. Empty retains the API-address
  fallback and legacy unrestricted browser-origin behavior.
- `SiteAllowedOrigins`: optional exact additional business origins, newline or
  comma separated. Include every supported www/alternate brand origin before
  enabling `SiteAddress`. This is separate from OAuth provider registration,
  Passkey RP IDs/origins, CORS, and cookie settings.

These options live in the existing options table and are applied by the option
API without a restart. No database schema migration is needed. `/api/status`
exposes `api_address`, the compatible `server_address` alias, `site_address`,
`site_address_configured`, and `site_allowed_origins`.

Browser payment/OAuth URLs preserve Host/TLS (or X-Forwarded-Proto) only for an
exact configured business origin. Other hosts use the default business site.
Proxies must preserve Host and overwrite X-Forwarded-Proto. OAuth authorization
and token exchange share the same callback policy. Register each supported
`/oauth/{provider}` callback with its provider, including LinuxDO; existing
explicit Passkey settings are preserved. Start login/binding on a business
origin so browser-bound state and popup origin checks stay on the same site.

Payment `CustomCallbackAddress` and provider-specific overrides retain priority.
Changing either default address does not rewrite existing payment orders or
provider-dashboard webhook settings. Web business requests keep their current
same-origin `/api/...` transport. This change does not redirect or disable old
API hosts or old reset links.

Client setup and code examples use the API address. The dashboard API-info list
remains a separate list of advertised routes; its first entry is only a legacy
setup fallback when the API address is empty. Existing low-quota emails continue
to omit wallet links. Generated image/video resource URLs use the API address.

Before release: verify reset mail against a local SMTP fixture; exercise payment
returns and OAuth on every configured business origin; verify the configured
API endpoint in client exports and model examples. Configure aliases first,
then the business default. Keep the old three option values for rollback;
clearing SiteAddress restores the address fallback without touching user data.
