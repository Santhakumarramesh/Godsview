#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# GodsView — PostgreSQL Backup to S3
#
# Creates a compressed pg_dump, uploads it to S3, and prunes old
# backups beyond the retention window.
#
# Usage:
#   ./scripts/pg-backup-s3.sh              # manual run
#   crontab: 0 */6 * * * /path/to/pg-backup-s3.sh  # every 6 hours
#
# Environment variables (from .env or export):
#   POSTGRES_PASSWORD   — DB password (required)
#   S3_BUCKET           — target bucket (default: godsview-storage)
#   S3_REGION           — AWS region  (default: us-east-1)
#   BACKUP_RETENTION    — days to keep (default: 14)
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Config ───────────────────────────────────────────────────────
DB_NAME="${POSTGRES_DB:-godsview}"
DB_USER="${POSTGRES_USER:-godsview}"
DB_HOST="${POSTGRES_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_PASS="${POSTGRES_PASSWORD:-godsview_secret}"

S3_BUCKET="${S3_BUCKET:-godsview-storage}"
S3_REGION="${S3_REGION:-us-east-1}"
S3_PREFIX="backups/postgres"
RETENTION_DAYS="${BACKUP_RETENTION:-14}"

TIMESTAMP=$(date -u +"%Y%m%d_%H%M%S")
BACKUP_FILE="godsview_${TIMESTAMP}.sql.gz"
TMP_DIR="/tmp/godsview-backups"

# ── Setup ────────────────────────────────────────────────────────
mkdir -p "$TMP_DIR"
echo "[$(date -u +%FT%TZ)] Starting PostgreSQL backup: $BACKUP_FILE"

# ── Dump ─────────────────────────────────────────────────────────
PGPASSWORD="$DB_PASS" pg_dump \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-privileges \
  --verbose \
  2>/tmp/pg_dump.log \
  | gzip > "${TMP_DIR}/${BACKUP_FILE}"

BACKUP_SIZE=$(du -h "${TMP_DIR}/${BACKUP_FILE}" | cut -f1)
echo "[$(date -u +%FT%TZ)] Dump complete: ${BACKUP_SIZE}"

# ── Upload to S3 ────────────────────────────────────────────────
aws s3 cp \
  "${TMP_DIR}/${BACKUP_FILE}" \
  "s3://${S3_BUCKET}/${S3_PREFIX}/${BACKUP_FILE}" \
  --region "$S3_REGION" \
  --storage-class STANDARD_IA \
  --only-show-errors

echo "[$(date -u +%FT%TZ)] Uploaded to s3://${S3_BUCKET}/${S3_PREFIX}/${BACKUP_FILE}"

# ── Prune old backups ────────────────────────────────────────────
CUTOFF=$(date -u -d "${RETENTION_DAYS} days ago" +%Y%m%d 2>/dev/null || \
         date -u -v-${RETENTION_DAYS}d +%Y%m%d 2>/dev/null || echo "")

if [ -n "$CUTOFF" ]; then
  echo "[$(date -u +%FT%TZ)] Pruning backups older than ${RETENTION_DAYS} days (cutoff: $CUTOFF)"
  aws s3 ls "s3://${S3_BUCKET}/${S3_PREFIX}/" --region "$S3_REGION" 2>/dev/null | \
    awk '{print $4}' | \
    grep -E '^godsview_[0-9]{8}_' | \
    while read -r file; do
      FILE_DATE=$(echo "$file" | grep -oE '[0-9]{8}' | head -1)
      if [ -n "$FILE_DATE" ] && [ "$FILE_DATE" -lt "$CUTOFF" ]; then
        echo "  Deleting old backup: $file"
        aws s3 rm "s3://${S3_BUCKET}/${S3_PREFIX}/${file}" --region "$S3_REGION" --only-show-errors
      fi
    done
fi

# ── Cleanup local temp ───────────────────────────────────────────
rm -f "${TMP_DIR}/${BACKUP_FILE}"
echo "[$(date -u +%FT%TZ)] Backup complete. Retained: ${RETENTION_DAYS} days."
