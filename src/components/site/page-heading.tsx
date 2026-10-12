import type { ReactNode } from "react";

/** The dark band at the top of every page that is not the home page. */
export function PageHeading({
  label,
  title,
  summary,
  children,
}: {
  label: string;
  title: string;
  summary?: string;
  children?: ReactNode;
}) {
  return (
    <div className="contours bg-night-900 text-mist-50">
      <div className="wrap py-14 md:py-20">
        <p className="label text-ember-300">{label}</p>
        <h1 className="display mt-3 max-w-[18ch] text-5xl md:text-7xl">{title}</h1>
        {summary ? <p className="mt-5 max-w-2xl text-lg text-night-200 md:text-xl">{summary}</p> : null}
        {children}
      </div>
    </div>
  );
}
