/** Facts about the page, written the way search engines read them. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  // "<" is escaped so that nothing in the data can close the script element.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
