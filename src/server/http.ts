// Small helpers for route handlers.

/** The visitor's address, as nginx reports it. Null when it cannot be told. */
export function clientIp(headers: Headers): string | null {
  const address = headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  // Only a plain IPv4 or IPv6 address is kept: this value is stored and compared.
  return /^[0-9a-fA-F:.]{3,45}$/.test(address) ? address : null;
}

/**
 * Sends the browser on to another page of this site after a form has been
 * handled. The address is relative, so it is right whatever name or scheme
 * the request arrived under.
 */
export function seeOther(path: string): Response {
  return new Response(null, { status: 303, headers: { Location: path, "Cache-Control": "no-store" } });
}

/** A form field as text, trimmed, or "" when it is missing. */
export function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** A whole number from a form field, or NaN. */
export function numberField(form: FormData, name: string): number {
  const value = field(form, name);
  return /^-?\d+$/.test(value) ? Number(value) : Number.NaN;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
