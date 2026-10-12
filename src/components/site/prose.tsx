import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Renders the plain text staff write for pages. It understands headings
 * (## and ###), lists (- item), **bold** and [links](/somewhere), and nothing
 * else. Anything that looks like HTML is shown as the text it is.
 */
export function Prose({ text, className = "" }: { text: string; className?: string }) {
  return <div className={`prose ${className}`}>{blocks(text)}</div>;
}

function blocks(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const chunks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);

  chunks.forEach((chunk, index) => {
    const lines = chunk.split("\n").filter((line) => line.trim() !== "");
    if (lines.length === 0) return;

    if (lines[0].startsWith("### ")) {
      out.push(<h3 key={index}>{inline(lines[0].slice(4))}</h3>);
      return;
    }
    if (lines[0].startsWith("## ")) {
      out.push(<h2 key={index}>{inline(lines[0].slice(3))}</h2>);
      return;
    }
    if (lines.every((line) => line.startsWith("- "))) {
      out.push(
        <ul key={index}>
          {lines.map((line, item) => (
            <li key={item}>{inline(line.slice(2))}</li>
          ))}
        </ul>,
      );
      return;
    }
    out.push(<p key={index}>{inline(lines.join(" "))}</p>);
  });

  return out;
}

const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;

  for (const match of text.matchAll(INLINE)) {
    const start = match.index;
    if (start > last) out.push(text.slice(last, start));

    if (match[1] !== undefined) {
      out.push(<strong key={start}>{match[1]}</strong>);
    } else {
      const href = match[3];
      // Only links within the site, or plain web addresses. Never a script.
      if (href.startsWith("/") && !href.startsWith("//")) {
        out.push(
          <Link key={start} href={href}>
            {match[2]}
          </Link>,
        );
      } else if (/^https:\/\//.test(href)) {
        out.push(
          <a key={start} href={href} rel="noopener noreferrer">
            {match[2]}
          </a>,
        );
      } else {
        out.push(match[2]);
      }
    }
    last = start + match[0].length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}
