#!/bin/bash
# Weekly Emergence Detection Report
# Aggregates emergence signals and trends

WORKSPACE="${WORKSPACE:-.}"
MEMORY_DIR="$WORKSPACE/memory"
EMERGENCE_LOG="$WORKSPACE/.openclaw/evolution/emergence.jsonl"

echo "=== EMERGENCE DETECTION REPORT ==="
echo "Date: $(date)"
echo ""

if [ ! -f "$EMERGENCE_LOG" ]; then
    echo "No emergence log found at $EMERGENCE_LOG"
    exit 1
fi

# Count signals by type
echo "=== Signals by Type (Last 7 Days) ==="
cat "$EMERGENCE_LOG" | \
    jq -r 'select(.timestamp > now | floor - 604800) | .type' | \
    sort | uniq -c | sort -rn || echo "No data"

echo ""
echo "=== Signals by Category ==="
cat "$EMERGENCE_LOG" | \
    jq -r 'select(.timestamp > now | floor - 604800) | .category' | \
    sort | uniq -c | sort -rn || echo "No data"

echo ""
echo "=== High Significance Signals ==="
cat "$EMERGENCE_LOG" | \
    jq -r 'select(.timestamp > now | floor - 604800) | select(.significance == "high") | "\(.type): \(.description)"' | \
    head -10 || echo "None"

echo ""
echo "Report complete. Data stored in $EMERGENCE_LOG"
