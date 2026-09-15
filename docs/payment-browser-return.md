# Epay browser returns

Subscription checkout builds `return_url` from the checkout request's origin and
`/api/subscription/epay/return`. After signature verification and order completion,
the browser callback redirects to relative `/wallet?pay=success`; failure and
pending returns also stay on the callback host. Wallet top-up returns to the
checkout origin's `/usage-logs`.

The origin uses the request Host and TLS, or `X-Forwarded-Proto` behind a TLS
terminating proxy. Proxies must preserve Host and overwrite X-Forwarded-Proto.
Origin and X-Forwarded-Host headers do not choose a different return destination.
The scheme/host are validated before an order is created.

Server-to-server `notify_url` continues to use CustomCallbackAddress, falling
back to SiteAddress (or ServerAddress for legacy configurations). Browser returns
follow the [business-origin policy](site-addresses.md).
No schema migration, cookie change, order fulfillment change or gateway key
change is required. Orders created before deployment retain the return_url that
was already submitted to the gateway.

Validation: controller regression tests cover purchasing origins, TLS proxying,
invalid origins, GET/POST signed callbacks, idempotent renewal fulfillment, invalid
signatures and wallet top-up. `go test ./controller` and `go vet ./controller`.
