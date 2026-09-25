#!/bin/sh
set -eu
umask 077
mkdir -p backups
backup="backups/forno-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose exec -T db pg_dump -U forno -d forno -Fc > "$backup"
echo "Backup erstellt: $backup"
