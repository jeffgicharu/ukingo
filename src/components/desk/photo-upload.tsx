"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { copyHeight, UPLOAD } from "@/photos/picture";

// Makes a photograph ready in this browser before it is sent: turned the right
// way up, trimmed to the 4:3 frame the site shows it in, and saved at each
// width as a JPEG, and as a WebP where this browser can make one. Only those
// copies leave the device, so the original, and where it was taken, never do.
// The server checks and keeps them (see server/lodge/photo-files.ts).

/** Something about the photograph chosen, said to the person who chose it. */
class Refusal extends Error {}

const MOST_BYTES = 40 * 1024 * 1024;

function canvas(width: number, height: number) {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  const pen = element.getContext("2d");
  if (!pen) throw new Error("This browser cannot draw.");
  pen.imageSmoothingEnabled = true;
  pen.imageSmoothingQuality = "high";
  return { element, pen };
}

const saved = (element: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => element.toBlob(resolve, type, quality));

/** The photograph's average colour, shown on the site while it loads. */
function averageColour(element: HTMLCanvasElement): string {
  const small = canvas(16, 12);
  small.pen.drawImage(element, 0, 0, 16, 12);
  const pixels = small.pen.getImageData(0, 0, 16, 12).data;
  const sum = [0, 0, 0];
  for (let at = 0; at < pixels.length; at += 4) {
    sum[0] += pixels[at];
    sum[1] += pixels[at + 1];
    sum[2] += pixels[at + 2];
  }
  const count = pixels.length / 4;
  return `#${sum
    .map((total) =>
      Math.round(total / count)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

type Ready = { copies: { name: string; blob: Blob }[]; colour: string };

async function makeReady(file: File): Promise<Ready> {
  if (file.size > MOST_BYTES) throw new Refusal("That file is over 40 MB. Save a smaller copy of it and try again.");

  let picture: ImageBitmap;
  try {
    // The browser turns a photograph taken with the phone on its side the right way up.
    picture = await createImageBitmap(file);
  } catch {
    throw new Refusal("That file is not a photograph this browser can open. Choose a JPEG, PNG, WebP or HEIC.");
  }

  try {
    const { width, height } = picture;
    const shape = width / height;
    if (shape < UPLOAD.narrowest) {
      throw new Refusal(
        "That photograph is too tall for its frame. The site shows room photographs in landscape, so choose one clearly wider than it is tall.",
      );
    }
    if (shape > UPLOAD.widest) {
      throw new Refusal(
        "That photograph is too long and thin for its frame. Choose one no more than twice as wide as it is tall.",
      );
    }
    const keptWidth = shape > UPLOAD.frame ? Math.round(height * UPLOAD.frame) : width;
    const keptHeight = Math.round(keptWidth / UPLOAD.frame);
    if (keptWidth < UPLOAD.fewestPixelsWide) {
      throw new Refusal(
        `That photograph is ${keptWidth.toLocaleString("en-GB")} pixels wide${
          keptWidth < width ? " once trimmed to the site's 4:3 frame" : ""
        }. Choose one at least ${UPLOAD.fewestPixelsWide.toLocaleString("en-GB")} wide, or it will look soft on a laptop.`,
      );
    }

    // The middle of it, in the frame's shape.
    let source: CanvasImageSource = picture;
    let area = {
      x: Math.round((width - keptWidth) / 2),
      y: Math.round((height - keptHeight) / 2),
      width: keptWidth,
      height: keptHeight,
    };

    const copies: Ready["copies"] = [];
    let colour = "";
    const widths = UPLOAD.widths.filter((size) => size <= keptWidth).reverse();
    for (const size of widths) {
      // Halving step by step to near the size wanted keeps fine detail from turning to grit.
      while (area.width / 2 >= size) {
        const half = canvas(Math.round(area.width / 2), Math.round(area.height / 2));
        half.pen.drawImage(
          source,
          area.x,
          area.y,
          area.width,
          area.height,
          0,
          0,
          half.element.width,
          half.element.height,
        );
        source = half.element;
        area = { x: 0, y: 0, width: half.element.width, height: half.element.height };
      }
      const copy = canvas(size, copyHeight(size));
      copy.pen.drawImage(source, area.x, area.y, area.width, area.height, 0, 0, size, copyHeight(size));

      const jpeg = await saved(copy.element, "image/jpeg", 0.8);
      if (!jpeg) throw new Error("This browser could not save a JPEG.");
      copies.push({ name: `jpg-${size}`, blob: jpeg });
      // A browser that cannot save a WebP saves something else instead, and says so.
      const webp = await saved(copy.element, "image/webp", 0.75);
      if (webp?.type === "image/webp") copies.push({ name: `webp-${size}`, blob: webp });
      if (size === UPLOAD.widths[0]) colour = averageColour(copy.element);
    }

    // A WebP beside every JPEG, or beside none.
    const webps = copies.filter((copy) => copy.name.startsWith("webp-")).length;
    return {
      copies: webps === widths.length ? copies : copies.filter((copy) => copy.name.startsWith("jpg-")),
      colour,
    };
  } finally {
    picture.close();
  }
}

/**
 * The form for putting up a photograph. `children` are its other fields, as
 * the server renders them. Without scripts the form is sent as it is, and the
 * server says what is needed.
 */
export function PhotoUpload({
  action,
  className,
  buttonClassName,
  children,
}: {
  action: string;
  className: string;
  buttonClassName: string;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Coming back to this page from the browser's history shows the form ready again.
  useEffect(() => {
    const again = (event: PageTransitionEvent) => event.persisted && setBusy(null);
    window.addEventListener("pageshow", again);
    return () => window.removeEventListener("pageshow", again);
  }, []);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("photo");
    if (!(file instanceof File) || file.size === 0) {
      setProblem("Choose a photograph to put up.");
      return;
    }

    setProblem(null);
    setBusy("Preparing it…");
    try {
      const ready = await makeReady(file);
      data.delete("photo");
      for (const copy of ready.copies) {
        data.append(copy.name, copy.blob, `${copy.name}.${copy.name.startsWith("webp") ? "webp" : "jpg"}`);
      }
      data.set("colour", ready.colour);
      setBusy("Sending it…");
      // Not form.action: the form has a field of that name, which hides the address.
      const response = await fetch(action, { method: "POST", body: data });
      if (!response.ok) throw new Error(`The site answered ${response.status}.`);
      // The screen the form came from, with what happened written at the top.
      window.location.assign(response.url);
    } catch (error) {
      console.error(error);
      setBusy(null);
      setProblem(
        error instanceof Refusal
          ? error.message
          : "The photograph could not be made ready or sent. Check the connection and try again.",
      );
    }
  }

  return (
    <form action={action} method="post" encType="multipart/form-data" onSubmit={send} className={className}>
      {children}
      {problem ? (
        <p role="alert" className="rounded-lg border border-heath-600/30 bg-heath-100 px-3 py-2 text-sm text-heath-700">
          {problem}
        </p>
      ) : null}
      <noscript>
        <p className="text-sm text-heath-700">Putting up a photograph needs scripts switched on in this browser.</p>
      </noscript>
      <button
        type="submit"
        aria-disabled={busy ? true : undefined}
        className={`${buttonClassName} ${busy ? "cursor-progress opacity-70" : ""}`}
      >
        <span aria-live="polite">{busy ?? "Put it up"}</span>
      </button>
    </form>
  );
}
