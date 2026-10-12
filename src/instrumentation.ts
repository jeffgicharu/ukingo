import type { Instrumentation } from "next";

// When a page or a form handler fails on the server, the people who run the
// site are told. The visitor sees the site's own "something went wrong" page
// either way.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // Only on the server proper. The alert writes to the database, which the edge has no way to reach.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const failure = error as { message?: string; stack?: string; digest?: string };
  // The address without its query: a booking's private link or a typed detail has no business in an email.
  const path = request.path.split("?")[0].replace(/(\/b\/UKG-[A-Z0-9]+)\.[\w-]+/i, "$1.…");
  const { alert } = await import("@/server/alerts");
  await alert(
    `site:${context.routePath}`,
    `The site failed on ${request.method} ${context.routePath}`,
    [
      `Address: ${path}`,
      `Where: ${context.routeType}${context.renderSource ? `, ${context.renderSource}` : ""}`,
      failure.digest ? `Digest: ${failure.digest}` : "",
      "",
      failure.stack ?? failure.message ?? String(error),
    ]
      .filter((line, index) => line !== "" || index === 3)
      .join("\n"),
  );
};
