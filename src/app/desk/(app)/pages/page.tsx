import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { connection } from "next/server";

import { Chip } from "@/components/desk/chips";
import { DeskPage, Panel, Tabs } from "@/components/desk/page";
import { formatMoment, plural } from "@/lib/format";
import { db, schema } from "@/server/db";
import { may } from "@/server/staff/permissions";
import { requireStaff } from "@/server/staff/sessions";

export const metadata: Metadata = { title: "Pages" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
const TABS = { words: "Home page", pages: "Pages", questions: "Questions" };
type Tab = keyof typeof TABS;

const field = "field min-h-10 py-2";
const smallButton = "button min-h-10 px-4 py-2 text-sm";

/** One button that makes one change and comes back to the same screen. */
function Step({ action, back, label, slug }: { action: string; back: string; label: string; slug?: string }) {
  return (
    <form action="/desk/setup/act" method="post">
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="back" value={back} />
      {slug ? <input type="hidden" name="slug" value={slug} /> : null}
      <button type="submit" className={`${smallButton} ${action.endsWith("publish") ? "button-ember" : "button-line"}`}>
        {label}
      </button>
    </form>
  );
}

export default async function PagesPage({ searchParams }: PageProps<"/desk/pages">) {
  await connection();
  const staff = await requireStaff("content.edit");
  const query = await searchParams;
  const tab: Tab = one(query.tab) in TABS ? (one(query.tab) as Tab) : "words";
  const canEdit = may(staff, "content.edit");

  const texts = await db().select().from(schema.siteText).orderBy(asc(schema.siteText.position));
  const pages = await db().select().from(schema.pages).orderBy(asc(schema.pages.position));
  const questions = await db()
    .select()
    .from(schema.questions)
    .orderBy(asc(schema.questions.position), asc(schema.questions.id));

  const drafted = texts.filter((text) => text.draft !== null).length;
  const chosen = pages.find((page) => page.slug === one(query.page)) ?? pages[0];
  const pageBack = `/desk/pages?tab=pages&page=${chosen?.slug ?? ""}`;
  const pageDrafted = chosen ? chosen.draftBody !== null : false;
  const topics = [...new Set(questions.map((question) => question.topic))];
  const kept = questions.filter((question) => !question.shown).length;

  return (
    <DeskPage
      title="Pages"
      summary={
        canEdit
          ? "The words on the site. Save a draft, look at it as a guest would, then publish."
          : "The words on the site. Training accounts can look, and cannot change them."
      }
      query={query}
      wide
    >
      <Tabs
        label="Show"
        items={(Object.keys(TABS) as Tab[]).map((key) => ({
          href: key === "words" ? "/desk/pages" : `/desk/pages?tab=${key}`,
          label: TABS[key],
          current: tab === key,
          count: key === "words" ? drafted : key === "pages" ? pages.filter((page) => page.draftBody).length : kept,
        }))}
      />

      <fieldset disabled={!canEdit} className="mt-4 min-w-0 space-y-4">
        {tab === "words" ? (
          <>
            {drafted ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ember-600/40 bg-ember-100 px-4 py-3 sm:px-5">
                <p className="text-night-950">
                  A draft is waiting: {plural(drafted, "piece")} of text {drafted === 1 ? "differs" : "differ"} from
                  what guests see.
                </p>
                <div className="flex flex-wrap gap-2">
                  <a href="/?preview=1" target="_blank" className={`${smallButton} button-line border-night-900/30`}>
                    Preview the home page
                  </a>
                  {canEdit ? (
                    <>
                      <Step action="words-publish" back="/desk/pages" label="Publish" />
                      <Step action="words-discard" back="/desk/pages" label="Throw the draft away" />
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}

            <Panel title="The words on the home page">
              <form action="/desk/setup/act" method="post">
                <input type="hidden" name="action" value="words-draft" />
                <input type="hidden" name="back" value="/desk/pages" />
                <ul className="divide-y divide-rule">
                  {texts.map((text) => (
                    <li key={text.key} className="px-4 py-4 sm:px-5">
                      <label className="block">
                        <span className="field-label flex flex-wrap items-center gap-2">
                          {text.label}
                          {text.draft !== null ? <Chip label="Draft" tone="wait" /> : null}
                        </span>
                        {(text.draft ?? text.value).length > 70 ? (
                          <textarea
                            name={`text-${text.key}`}
                            required
                            rows={3}
                            maxLength={1200}
                            defaultValue={text.draft ?? text.value}
                            className="field"
                          />
                        ) : (
                          <input
                            name={`text-${text.key}`}
                            required
                            maxLength={1200}
                            defaultValue={text.draft ?? text.value}
                            className={field}
                          />
                        )}
                      </label>
                      {text.draft !== null ? (
                        <p className="mt-1.5 text-sm text-ink-faint">Guests see: “{text.value}”</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {canEdit ? (
                  <div className="flex flex-wrap items-center gap-3 border-t border-rule px-4 py-3 sm:px-5">
                    <button type="submit" className={`${smallButton} button-night`}>
                      Save as a draft
                    </button>
                    <p className="text-sm text-ink-faint">Guests see nothing new until you publish.</p>
                  </div>
                ) : null}
              </form>
            </Panel>
          </>
        ) : null}

        {tab === "pages" && chosen ? (
          <div className="grid gap-4 lg:grid-cols-[16rem_1fr] lg:items-start">
            <Panel title="Pages">
              <ul className="divide-y divide-rule">
                {pages.map((page) => (
                  <li key={page.slug}>
                    <a
                      href={`/desk/pages?tab=pages&page=${page.slug}`}
                      aria-current={page.slug === chosen.slug ? "page" : undefined}
                      className={`flex items-center justify-between gap-2 px-4 py-2.5 sm:px-5 ${
                        page.slug === chosen.slug ? "bg-mist-100 font-semibold" : "hover:bg-mist-50"
                      }`}
                    >
                      {page.title}
                      {page.draftBody !== null ? <Chip label="Draft" tone="wait" /> : null}
                    </a>
                  </li>
                ))}
              </ul>
            </Panel>

            <div className="min-w-0 space-y-4">
              {pageDrafted ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ember-600/40 bg-ember-100 px-4 py-3 sm:px-5">
                  <p className="text-night-950">A draft of this page is waiting. Guests still see the published one.</p>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={`/${chosen.slug}?preview=1`}
                      target="_blank"
                      className={`${smallButton} button-line border-night-900/30`}
                    >
                      Preview it
                    </a>
                    {canEdit ? (
                      <>
                        <Step action="page-publish" back={pageBack} label="Publish" slug={chosen.slug} />
                        <Step action="page-discard" back={pageBack} label="Throw the draft away" slug={chosen.slug} />
                      </>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <Panel
                title={chosen.title}
                action={
                  <a href={`/${chosen.slug}`} target="_blank" className="link text-sm">
                    See it on the site
                  </a>
                }
              >
                <form action="/desk/setup/act" method="post" className="space-y-3 px-4 py-4 sm:px-5">
                  <input type="hidden" name="action" value="page-draft" />
                  <input type="hidden" name="back" value={pageBack} />
                  <input type="hidden" name="slug" value={chosen.slug} />
                  <label className="block">
                    <span className="field-label">Title</span>
                    <input
                      name="title"
                      required
                      maxLength={80}
                      defaultValue={chosen.draftTitle ?? chosen.title}
                      className={field}
                    />
                  </label>
                  <label className="block">
                    <span className="field-label">The line under the title</span>
                    <textarea
                      name="summary"
                      rows={2}
                      maxLength={300}
                      defaultValue={chosen.draftSummary ?? chosen.summary}
                      className="field"
                    />
                  </label>
                  <label className="block">
                    <span className="field-label">The page</span>
                    <textarea
                      name="body"
                      required
                      rows={22}
                      maxLength={20000}
                      defaultValue={chosen.draftBody ?? chosen.body}
                      className="field font-mono text-[0.9rem] leading-relaxed"
                    />
                  </label>
                  <p className="text-sm text-ink-faint">
                    Leave an empty line between paragraphs. Start a line with <code>## </code> for a heading,{" "}
                    <code>### </code> for a smaller one, or <code>- </code> for a list. Put <code>**two stars**</code>{" "}
                    around bold words, and write a link as <code>[the words](/the-address)</code>.
                  </p>
                  {canEdit ? (
                    <button type="submit" className={`${smallButton} button-night`}>
                      Save as a draft
                    </button>
                  ) : null}
                </form>
                <p className="border-t border-rule px-4 py-3 text-sm text-ink-faint sm:px-5">
                  Last changed {formatMoment(chosen.updatedAt)}.
                </p>
              </Panel>
            </div>
          </div>
        ) : null}

        {tab === "questions" ? (
          <>
            {/* The topics already in use, offered as each topic is typed. */}
            <datalist id="question-topics">
              {topics.map((topic) => (
                <option key={topic} value={topic} />
              ))}
            </datalist>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-ink-soft">
                {plural(questions.length, "question")}
                {kept ? `, ${kept} kept back from guests` : ""}. To try new wording first, untick “Shown to guests”,
                save, and preview.
              </p>
              <a href="/questions?preview=1" target="_blank" className={`${smallButton} button-line`}>
                Preview the questions page
              </a>
            </div>

            {topics.map((topic) => (
              <Panel key={topic} title={topic}>
                <ul className="divide-y divide-rule">
                  {questions
                    .filter((question) => question.topic === topic)
                    .map((question) => (
                      <li key={question.id}>
                        <details>
                          <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
                            <span className={question.shown ? "" : "text-ink-faint"}>{question.question}</span>
                            <span className="flex items-center gap-3">
                              {question.shown ? null : <Chip label="Kept back" tone="wait" />}
                              <span className="link text-sm">{canEdit ? "Edit" : "Read"}</span>
                            </span>
                          </summary>
                          <div className="space-y-3 px-4 pb-4 sm:px-5">
                            <form action="/desk/setup/act" method="post" className="space-y-3">
                              <input type="hidden" name="action" value="question-save" />
                              <input type="hidden" name="back" value="/desk/pages?tab=questions" />
                              <input type="hidden" name="id" value={question.id} />
                              <QuestionFields question={question} />
                              {canEdit ? (
                                <button type="submit" className={`${smallButton} button-night`}>
                                  Save
                                </button>
                              ) : null}
                            </form>
                            {canEdit ? (
                              <form action="/desk/setup/act" method="post">
                                <input type="hidden" name="action" value="question-remove" />
                                <input type="hidden" name="back" value="/desk/pages?tab=questions" />
                                <input type="hidden" name="id" value={question.id} />
                                <button type="submit" className="link text-sm text-heath-700">
                                  Remove this question
                                </button>
                              </form>
                            ) : null}
                          </div>
                        </details>
                      </li>
                    ))}
                </ul>
              </Panel>
            ))}

            {canEdit ? (
              <Panel title="Add a question">
                <form action="/desk/setup/act" method="post" className="space-y-3 px-4 py-4 sm:px-5">
                  <input type="hidden" name="action" value="question-add" />
                  <input type="hidden" name="back" value="/desk/pages?tab=questions" />
                  <QuestionFields />
                  <button type="submit" className={`${smallButton} button-night`}>
                    Add the question
                  </button>
                </form>
              </Panel>
            ) : null}
          </>
        ) : null}
      </fieldset>
    </DeskPage>
  );
}

function QuestionFields({
  question,
}: {
  question?: { topic: string; question: string; answer: string; shown: boolean };
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
        <label className="block">
          <span className="field-label">Topic</span>
          <input
            name="topic"
            required
            maxLength={40}
            list="question-topics"
            defaultValue={question?.topic ?? ""}
            className={field}
          />
        </label>
        <label className="block">
          <span className="field-label">The question</span>
          <input name="question" required maxLength={200} defaultValue={question?.question ?? ""} className={field} />
        </label>
      </div>
      <label className="block">
        <span className="field-label">The answer</span>
        <textarea
          name="answer"
          required
          rows={4}
          maxLength={1500}
          defaultValue={question?.answer ?? ""}
          className="field"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="shown"
          defaultChecked={question?.shown ?? false}
          className="size-5 accent-night-900"
        />
        Shown to guests
      </label>
    </>
  );
}
