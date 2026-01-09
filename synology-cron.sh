#!/bin/bash

# Weekly Expiry Reminder Cron Script for Synology NAS
# This script should be run every Sunday at 8:00 PM

# Configuration - Update these values
YOUR_APP_URL="https://home-kitchen-inventory.vercel.app"  # Replace with your Vercel app URL
CRON_SECRET="88888888"          # Replace with your CRON_SECRET from Vercel

# API endpoint (remove trailing slash from URL if present)
API_URL="${YOUR_APP_URL%/}/api/cron/weekly-reminder"

# Make the API call
response=$(curl -s -w "\n%{http_code}" -X GET \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Type: application/json" \
  "${API_URL}")

# Extract HTTP status code (last line)
http_code=$(echo "$response" | tail -n1)
# Extract response body (all but last line)
body=$(echo "$response" | sed '$d')

# Log the result
log_file="/var/log/weekly-reminder.log"
timestamp=$(date '+%Y-%m-%d %H:%M:%S')

if [ "$http_code" -eq 200 ]; then
  echo "[${timestamp}] SUCCESS: Weekly reminder sent successfully" >> "$log_file"
  echo "[${timestamp}] Response: $body" >> "$log_file"
else
  echo "[${timestamp}] ERROR: Failed to send weekly reminder (HTTP $http_code)" >> "$log_file"
  echo "[${timestamp}] Response: $body" >> "$log_file"
  exit 1
fi
