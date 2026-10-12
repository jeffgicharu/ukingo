"use client";

import { type CSSProperties, type PointerEvent, useRef, useState } from "react";

import { type Day, addDays, daysBetween, weekday } from "@/lib/dates";
import { formatDay, formatStay } from "@/lib/format";

import { BAR_LOOKS, type CalendarBar, type CalendarRow } from "./calendar-bars";

type MovePreview =
  | { ok: true; guest: string; was: string; becomes: string; price: string; money: string }
  | { ok: false; reason: string };

type Panel =
  | { kind: "move"; bar: CalendarBar; roomId: number; from: Day; to: Day; preview: MovePreview | null }
  | { kind: "new"; row: CalendarRow; from: Day; to: Day }
  | { kind: "block"; bar: CalendarBar; roomName: string };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Every room down the side, days across the top, and each stay a bar from the
 * afternoon of arrival to the morning of leaving. On a laptop a bar can be
 * dragged to another room or other dates. Nothing is saved by the drag itself:
 * the screen says what the move would do, and asks.
 */
export function CalendarGrid({
  days,
  today,
  rows,
  bars,
  canMake,
  canBlock,
  back,
}: {
  days: Day[];
  today: Day;
  rows: CalendarRow[];
  bars: CalendarBar[];
  canMake: boolean;
  canBlock: boolean;
  /** The calendar's own address, to come back to after a change. */
  back: string;
}) {
  const count = days.length;
  const first = days[0];
  const end = addDays(first, count);
  const tight = count > 16;

  const dialog = useRef<HTMLDialogElement>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [ghost, setGhost] = useState<{ bar: CalendarBar; shift: number; roomId: number } | null>(null);
  const drag = useRef<{ bar: CalendarBar; x: number; y: number; dayWidth: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);

  const open = (next: Panel) => {
    setPanel(next);
    dialog.current?.showModal();
  };
  const close = () => dialog.current?.close();

  /**
   * Where a stay sits among the half-day columns of the days shown. Over two
   * weeks a bar runs from the afternoon of arrival to the morning of leaving.
   * Over a month the days are too narrow for halves, so a bar covers the
   * nights slept and nothing more.
   */
  const half = tight ? 1 : 2;
  const place = (from: Day, to: Day): CSSProperties => ({
    gridColumn: `${Math.max(1, daysBetween(first, from) * 2 + half)} / ${Math.min(count * 2 + 1, daysBetween(first, to) * 2 + half)}`,
    gridRow: 1,
  });
  const shown = (from: Day, to: Day) => (tight ? to > first : to >= first) && from < end;

  const onPointerDown = (event: PointerEvent<HTMLElement>, bar: CalendarBar) => {
    if (bar.move === "none" || event.pointerType !== "mouse" || event.button !== 0) return;
    const track = event.currentTarget.parentElement;
    if (!track) return;
    drag.current = {
      bar,
      x: event.clientX,
      y: event.clientY,
      dayWidth: track.getBoundingClientRect().width / count,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.moved && Math.hypot(dx, dy) < 6) return;
    current.moved = true;

    const shift = current.bar.move === "room" ? 0 : Math.round(dx / current.dayWidth);
    const under = document
      .elementsFromPoint(event.clientX, event.clientY)
      .find((element): element is HTMLElement => element instanceof HTMLElement && "roomId" in element.dataset);
    const roomId = under ? Number(under.dataset.roomId) : current.bar.roomId;
    setGhost((was) =>
      was && was.shift === shift && was.roomId === roomId ? was : { bar: current.bar, shift, roomId },
    );
  };

  const onPointerUp = () => {
    const current = drag.current;
    drag.current = null;
    if (!current?.moved) return;
    // The click that ends a drag must not also open the booking.
    justDragged.current = true;
    window.setTimeout(() => (justDragged.current = false), 0);

    const dropped = ghost;
    setGhost(null);
    if (!dropped || (dropped.shift === 0 && dropped.roomId === current.bar.roomId)) return;

    const from = addDays(current.bar.from, dropped.shift);
    const to = addDays(current.bar.to, dropped.shift);
    open({ kind: "move", bar: current.bar, roomId: dropped.roomId, from, to, preview: null });

    const query = new URLSearchParams({
      booking: String(current.bar.bookingId),
      room: String(dropped.roomId),
      in: from,
      out: to,
    });
    fetch(`/desk/calendar/preview?${query}`, { cache: "no-store", headers: { Accept: "application/json" } })
      .then((response) => response.json() as Promise<MovePreview>)
      .catch((): MovePreview => ({ ok: false, reason: "The move could not be checked. Try again." }))
      .then((preview) =>
        setPanel((was) => (was?.kind === "move" && was.bar.key === current.bar.key ? { ...was, preview } : was)),
      );
  };

  const template = `repeat(${count * 2}, minmax(0, 1fr))`;
  const nameWidth = "8rem";
  // Wide enough that half a day, which is what shows beside a bar, is still easy to tap.
  const dayWidth = tight ? "1.85rem" : "3rem";

  return (
    <>
      <div className="overflow-x-auto overscroll-x-contain">
        <div style={{ minWidth: `calc(${nameWidth} + ${count} * ${dayWidth})` }}>
          {/* The days. */}
          <div className="grid border-b border-rule" style={{ gridTemplateColumns: `${nameWidth} 1fr` }}>
            <div className="sticky left-0 z-20 border-r border-rule bg-white" />
            <div className="grid" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
              {days.map((day, index) => {
                const isToday = day === today;
                const weekend = weekday(day) === 5 || weekday(day) === 6;
                const newMonth = index === 0 || day.endsWith("-01");
                return (
                  <div
                    key={day}
                    className={`border-l border-rule px-0.5 pt-1.5 pb-1 text-center first:border-l-0 ${weekend ? "bg-mist-100" : ""}`}
                  >
                    <p className="label h-3 text-[0.6rem] text-ember-800">
                      {newMonth ? formatDay(day, "compact").split(" ")[2] : ""}
                    </p>
                    <p className={`label text-[0.62rem] ${weekend ? "text-ink" : "text-ink-faint"}`}>
                      {tight ? WEEKDAYS[weekday(day)][0] : WEEKDAYS[weekday(day)]}
                    </p>
                    <p
                      className={`tabular mx-auto mt-0.5 flex size-6 items-center justify-center rounded-full text-sm ${
                        isToday ? "bg-ember-500 font-semibold text-night-950" : ""
                      }`}
                      aria-current={isToday ? "date" : undefined}
                    >
                      {Number(day.slice(8))}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* The rooms. */}
          {rows.map((row, index) => {
            const firstOfKind = index === 0 || rows[index - 1].typeName !== row.typeName;
            return (
              <div key={row.id}>
                {firstOfKind ? (
                  <div className="border-b border-rule bg-mist-50">
                    <p className="label sticky left-0 inline-block px-3 py-1.5 text-[0.65rem] text-ink-faint">
                      {row.typeName} · sleeps {row.sleeps}
                    </p>
                  </div>
                ) : null}
                <div className="grid border-b border-rule" style={{ gridTemplateColumns: `${nameWidth} 1fr` }}>
                  <p className="sticky left-0 z-20 flex items-center border-r border-rule bg-white px-3 text-sm font-semibold">
                    {row.name}
                  </p>
                  <div className="relative grid h-11" style={{ gridTemplateColumns: template }} data-room-id={row.id}>
                    {days.map((day, dayIndex) => {
                      // A night somebody has is not somewhere to start a booking. Only free nights can be tapped.
                      const free = !bars.some((bar) => bar.roomId === row.id && bar.from <= day && day < bar.to);
                      const weekend = weekday(day) === 5 || weekday(day) === 6;
                      const tone = `${dayIndex ? "border-l border-rule" : ""} ${weekend ? "bg-mist-100" : ""} ${day === today ? "bg-ember-100/60" : ""}`;
                      const cell = { gridColumn: `${dayIndex * 2 + 1} / span 2`, gridRow: 1 };
                      return free && (canMake || canBlock) ? (
                        <button
                          key={day}
                          type="button"
                          style={cell}
                          className={`${tone} hover:bg-ember-100 focus-visible:z-30`}
                          aria-label={`${row.name}, ${formatDay(day, "long")}: book or block`}
                          onClick={() => open({ kind: "new", row, from: day, to: addDays(day, 1) })}
                        />
                      ) : (
                        <span key={day} style={cell} className={tone} />
                      );
                    })}

                    {bars
                      .filter((bar) => bar.roomId === row.id && shown(bar.from, bar.to))
                      .map((bar) => {
                        const look = BAR_LOOKS[bar.state];
                        const lifted = ghost?.bar.key === bar.key;
                        const className = `z-10 my-1.5 flex min-w-0 items-center overflow-hidden px-2 text-xs font-semibold whitespace-nowrap select-none ${look.className} ${
                          bar.from < first ? "rounded-l-none" : "rounded-l-full"
                        } ${bar.to > end ? "rounded-r-none" : "rounded-r-full"} ${
                          bar.move === "none" ? "" : "cursor-grab active:cursor-grabbing"
                        } ${lifted ? "opacity-40" : ""}`;
                        const text = <span className="truncate">{bar.label}</span>;
                        return bar.bookingId === null ? (
                          <button
                            key={bar.key}
                            type="button"
                            style={place(bar.from, bar.to)}
                            className={className}
                            title={bar.detail}
                            onClick={() => open({ kind: "block", bar, roomName: row.name })}
                          >
                            {text}
                          </button>
                        ) : (
                          <a
                            key={bar.key}
                            href={`/desk/bookings/${bar.bookingId}`}
                            style={place(bar.from, bar.to)}
                            className={className}
                            title={bar.detail}
                            draggable={false}
                            onPointerDown={(event) => onPointerDown(event, bar)}
                            onPointerMove={onPointerMove}
                            onPointerUp={onPointerUp}
                            onPointerCancel={() => {
                              drag.current = null;
                              setGhost(null);
                            }}
                            onClick={(event) => {
                              if (justDragged.current) event.preventDefault();
                            }}
                          >
                            {text}
                            <span className="sr-only">. {bar.detail}</span>
                          </a>
                        );
                      })}

                    {/* Where a bar being dragged would land. */}
                    {ghost && ghost.roomId === row.id ? (
                      <span
                        style={place(addDays(ghost.bar.from, ghost.shift), addDays(ghost.bar.to, ghost.shift))}
                        className="pointer-events-none z-30 my-1 rounded-full border-2 border-dashed border-ember-600 bg-ember-100/70"
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <dialog
        ref={dialog}
        onClose={() => setPanel(null)}
        className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-2xl bg-white p-0 text-ink shadow-lift backdrop:bg-night-950/55"
      >
        {panel?.kind === "move" ? (
          <MovePanel panel={panel} back={back} onLeave={close} />
        ) : panel?.kind === "new" ? (
          <NewPanel
            key={`${panel.row.id}-${panel.from}`}
            panel={panel}
            back={back}
            canMake={canMake}
            canBlock={canBlock}
            onLeave={close}
          />
        ) : panel?.kind === "block" ? (
          <BlockPanel panel={panel} back={back} canBlock={canBlock} onLeave={close} />
        ) : null}
      </dialog>
    </>
  );
}

const quiet = "button button-line min-h-10 px-4 py-2 text-sm";
const strong = "button button-night min-h-10 px-4 py-2 text-sm";

function MovePanel({
  panel,
  back,
  onLeave,
}: {
  panel: Extract<Panel, { kind: "move" }>;
  back: string;
  onLeave: () => void;
}) {
  const { preview } = panel;
  return (
    <div className="p-5 sm:p-6">
      <h2 className="display text-3xl">
        {preview === null ? "Checking the move" : preview.ok ? "Move this booking?" : "That move cannot be made"}
      </h2>
      {preview === null ? (
        <p className="mt-3 text-ink-soft" role="status">
          Checking those nights and the price…
        </p>
      ) : preview.ok ? (
        <>
          <dl className="mt-4 space-y-3 text-[0.95rem]">
            <div>
              <dt className="label text-ink-faint">{preview.guest} has</dt>
              <dd className="mt-0.5">{preview.was}</dd>
            </div>
            <div>
              <dt className="label text-ink-faint">Would have</dt>
              <dd className="mt-0.5 font-semibold">{preview.becomes}</dd>
            </div>
          </dl>
          <p className="mt-4 rounded-xl bg-moss-100 px-4 py-3 text-[0.95rem] text-moss-700">
            Those nights are free. {preview.price} {preview.money}
          </p>
          <form action="/desk/calendar/act" method="post" className="mt-5 flex flex-wrap justify-end gap-2">
            <input type="hidden" name="action" value="move" />
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="booking" value={panel.bar.bookingId ?? ""} />
            <input type="hidden" name="room" value={panel.roomId} />
            <input type="hidden" name="in" value={panel.from} />
            <input type="hidden" name="out" value={panel.to} />
            <button type="button" className={quiet} onClick={onLeave}>
              Leave it where it is
            </button>
            <button type="submit" className={strong}>
              Move the booking
            </button>
          </form>
        </>
      ) : (
        <>
          <p role="alert" className="mt-4 rounded-xl bg-heath-100 px-4 py-3 text-[0.95rem] text-heath-700">
            {preview.reason}
          </p>
          <p className="mt-3 text-sm text-ink-faint">Nothing has been changed.</p>
          <div className="mt-5 flex justify-end">
            <button type="button" className={strong} onClick={onLeave}>
              Close
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function NewPanel({
  panel,
  back,
  canMake,
  canBlock,
  onLeave,
}: {
  panel: Extract<Panel, { kind: "new" }>;
  back: string;
  canMake: boolean;
  canBlock: boolean;
  onLeave: () => void;
}) {
  const [from, setFrom] = useState(panel.from);
  const [to, setTo] = useState(panel.to);
  const sound = from < to;
  const field = "field min-h-10 py-2";

  return (
    <div className="p-5 sm:p-6">
      <h2 className="display text-3xl">{panel.row.name}</h2>
      <p className="mt-1 text-ink-soft">
        {panel.row.typeName} · sleeps {panel.row.sleeps}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="max-[379px]:col-span-2">
          <label htmlFor="calendar-from" className="field-label">
            From
          </label>
          <input
            id="calendar-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className={`${field} tabular`}
          />
        </div>
        <div className="max-[379px]:col-span-2">
          <label htmlFor="calendar-to" className="field-label">
            Until the morning of
          </label>
          <input
            id="calendar-to"
            type="date"
            value={to}
            min={addDays(from, 1)}
            onChange={(event) => setTo(event.target.value)}
            className={`${field} tabular`}
          />
        </div>
      </div>
      {sound ? null : <p className="field-error">The second date must be after the first.</p>}

      {canMake ? (
        <div className="mt-5 border-t border-rule pt-4">
          <a
            href={sound ? `/desk/bookings/new?in=${from}&out=${to}&room=${panel.row.id}` : undefined}
            aria-disabled={!sound}
            className={`button button-ember min-h-10 w-full px-4 py-2 text-sm ${sound ? "" : "pointer-events-none opacity-50"}`}
          >
            New booking in {panel.row.name}
          </a>
        </div>
      ) : null}

      {canBlock ? (
        <form action="/desk/calendar/act" method="post" className="mt-4 border-t border-rule pt-4">
          <input type="hidden" name="action" value="block" />
          <input type="hidden" name="back" value={back} />
          <input type="hidden" name="room" value={panel.row.id} />
          <input type="hidden" name="in" value={from} />
          <input type="hidden" name="out" value={to} />
          <label htmlFor="calendar-reason" className="field-label">
            Or take it off sale: why?
          </label>
          <div className="flex gap-2">
            <input
              id="calendar-reason"
              name="reason"
              required
              maxLength={200}
              placeholder="Repairs to the roof"
              className={field}
            />
            <button type="submit" disabled={!sound} className={`${quiet} shrink-0 disabled:opacity-50`}>
              Block
            </button>
          </div>
        </form>
      ) : null}

      <div className="mt-5 flex justify-end">
        <button type="button" className={quiet} onClick={onLeave}>
          Close
        </button>
      </div>
    </div>
  );
}

function BlockPanel({
  panel,
  back,
  canBlock,
  onLeave,
}: {
  panel: Extract<Panel, { kind: "block" }>;
  back: string;
  canBlock: boolean;
  onLeave: () => void;
}) {
  return (
    <div className="p-5 sm:p-6">
      <h2 className="display text-3xl">{panel.roomName} is off sale</h2>
      <p className="mt-2 text-ink-soft">
        {formatStay({ from: panel.bar.from, to: panel.bar.to })}. {panel.bar.label}.
      </p>
      <form action="/desk/calendar/act" method="post" className="mt-5 flex flex-wrap justify-end gap-2">
        <input type="hidden" name="action" value="unblock" />
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="allocation" value={panel.bar.allocationId} />
        <button type="button" className={quiet} onClick={onLeave}>
          Close
        </button>
        {canBlock ? (
          <button type="submit" className={strong}>
            Put it back on sale
          </button>
        ) : null}
      </form>
    </div>
  );
}
