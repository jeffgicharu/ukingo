# Ukingo

The website and front desk of Ukingo, a twelve-room lodge on the edge of the Mount Kenya forest near Nanyuki. Guests check dates, book a room and pay by M-Pesa. Staff run arrivals, the calendar, bookings and rates from the back office at `/desk`.

Live at https://ukingo.jeffgicharu.com.

## How it is built

One Next.js application (TypeScript, React) serves the guest pages and the back office. A second small process runs the work that has to happen on time. Both talk to one PostgreSQL database.

| Part                     | Where                                                            |
| ------------------------ | ---------------------------------------------------------------- |
| Pages and routes         | `src/app`                                                        |
| Booking rules and prices | `src/server/booking`                                             |
| The lodge's catalogue    | `src/server/lodge`                                               |
| Database tables          | `migrations`, described for queries in `src/server/db/schema.ts` |
| Background jobs          | `src/jobs`                                                       |
| Command-line tools       | `src/tools`                                                      |
| Server setup and release | `deploy`, `.github/workflows`                                    |

Three ideas run through the code:

- **A room is never sold twice, and the database is what guarantees it.** Every stay and every block is a row in `allocations` holding a room and a range of dates. One exclusion constraint forbids two rows for the same room from sharing a night. A guest leaving on the morning another arrives is not a clash.
- **The lodge has one clock.** Dates are calendar dates in East Africa Time, held as `2026-11-13` and never as a moment. Code takes the time from `src/server/clock.ts`, so every rule can be tested at the exact moment that matters.
- **Money is whole cents.** A booking keeps its own copy of each night's price and of the terms it was made under. What a guest owes is always the total less the payments recorded.

## Running it

You need Node 22.12 or newer (the server runs the version in `.node-version`), pnpm, and PostgreSQL 16 or newer with the `btree_gist` extension available.

```sh
pnpm install
cp .env.example .env.local     # then fill in the database addresses and a secret
pnpm db:migrate                # create the tables
pnpm db:seed                   # add the rooms, prices, rules and pages
pnpm dev
```

The site is then at http://127.0.0.1:3000.

`pnpm db:seed` only adds what is missing, so it is safe to run again. `pnpm db:seed --refresh` writes the setup in `src/server/setup/lodge.ts` over what is in the database.

## Tests

```sh
pnpm test
```

The tests run against a real PostgreSQL database named in `DATABASE_URL_TEST`. They empty it and rebuild it from the migrations each time, so it must be a database kept for tests. Its name has to contain `test`, and the tests refuse to run otherwise.

`pnpm lint`, `pnpm typecheck` and `pnpm format:check` cover the rest. All four run before every release.

## Changing the database

Add a new numbered file to `migrations`. Each file runs once, in order, inside a transaction. A file that has already run must never be edited: the migrator compares checksums and stops if one has changed.

A release migrates the database while the previous release is still serving visitors. A migration therefore has to work with the code before it as well as the code after it: add first, remove in a later release.

## Releases

Pushing to `main` releases the site.

1. GitHub Actions runs the linter, the type check and the tests, then builds the site and its tools into one folder.
2. The folder is uploaded to the server with a key that can do nothing but write into the releases directory.
3. A second key can run one script, `deploy/activate.sh`. It migrates the database and starts the new release in the idle one of two slots, beside the live one.
4. The new release opens its own pages (`src/tools/check-release.ts`). If any fails, the release stops there and visitors never see it.
5. nginx is pointed at the new slot, and the pages are fetched again through nginx. If they do not load, nginx is pointed back at the slot it came from, which has been running all along.
6. The old slot is stopped, and the background jobs restart on the new release.

Scripts and styles from the last five releases stay on the server, so a browser holding a page from the release before can still load what that page needs.

`deploy/provision.sh` sets a server up from nothing: the application's user, its own copy of Node, the database, the two slots, the jobs service and the nginx site. `deploy/activate.sh` is installed by it as a root-owned copy, so a change to that script takes effect only when provisioning is run again.

An hourly workflow opens the main pages from outside and fails if any does not load.
