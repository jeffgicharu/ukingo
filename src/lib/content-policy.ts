// What a page from this site may load and run, sent with every response as
// its Content-Security-Policy.
//
// Scripts run only from this site, and inline only when they carry the
// number made for that one request: Next.js puts it on its own inline scripts.
// A script slipped into a page by way of something a guest typed has no
// such number, and the browser refuses it.

/** Cloudflare, in front of the site, adds its visitor-count script to pages and sends the counts home. */
const CLOUDFLARE_SCRIPT = "https://static.cloudflareinsights.com";
const CLOUDFLARE_COUNTS = "https://cloudflareinsights.com";

/** A fresh, unguessable number for one request. */
export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function contentPolicy({
  nonce,
  https,
  development = false,
}: {
  nonce: string;
  /** Served over HTTPS: any stray plain-HTTP address is then fetched over HTTPS. */
  https: boolean;
  /** The development server builds error pages with eval. */
  development?: boolean;
}): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' ${CLOUDFLARE_SCRIPT}${development ? " 'unsafe-eval'" : ""}`,
    // Photographs carry their loading colour, and emails their layout, in style attributes.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${CLOUDFLARE_COUNTS}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
