#!/bin/bash

set -e

echo "Resetting database..."

docker compose exec -T postgres psql \
    -U postgres \
    -d smartlead <<'SQL'

TRUNCATE TABLE
    mailbox_send_slots,
    scheduled_emails,
    mailboxes
RESTART IDENTITY CASCADE;

TRUNCATE TABLE
    global_rate_limiter;

SQL

echo "Database reset complete."