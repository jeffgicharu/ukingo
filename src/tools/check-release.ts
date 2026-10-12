// Opens the pages a visitor can reach and fails loudly if any is broken.
//
// The release pipeline runs this against a new release while the site is
// still on the old one. A release that fails here is never put live.
//
//   node check-release.mjs --base http://127.0.0.1:8201 --release <commit>

type Failure = { path: string; reason: string };

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const base = (option("base") ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const release = option("release");
// The site answers under its public name. Asking a local port directly, the
// name is sent along so that links and redirects come out as visitors see them.
const host = option("host");

const failures: Failure[] = [];
let checked = 0;

async function get(path: string): Promise<Response | null> {
  try {
    return await fetch(`${base}${path}`, {
      redirect: "manual",
      headers: {
        "User-Agent": "ukingo-release-check",
        ...(host ? { "X-Forwarded-Host": host, "X-Forwarded-Proto": "https" } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    failures.push({ path, reason: `no answer: ${(error as Error).message}` });
    return null;
  }
}

/** A page a visitor reads: it must arrive whole, with a title, and not be an error page. */
async function page(path: string, expectations: { status?: number; contains?: string[] } = {}): Promise<string> {
  checked++;
  const response = await get(path);
  if (!response) return "";

  const expected = expectations.status ?? 200;
  const body = await response.text();

  if (response.status !== expected) {
    failures.push({ path, reason: `answered ${response.status}, expected ${expected}` });
    return body;
  }
  if (!body.includes("</html>")) {
    failures.push({ path, reason: "the page did not arrive whole" });
  }
  if (!/<title>[^<]+<\/title>/.test(body)) {
    failures.push({ path, reason: "the page has no title" });
  }
  if (expected === 200 && /That did not work\. It is us, not you\./.test(body)) {
    failures.push({ path, reason: "the page shows the error screen" });
  }
  for (const text of expectations.contains ?? []) {
    if (!body.includes(text)) {
      failures.push({ path, reason: `the page does not say "${text}"` });
    }
  }
  return body;
}

/** A file: it must exist and be of the expected kind. */
async function file(path: string, type: RegExp): Promise<void> {
  checked++;
  const response = await get(path);
  if (!response) return;
  await response.arrayBuffer();

  if (response.status !== 200) {
    failures.push({ path, reason: `answered ${response.status}` });
  } else if (!type.test(response.headers.get("content-type") ?? "")) {
    failures.push({ path, reason: `is ${response.headers.get("content-type")}, expected ${type}` });
  }
}

function day(offset: number): string {
  // Three hours ahead of UTC: the lodge's date, whatever this machine's clock is set to.
  return new Date(Date.now() + 3 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  // The application is up, reaches its database, and is the release we expect.
  checked++;
  const up = await get("/up");
  if (up) {
    if (up.status !== 200) {
      failures.push({ path: "/up", reason: `answered ${up.status}: ${(await up.text()).trim()}` });
    } else if (release && up.headers.get("x-release") !== release) {
      failures.push({ path: "/up", reason: `is release ${up.headers.get("x-release")}, expected ${release}` });
    }
  }
  if (failures.length) return;

  // The home page twice: the second visit reads back anything the first one kept.
  const home = await page("/", { contains: ["Ukingo", "See what is free"] });
  await page("/", { contains: ["Ukingo"] });

  const rooms = await page("/rooms", { contains: ["Rooms"] });
  const roomPaths = [...new Set([...rooms.matchAll(/href="(\/rooms\/[a-z0-9-]+)"/g)].map((match) => match[1]))];
  if (roomPaths.length === 0) {
    failures.push({ path: "/rooms", reason: "lists no rooms" });
  }
  for (const path of roomPaths) {
    await page(path, { contains: ["A night costs"] });
  }

  await page("/experiences");
  await page("/questions");
  for (const path of ["/about", "/getting-here", "/booking-terms", "/privacy", "/terms"]) {
    await page(path);
  }

  // Availability and prices, for a stay three weeks from now.
  await page("/stay", { contains: ["When would you like to come?"] });
  // These must pass whether or not any room happens to be free on those nights.
  await page(`/stay?in=${day(21)}&out=${day(23)}&adults=2&children=0`, { contains: ["What is free"] });
  if (roomPaths[0]) {
    const room = roomPaths[0].split("/").pop();
    await page(`/book?room=${room}&in=${day(21)}&out=${day(23)}&adults=2&children=0`, { contains: ["Book "] });
  }
  await page("/book", { contains: ["Let us start again"] });
  await page("/find-booking", { contains: ["Find my booking"] });
  // A private link that names no booking gets "not found", like any other missing page.
  await page("/b/UKG-222222.AAAAAAAAAAAAAAAAAAAAAA", { status: 404 });
  await page(`/stay?in=${day(-3)}&out=${day(-1)}&adults=2`, { contains: ["Those dates cannot be booked"] });

  // An address with nothing at it gets the site's own "not found" page.
  await page("/nothing-is-here", { status: 404, contains: ["You have walked off the path."] });

  await file("/sitemap.xml", /xml/);
  await file("/robots.txt", /text\/plain/);
  await file("/manifest.webmanifest", /json/);
  await file("/favicon.ico", /image/);
  await file("/icon.svg", /svg/);
  await file("/share.jpg", /image\/jpeg/);

  // The stylesheet and scripts the home page asks for must be part of the release.
  const assets = [
    ...new Set(
      [...home.matchAll(/(?:href|src)="(\/_next\/static\/[^"]+)"/g)].map((match) => match[1].replace(/&amp;/g, "&")),
    ),
  ];
  if (!assets.some((asset) => asset.includes(".css"))) {
    failures.push({ path: "/", reason: "the home page links no stylesheet" });
  }
  for (const asset of assets.slice(0, 8)) {
    await file(asset, /css|javascript|font|woff/);
  }
}

main()
  .then(() => {
    if (failures.length) {
      console.error(`The release check failed (${failures.length} of ${checked}):`);
      for (const failure of failures) {
        console.error(`  ${failure.path}: ${failure.reason}`);
      }
      process.exit(1);
    }
    console.log(`The release check passed: ${checked} pages and files opened.`);
  })
  .catch((error) => {
    console.error("The release check could not run:", error);
    process.exit(1);
  });

export {};
