import type { Metadata } from "next";
import { connection } from "next/server";

import { JsonLd } from "@/components/site/json-ld";
import { PageHeading } from "@/components/site/page-heading";
import { SiteHeader } from "@/components/site/site-header";
import { describePage } from "@/lib/metadata";
import { questions } from "@/server/lodge/content";
import { questionData, trail } from "@/server/lodge/structured-data";

export const metadata: Metadata = describePage({
  title: "Questions about booking and staying",
  description:
    "Deposits, M-Pesa, changing dates, cancelling, children, the cold, the road: answers to what guests ask before they stay at Ukingo.",
  path: "/questions",
  shareTitle: "Questions about staying at Ukingo",
});

export default async function QuestionsPage() {
  await connection();
  const all = await questions();
  const topics = [...new Set(all.map((entry) => entry.topic))];

  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <PageHeading label="Questions" title="Before you come" summary="What guests ask us most, answered plainly." />

        <div className="wrap py-16 md:py-24">
          <div className="space-y-16">
            {topics.map((topic) => (
              <section
                key={topic}
                aria-labelledby={`topic-${slugOf(topic)}`}
                className="grid gap-6 md:grid-cols-[1fr_2.4fr] md:gap-12"
              >
                <h2 id={`topic-${slugOf(topic)}`} className="display text-3xl md:text-4xl">
                  {topic}
                </h2>
                <div className="border-t border-rule">
                  {all
                    .filter((entry) => entry.topic === topic)
                    .map((entry) => (
                      <details key={entry.id} className="group border-b border-rule">
                        <summary className="flex cursor-pointer list-none items-start justify-between gap-6 py-5 text-lg font-medium [&::-webkit-details-marker]:hidden">
                          {entry.question}
                          <span
                            aria-hidden="true"
                            className="relative mt-1.5 size-4 shrink-0 before:absolute before:left-0 before:top-1/2 before:h-px before:w-full before:bg-ink after:absolute after:left-1/2 after:top-0 after:h-full after:w-px after:bg-ink after:transition-transform group-open:after:scale-y-0"
                          />
                        </summary>
                        <p className="max-w-2xl pb-6 text-ink-soft">{entry.answer}</p>
                      </details>
                    ))}
                </div>
              </section>
            ))}
          </div>

          <p className="mt-16 text-ink-soft">
            The full terms are on{" "}
            <a href="/booking-terms" className="link">
              Booking and cancellation
            </a>
            .
          </p>
        </div>
      </main>

      <JsonLd data={questionData(all)} />
      <JsonLd
        data={trail([
          { name: "Ukingo", path: "/" },
          { name: "Questions", path: "/questions" },
        ])}
      />
    </>
  );
}

function slugOf(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
