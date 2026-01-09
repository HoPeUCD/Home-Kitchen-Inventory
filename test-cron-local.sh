#!/bin/bash

# Local Test Script for Weekly Expiry Reminder
# This script tests the cron endpoint locally

# Configuration - Update these values
YOUR_APP_URL="https://home-kitchen-inventory.vercel.app"  # Local development server
CRON_SECRET="88888888"                 # Same as in your .env.local

# API endpoint (remove trailing slash from URL if present)
API_URL="${YOUR_APP_URL%/}/api/cron/weekly-reminder"

echo "Testing Weekly Reminder API..."
echo "URL: ${API_URL}"
echo "Secret: ${CRON_SECRET}"
echo ""

# Make the API call
echo "Making API call..."
echo ""

# First try with verbose output to see what's happening
response=$(curl -s -w "\n%{http_code}" -X GET \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Type: application/json" \
  "${API_URL}")

# Extract HTTP status code (last line)
http_code=$(echo "$response" | tail -n1)
# Extract response body (all but last line)
body=$(echo "$response" | sed '$d')

# Log the result to local file
log_file="./test-weekly-reminder.log"
timestamp=$(date '+%Y-%m-%d %H:%M:%S')

echo ""
echo "=========================================="
echo "Response Status Code: $http_code"
echo "=========================================="
echo "Response Body:"
echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
echo "=========================================="

if [ "$http_code" -eq 200 ]; then
  echo "[${timestamp}] ✅ SUCCESS: Weekly reminder sent successfully" | tee -a "$log_file"
  echo "[${timestamp}] Response: $body" >> "$log_file"
  exit 0
else
  echo "[${timestamp}] ❌ ERROR: Failed to send weekly reminder (HTTP $http_code)" | tee -a "$log_file"
  echo "[${timestamp}] Response: $body" >> "$log_file"
  exit 1
fi
