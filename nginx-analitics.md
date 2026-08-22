# Nginx analytics and service telemetry

## Purpose

Ujimu uses Nginx to terminate TLS and proxy production traffic to the application on `127.0.0.1:3010`. Nginx telemetry is intended to answer operational questions about traffic volume, route popularity, acquisition, latency, response size, errors, protocol use, and streaming duration.

Nginx is not the source of truth for product funnels, distinct visitors, specialist selection, answer grounding, citations, registrations, or subscriptions. Those events belong in the application, where they can be modelled explicitly without inferring user behaviour from network identifiers.

## Data worth retaining

### Audience and acquisition

- Normalized route group, never dynamic route identifiers.
- Referring domain, never the full referring URL.
- User-Agent for short-lived derivation of browser, operating system, device class, and bot traffic.
- Request timestamp for hourly, daily, and seasonal analysis.
- Coarse country or region only if a trusted local GeoIP module is deliberately installed later.
- New and returning visitor metrics from Ujimu's existing first-party visitor analytics, not from IP addresses.

### Service quality

- HTTP method and response status.
- Total request duration.
- Upstream connection, header, and response times.
- Upstream status.
- Request and response byte counts.
- Response content type.
- HTTP and TLS protocol versions.
- Gzip ratio.
- Connection request count and request completion state.
- Random request ID for correlation between Nginx and application logs.

For `/api/chat`, Nginx measures total streaming duration. Time to first token must be measured in the application because total proxy request time does not represent that metric.

## Data not retained in the analytics log

- Raw or hashed IP addresses.
- Request or response bodies.
- Authorization headers.
- Session, visitor, quota, or conversation cookies.
- Full request URLs or query strings.
- Conversation, passkey, payment, or other dynamic identifiers embedded in paths.
- Full referrer URLs.
- Questions, answers, citations, or specialist documents.
- Precise geolocation or cross-site fingerprints.

Use `$uri` only for route classification. Do not log `$request_uri`, because it contains query strings.

## Production implementation

Production host: `root@labs.zafir.co.ao`

Nginx virtual host: `/etc/nginx/conf.d/ujimu.com.conf`

Analytics log: `/var/log/nginx/ujimu.analytics.jsonl`

Log rotation: `/etc/logrotate.d/ujimu-analytics`

The Ujimu virtual host defines:

- `map` rules that convert paths into non-identifying route groups;
- a `map` that reduces the referrer to its hostname;
- an escaped JSON log format;
- a dedicated buffered access log;
- `X-Request-ID` forwarding to the application and return to the client;
- no Ujimu-specific raw-IP access log.

GeoIP is intentionally not enabled because the production Nginx build does not currently include a GeoIP module. Installing a module solely for the initial traffic target would add unnecessary operational and privacy cost.

## Retention

Raw analytics logs are rotated daily, compressed, and retained for 30 rotations. File mode is `0640`, owned by `www-data:adm`.

Recommended longer-term retention:

- Raw privacy-minimized analytics: 30 days.
- Monthly aggregates without User-Agent or request IDs: 12–24 months.
- Security logs containing raw IP addresses, if introduced for a documented abuse case: 7–14 days with separate access control.
- Error logs: approximately 30 days, adjusted to operational need.

Retention must be implemented as deletion, not only documented as policy. Backups and exported log copies must follow the same classification and lifecycle.

## Metrics derived from the log

- Requests by hour, day, month, and route group.
- Popular public pages and specialist page traffic.
- Referring domains.
- Browser, device-class, operating-system, and bot shares after User-Agent derivation.
- HTTP status and error rates by route.
- `499`, `502`, `503`, and `504` trends.
- p50, p95, and p99 request and upstream latency.
- Chat streaming duration.
- Request and response traffic volume.
- HTTP/2 and TLS adoption.
- Compression effectiveness.
- Upstream availability.

## Product events that remain application-owned

- Specialist selected.
- Question started, queued, completed, or abandoned.
- Time to first token.
- Answer grounded or rejected for insufficient context.
- Citations displayed.
- Registration and authentication.
- Subscription conversion.
- Returning visitor and account activity.
- Satisfaction signals.

These events should use explicit event names and categories without duplicating question or answer text.

## Operational procedure

1. Back up the active virtual-host and logrotate files.
2. Install the candidate configuration without reloading Nginx.
3. Run `nginx -t`.
4. Run logrotate in debug mode to detect duplicate or invalid entries.
5. Reload Nginx only after both checks pass.
6. Confirm the service remains healthy over HTTPS.
7. Confirm `X-Request-ID` is present.
8. Parse a generated analytics line as JSON and confirm it contains no IP, cookie, query, body, or authorization fields.
9. Confirm log ownership and rotation configuration.

## Privacy and security notes

IP addresses, persistent identifiers, User-Agent strings, and combinations of request metadata can constitute personal data. Collection must have a defined purpose, access control, disclosed retention, and a working deletion process. Ujimu already has first-party visitor, quota, and question analytics; copying those identifiers into Nginx would create an unnecessary second identity store.

The production reverse proxy must overwrite trusted client-IP headers before `UJIMU_TRUST_PROXY_HEADERS=true` is used by the application. Access to `/var/log/nginx` should remain limited to administrators and the `adm` group.

## Official Nginx references

- Log module, JSON escaping, buffering, and conditional logging: https://nginx.org/en/docs/http/ngx_http_log_module.html
- Map module and regular-expression captures: https://nginx.org/en/docs/http/ngx_http_map_module.html
- Embedded variables, including request and connection variables: https://nginx.org/en/docs/http/ngx_http_core_module.html#variables
- Proxy timing and upstream variables: https://nginx.org/en/docs/http/ngx_http_upstream_module.html#variables
