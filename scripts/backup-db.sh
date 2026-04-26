#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# GodsView — DB backup with rotation
#
#   bash scripts/backup-db.sh [retain=14]
#
# Runs `pg_dump` against the configured DATABASE_URL, gzips the output,
# uploads to s3://${BACKUP_S3_BUCKET}/godsview/$(date), and prunes anything
# older than `retain` days. If BACKUP_S3_BUCKET is unset it just leaves the
# .sql.gz on disk in ./backups/.
#
# Designed to run from cron / Lambda / GitHub Actions on a daily schedule.
# ─────────────────────────────────────────────────────────────────
set -u

RETAIN_DAYS="${1:-14}"
DBURL="${DATABASE_URL:-}"
BUCKET="${BACKUP_S3_BUCKET:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/backups"
mkdir -p "$DEST"

if [ -z "$DBURL" ]; then
  echo "ERROR: DATABASE_URL not set" >&2
  exit 2
fi

STAMP=$(date +%Y%m%d-%H%M%S)
LOCAL="$DEST/godsview-${STAMP}.sql.gz"

echo "[backup] pg_dump → $LOCAL"
pg_dump --no-owner --no-privileges --format=plain "$DBURL" | gzip -9 > "$LOCAL"
SIZE=$(stat -c %s "$LOCAL" 2>/dev/null || stat -f %z "$LOCAL")
echo "[backup] dump size: $SIZE bytes"

if [ -n "$BUCKET" ]; then
  KEY="godsview/${STAMP}.sql.gz"
  echo "[backup] uploading to s3://${BUCKET}/${KEY}"
  aws s3 cp "$LOCAL" "s3://${BUCKET}/${KEY}" --no-progress
  # Lifecycle policy on the bucket should handle long-term retention; we
  # also prune local copies aggressively because they are dev-only.
  echo "[backup] pruning local copies older than ${RETAIN_DAYS} days"
  find "$DEST" -name "godsview-*.sql.gz" -mtime "+${RETAIN_DAYS}" -delete
else
  echo "[backup] BACKUP_S3_BUCKET not set — local-only backup"
fi

echo "[backup] OK"
