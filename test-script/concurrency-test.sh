#!/bin/bash

set -e

echo "======================================"
echo " Smartlead Concurrency Test"
echo "======================================"

echo ""
echo "Cleaning existing containers..."

docker compose down -v

echo ""
echo "Building images..."

docker compose build

echo ""
echo "Starting PostgreSQL + 5 workers..."

docker compose up --scale worker=5 -d

echo ""
echo "Waiting for workers to process emails..."

while true
do
    PENDING=$(docker compose exec -T postgres psql \
        -U postgres \
        -d smartlead \
        -At \
        -c "SELECT COUNT(*) FROM scheduled_emails WHERE status IN ('pending','sending');")

    echo "Remaining emails: $PENDING"

    if [ "$PENDING" = "0" ]; then
        break
    fi

    sleep 2
done

echo ""
echo "Collecting results..."

TOTAL=$(docker compose exec -T postgres psql \
    -U postgres \
    -d smartlead \
    -At \
    -c "SELECT COUNT(*) FROM scheduled_emails;")

SENT=$(docker compose exec -T postgres psql \
    -U postgres \
    -d smartlead \
    -At \
    -c "SELECT COUNT(*) FROM scheduled_emails WHERE status='sent';")

DEAD=$(docker compose exec -T postgres psql \
    -U postgres \
    -d smartlead \
    -At \
    -c "SELECT COUNT(*) FROM scheduled_emails WHERE status='dead';")

PENDING=$(docker compose exec -T postgres psql \
    -U postgres \
    -d smartlead \
    -At \
    -c "SELECT COUNT(*) FROM scheduled_emails WHERE status='pending';")

SENDING=$(docker compose exec -T postgres psql \
    -U postgres \
    -d smartlead \
    -At \
    -c "SELECT COUNT(*) FROM scheduled_emails WHERE status='sending';")

echo ""
echo "======================================"
echo "Verification"
echo "======================================"

echo "Total Emails : $TOTAL"
echo "Sent         : $SENT"
echo "Dead Letter  : $DEAD"
echo "Pending      : $PENDING"
echo "Sending      : $SENDING"

EXPECTED=$((SENT + DEAD))

echo ""

if [ "$EXPECTED" -eq "$TOTAL" ] && \
   [ "$PENDING" -eq 0 ] && \
   [ "$SENDING" -eq 0 ]; then

    echo "✅ PASS"
    echo ""
    echo "Concurrency test passed."
    echo "All emails reached a terminal state."
    echo "The system completed successfully with 5 concurrent workers."

else

    echo "❌ FAIL"
    echo ""
    echo "Some emails are still pending or the final counts are inconsistent."

    exit 1
fi