#!/usr/bin/env bash
#
# Backs up Ukingo's database, and proves the backup can be restored.
#
# Run every night by ukingo-backup.timer, as root. It writes one dump, restores
# that dump into a scratch database, checks the scratch database is the real
# thing, and throws the scratch database away. A backup that has never been
# restored is a hope, not a backup. Older dumps are then removed.
#
#   ukingo-backup          tonight's backup and its restore check
#
# To bring a dump back for real, as postgres:
#   createdb ukingo_restored
#   pg_restore --no-owner --exit-on-error --dbname=ukingo_restored < ukingo-YYYYMMDD-HHMM.dump

set -euo pipefail

BASE=/var/www/ukingo.jeffgicharu.com
DIR=$BASE/shared/backups
DB=ukingo
SCRATCH=ukingo_restore_check
KEEP=14

as_postgres() { runuser -u postgres -- "$@"; }
ask() { as_postgres psql --no-psqlrc --tuples-only --no-align --quiet --dbname="$1" --command="$2"; }

stamp=$(date -u +%Y%m%d-%H%M)
file="$DIR/$DB-$stamp.dump"
umask 077

fail() {
    printf 'failed %s %s\n' "$stamp" "$1" > "$DIR/last-check.txt"
    chown ukingo:ukingo "$DIR/last-check.txt"
    echo "Backup failed: $1" >&2
    exit 1
}

as_postgres pg_dump --format=custom --no-owner "$DB" > "$file.part" || fail "the database could not be dumped"
mv "$file.part" "$file"
chown ukingo:ukingo "$file"

# Restore it somewhere that is not the site.
as_postgres dropdb --if-exists "$SCRATCH"
as_postgres createdb "$SCRATCH"
trap 'runuser -u postgres -- dropdb --if-exists "$SCRATCH"' EXIT
as_postgres pg_restore --no-owner --exit-on-error --dbname="$SCRATCH" < "$file" || fail "the dump would not restore"

# The restored copy must have every migration the site has, the lodge's
# rooms, and the rule that stops two stays sharing a room.
want=$(ask "$DB" "SELECT count(*) FROM schema_migrations")
got=$(ask "$SCRATCH" "SELECT count(*) FROM schema_migrations")
rooms=$(ask "$SCRATCH" "SELECT count(*) FROM rooms")
guard=$(ask "$SCRATCH" "SELECT count(*) FROM pg_constraint WHERE conname = 'one_stay_per_room_per_night'")
bookings=$(ask "$SCRATCH" "SELECT count(*) FROM bookings")

[[ "$got" == "$want" ]] || fail "the restored copy has $got migrations and the site has $want"
[[ "$rooms" -ge 1 ]] || fail "the restored copy has no rooms"
[[ "$guard" == "1" ]] || fail "the restored copy has lost the rule against double booking"

size=$(stat --format=%s "$file")
printf 'ok %s bookings=%s bytes=%s\n' "$stamp" "$bookings" "$size" > "$DIR/last-check.txt"
chown ukingo:ukingo "$DIR/last-check.txt"

# Keep a fortnight.
find "$DIR" -maxdepth 1 -name "$DB-*.dump" -printf '%T@ %p\n' | sort -rn | tail -n +$((KEEP + 1)) | cut -d' ' -f2- | xargs -r rm -f --

echo "Backed up and restored: $file, $bookings bookings, $size bytes."
