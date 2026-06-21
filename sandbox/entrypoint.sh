#!/usr/bin/env bash
set -euo pipefail

# Git identity (commits attributed to you, not the sandbox).
git config --global user.name  "${GIT_USER_NAME:-Kallory}"
git config --global user.email "${GIT_USER_EMAIL:-kory232323@gmail.com}"
git config --global --add safe.directory /workspace/macroracle
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"

if [ ! -d /workspace/macroracle/.git ]; then
    git init -q /workspace/macroracle || true
fi

# Per-user Postgres cluster living in the home volume (persists across runs).
export PGDATA="$HOME/pgdata"
export PGDATABASE="macroracle_dev"

if [ ! -s "$PGDATA/PG_VERSION" ]; then
    echo ">> initdb (first run) ..."
    initdb -D "$PGDATA" -U node -A trust >/dev/null
fi

if ! pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
    echo ">> starting postgres ..."
    pg_ctl -D "$PGDATA" -l "$PGDATA/server.log" \
        -o "-c listen_addresses=localhost -p 5432 -c unix_socket_directories=/tmp" -w start >/dev/null
fi

if ! psql -h localhost -U node -lqt | cut -d '|' -f1 | grep -qw "$PGDATABASE"; then
    createdb -h localhost -U node "$PGDATABASE"
fi

export DATABASE_URL="postgresql://node@localhost:5432/${PGDATABASE}"
echo ">> DATABASE_URL=${DATABASE_URL}"

exec "$@"
