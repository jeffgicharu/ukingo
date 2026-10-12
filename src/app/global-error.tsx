"use client";

// The last resort: shown when even the page frame cannot be built. It brings
// its own document and styles, and depends on nothing else in the site.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en-KE">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "2rem 1.25rem",
          background: "#101d26",
          color: "#f6f8f5",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          lineHeight: 1.6,
        }}
      >
        <title>Something went wrong · Ukingo</title>
        <main style={{ maxWidth: "36rem", margin: "0 auto", width: "100%" }}>
          <p
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#f6c877",
            }}
          >
            Ukingo
          </p>
          <h1
            style={{
              fontFamily: "ui-serif, Georgia, serif",
              fontWeight: 400,
              fontSize: "2.75rem",
              lineHeight: 1.05,
              margin: "1rem 0 0",
            }}
          >
            That did not work. It is us, not you.
          </h1>
          <p style={{ fontSize: "1.125rem", color: "#edf1ec", marginTop: "1.25rem" }}>
            The site could not show this page. Nothing you entered has been lost or charged. Please try again in a
            moment.
          </p>
          <p style={{ marginTop: "2rem" }}>
            {/* A plain link on purpose: the page frame has failed, so the browser must load the site afresh. */}
            <a
              href="/"
              style={{
                display: "inline-block",
                padding: "0.8rem 1.4rem",
                borderRadius: "999px",
                background: "#e5a23a",
                color: "#0a141a",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Back to the lodge
            </a>
          </p>
          {error.digest ? (
            <p
              style={{
                fontSize: "0.75rem",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "#7f97a3",
                marginTop: "2.5rem",
              }}
            >
              Reference {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
