#!/usr/bin/env bash
#
# One-time server setup for ukingo.jeffgicharu.com on Ubuntu 22.04.
# Run as root from a copy of this directory. Safe to run again: it never
# overwrites the settings file and never touches another site.
#
#   sudo bash provision.sh
#
# Run it again after changing .node-version to install a newer Node.
# The site moves to it on the next release.

set -euo pipefail

SITE=ukingo.jeffgicharu.com
APP_USER=ukingo
DB_NAME=ukingo
BASE=/var/www/$SITE
HERE="$(cd "$(dirname "$0")" && pwd)"
# The version the project is built and tested with, from the file at its root.
NODE_VERSION="$(tr -d '[:space:]' < "$HERE/../.node-version")"

echo "== Application user and directories"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
    useradd --system --home-dir "$BASE" --no-create-home --shell /usr/sbin/nologin "$APP_USER"
fi

# The deploy user owns the releases. The application user can read them and
# can write only where it must: its uploads and its backups.
install -d -o deploy -g deploy -m 755 "$BASE" "$BASE/releases" "$BASE/slots"
install -d -o root -g root -m 755 "$BASE/shared" "$BASE/shared/pages" "$BASE/runtime"
install -d -o deploy -g deploy -m 755 "$BASE/shared/static"
install -d -o "$APP_USER" -g "$APP_USER" -m 755 "$BASE/shared/media"
install -d -o "$APP_USER" -g "$APP_USER" -m 750 "$BASE/shared/backups"
install -o root -g root -m 644 "$HERE/unavailable.html" "$BASE/shared/pages/unavailable.html"

echo "== Node $NODE_VERSION"
# The site carries its own Node, so that nothing another project does to the
# server's Node can affect it. It belongs to root: the application cannot
# replace its own runtime.
node_dir="$BASE/runtime/node-v$NODE_VERSION"
if [[ ! -x "$node_dir/bin/node" ]]; then
    archive="node-v$NODE_VERSION-linux-x64.tar.xz"
    scratch="$(mktemp -d)"
    trap 'rm -rf "$scratch"' EXIT
    curl --fail --silent --show-error --location -o "$scratch/$archive" "https://nodejs.org/dist/v$NODE_VERSION/$archive"
    curl --fail --silent --show-error --location -o "$scratch/SHASUMS256.txt" "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
    ( cd "$scratch" && grep " $archive\$" SHASUMS256.txt | sha256sum --check --status ) || {
        echo "The Node download does not match its published checksum." >&2
        exit 1
    }
    install -d -o root -g root -m 755 "$node_dir"
    tar -xJf "$scratch/$archive" -C "$node_dir" --strip-components=1 --no-same-owner
    chown -R root:root "$node_dir"
fi
ln -sfn "$node_dir" "$BASE/runtime/node"
"$BASE/runtime/node/bin/node" --version

echo "== Database"
role_exists() { sudo -u postgres psql -Atc "select 1 from pg_roles where rolname='$APP_USER'" | grep -q 1; }
db_exists() { sudo -u postgres psql -Atc "select 1 from pg_database where datname='$DB_NAME'" | grep -q 1; }

if [[ ! -f "$BASE/shared/env" ]]; then
    db_password="$(openssl rand -hex 24)"
    if role_exists; then
        sudo -u postgres psql -q -v pw="$db_password" <<<"ALTER ROLE $APP_USER LOGIN PASSWORD :'pw';"
    else
        sudo -u postgres psql -q -v pw="$db_password" <<<"CREATE ROLE $APP_USER LOGIN PASSWORD :'pw';"
    fi

    echo "== Settings file"
    umask 077
    cat > "$BASE/shared/env" <<EOF
SITE_URL=https://$SITE
DATABASE_URL=postgres://$APP_USER:$db_password@127.0.0.1:5432/$DB_NAME
DATABASE_POOL=5
APP_SECRET=$(openssl rand -hex 32)
ALLOW_INDEXING=false
MEDIA_DIR=$BASE/shared/media
EOF
    umask 022
    chown "$APP_USER:$APP_USER" "$BASE/shared/env"
    chmod 600 "$BASE/shared/env"
    unset db_password
else
    echo "Keeping the existing settings file."
fi

db_exists || sudo -u postgres createdb -O "$APP_USER" "$DB_NAME"
sudo -u postgres psql -q -d "$DB_NAME" -c 'CREATE EXTENSION IF NOT EXISTS btree_gist;'

echo "== Activation script and services"
install -o root -g root -m 755 "$HERE/activate.sh" /usr/local/bin/ukingo-activate
install -o root -g root -m 644 "$HERE/ukingo-web@.service" /etc/systemd/system/ukingo-web@.service
install -o root -g root -m 644 "$HERE/ukingo-jobs.service" /etc/systemd/system/ukingo-jobs.service

# The nightly backup, which also restores each dump into a scratch database to prove it can be.
install -o root -g root -m 755 "$HERE/backup.sh" /usr/local/bin/ukingo-backup
install -o root -g root -m 644 "$HERE/ukingo-backup.service" /etc/systemd/system/ukingo-backup.service
install -o root -g root -m 644 "$HERE/ukingo-backup.timer" /etc/systemd/system/ukingo-backup.timer

systemctl daemon-reload
systemctl enable ukingo-jobs.service >/dev/null
systemctl enable --now ukingo-backup.timer >/dev/null

echo "== nginx"
# Which slot is live. A release rewrites this one file and nothing else.
install -d -o root -g root -m 755 /etc/nginx/ukingo
if [[ ! -f /etc/nginx/ukingo/upstream.conf ]]; then
    printf 'server 127.0.0.1:8200;\n' > /etc/nginx/ukingo/upstream.conf
fi

install -o root -g root -m 644 "$HERE/nginx.conf" "/etc/nginx/sites-available/$SITE"
ln -sfn "/etc/nginx/sites-available/$SITE" "/etc/nginx/sites-enabled/$SITE"
if nginx -t; then
    systemctl reload nginx
else
    # A broken config must not stay enabled: the next reload would take
    # every site on the server down with it.
    rm -f "/etc/nginx/sites-enabled/$SITE"
    echo "nginx rejected the site config. It has been disabled again." >&2
    exit 1
fi

echo "== Done"
