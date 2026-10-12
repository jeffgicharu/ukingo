#!/usr/bin/env bash
#
# Puts an uploaded release live. Installed as /usr/local/bin/ukingo-activate.
#
# The deploy pipeline reaches this through an SSH key whose only permitted
# command is this script, so the one thing it can ask for is "activate the
# release with this commit id".
#
# The site runs in one of two slots, on ports 8200 and 8201, and nginx sends
# visitors to one of them. A new release is started in the idle slot, beside
# the live one, and has to open its own pages there before anything changes
# for visitors. Only then is nginx pointed at it. The pages are fetched once
# more through nginx, and if they do not load, nginx is pointed back at the
# slot it came from, which has been running all along.
#
# To go back by hand, run this script with the commit id of an earlier
# release that is still in the releases directory.

set -euo pipefail

BASE=/var/www/ukingo.jeffgicharu.com
HOST=ukingo.jeffgicharu.com
APP_USER=ukingo
NODE=$BASE/runtime/node/bin/node
ENV_FILE=$BASE/shared/env
UPSTREAM=/etc/nginx/ukingo/upstream.conf
KEEP_RELEASES=5

release_id="${SSH_ORIGINAL_COMMAND:-${1:-}}"

if [[ ! "$release_id" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Expected a 40 character commit id." >&2
    exit 64
fi

release="$BASE/releases/$release_id"

if [[ ! -f "$release/server.js" || ! -f "$release/tools/migrate.mjs" ]]; then
    echo "Release $release_id has not been uploaded." >&2
    exit 66
fi

# One deploy at a time.
exec 9>"$BASE/.activate.lock"
flock -n 9 || { echo "Another activation is running." >&2; exit 75; }

# Runs one of the release's own tools as the application user, with the
# site's settings. The settings file is read by node, never by a shell.
tool() {
    local name="$1"; shift
    ( cd "$release" && sudo -u "$APP_USER" -- "$NODE" --env-file="$ENV_FILE" "tools/$name.mjs" "$@" )
}

# nginx is shared by every site on this server. If its configuration is
# already broken by something else, nothing here should touch it.
if ! sudo nginx -t >/dev/null 2>&1; then
    echo "nginx's configuration does not pass its own test before this release changed anything." >&2
    echo "Nothing was changed. Find out which site broke it before deploying again." >&2
    exit 70
fi

live_port="$(grep -oE '127\.0\.0\.1:82[0-9]{2}' "$UPSTREAM" | head -n1 | cut -d: -f2)"
case "$live_port" in
    8200) live_slot=0; idle_slot=1 ;;
    8201) live_slot=1; idle_slot=0 ;;
    *) echo "Cannot tell which slot is live from $UPSTREAM." >&2; exit 70 ;;
esac
idle_port="820$idle_slot"

echo "Sharing this release's scripts and styles"
mkdir -p "$BASE/shared/static/_next/static"
rsync -a "$release/.next/static/" "$BASE/shared/static/_next/static/"
# The application keeps a few working files beside its code.
sudo install -d -o "$APP_USER" -g "$APP_USER" -m 750 "$release/.next/cache"

echo "Migrating the database"
tool migrate

echo "Adding anything missing from the lodge's setup"
tool seed

echo "Starting release ${release_id:0:7} in slot $idle_slot"
sudo systemctl stop "ukingo-web@$idle_slot.service" 2>/dev/null || true
ln -sfn "$release" "$BASE/slots/$idle_slot.new"
mv -Tf "$BASE/slots/$idle_slot.new" "$BASE/slots/$idle_slot"
sudo systemctl start "ukingo-web@$idle_slot.service"

abandon() {
    sudo systemctl stop "ukingo-web@$idle_slot.service" 2>/dev/null || true
    echo "$1" >&2
    exit 1
}

started=""
for attempt in $(seq 1 40); do
    if curl --silent --max-time 3 --head "http://127.0.0.1:$idle_port/up" 2>/dev/null | grep -qi "^x-release: $release_id"; then
        started=yes
        break
    fi
    sleep 1
done
if [[ -z "$started" ]]; then
    sudo journalctl -u "ukingo-web@$idle_slot.service" -n 30 --no-pager >&2 || true
    abandon "Release ${release_id:0:7} did not start. The site is unchanged."
fi

# The gate. The new release opens the pages a visitor can reach, with the
# live settings and database. Visitors are still on the old release, so a
# release that fails here never reaches them.
echo "Checking the release before it goes live"
if ! tool check-release --base "http://127.0.0.1:$idle_port" --release "$release_id"; then
    abandon "Release ${release_id:0:7} failed its check and was not put live."
fi

point_nginx_at() {
    printf 'server 127.0.0.1:%s;\n' "$1" | sudo tee "$UPSTREAM.new" >/dev/null
    sudo mv -f "$UPSTREAM.new" "$UPSTREAM"
    sudo nginx -t >/dev/null 2>&1 || return 1
    sudo systemctl reload nginx
}

# Asks the web server on this machine for a page under the public name. The
# certificate is the one Cloudflare trusts, not one curl knows, hence --insecure.
fetch() {
    curl --silent --show-error --insecure --max-time 20 \
        --resolve "$HOST:443:127.0.0.1" "$@"
}

serves_the_release() {
    local attempt headers path

    for attempt in 1 2 3 4 5 6 7 8 9 10; do
        headers="$(fetch --head "https://$HOST/up" || true)"
        if grep -qi "^x-release: $release_id" <<<"$headers"; then
            break
        fi
        if [[ $attempt -eq 10 ]]; then
            echo "The web server is not serving ${release_id:0:7}." >&2
            return 1
        fi
        sleep 1
    done

    for path in / / /rooms /stay /sitemap.xml; do
        if ! fetch --fail --output /dev/null "https://$HOST$path"; then
            echo "$path did not load on the live site." >&2
            return 1
        fi
    done
}

echo "Switching visitors to release ${release_id:0:7}"
if ! point_nginx_at "$idle_port"; then
    # Put the file back as it was. nginx was not reloaded, so visitors saw nothing.
    printf 'server 127.0.0.1:%s;\n' "$live_port" | sudo tee "$UPSTREAM" >/dev/null
    abandon "nginx refused its configuration. The site is unchanged."
fi

echo "Checking the live site"
if ! serves_the_release; then
    if point_nginx_at "$live_port"; then
        abandon "Release ${release_id:0:7} did not serve its pages. Visitors are back on the release before it."
    fi
    abandon "Release ${release_id:0:7} did not serve its pages, and nginx could not be pointed back. Look at this now."
fi

previous="$(readlink -f "$BASE/current" 2>/dev/null || true)"
ln -sfn "$release" "$BASE/current.new"
mv -Tf "$BASE/current.new" "$BASE/current"

# The slot that is live is the one that starts when the server boots.
sudo systemctl enable "ukingo-web@$idle_slot.service" >/dev/null 2>&1 || true
sudo systemctl disable "ukingo-web@$live_slot.service" >/dev/null 2>&1 || true
sudo systemctl restart ukingo-jobs.service

# Requests already in hand on the old release are given time to finish.
sleep 10
sudo systemctl stop "ukingo-web@$live_slot.service" 2>/dev/null || true

echo "Removing old releases"
cd "$BASE/releases"
ls -1t | tail -n +$((KEEP_RELEASES + 1)) | while read -r old; do
    [[ "$old" =~ ^[0-9a-f]{40}$ && "$old" != "$release_id" && "$BASE/releases/$old" != "$previous" ]] || continue
    sudo rm -rf -- "${BASE:?}/releases/$old"
done

# Scripts and styles are kept for every release still on disk, so a browser
# holding a page from the release before can still load what that page needs.
keep="$(mktemp)"
for kept in "$BASE"/releases/*/; do
    [[ -d "$kept.next/static" ]] && ( cd "$kept.next/static" && find . -type f ) >>"$keep"
done
( cd "$BASE/shared/static/_next/static" && find . -type f ) | sort >"$keep.have"
sort -u "$keep" >"$keep.want"
comm -23 "$keep.have" "$keep.want" | while read -r stale; do
    rm -f -- "$BASE/shared/static/_next/static/$stale"
done
find "$BASE/shared/static/_next/static" -mindepth 1 -type d -empty -delete 2>/dev/null || true
rm -f "$keep" "$keep.have" "$keep.want"

echo "Release ${release_id:0:7} is live in slot $idle_slot."
