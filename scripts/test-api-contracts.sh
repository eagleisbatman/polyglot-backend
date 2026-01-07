#!/bin/bash

# API Contract Testing Script (Shell version)
# Tests all API endpoints against the contracts defined in API_CONTRACTS.md
#
# Usage:
#   ./scripts/test-api-contracts.sh [baseUrl]
#
# Example:
#   ./scripts/test-api-contracts.sh http://localhost:3000

set -e

BASE_URL="${1:-http://localhost:3000}"
PASSED=0
FAILED=0
WARNINGS=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_test() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $2"
        ((PASSED++))
    else
        echo -e "${RED}✗${NC} $2"
        if [ -n "$3" ]; then
            echo -e "  ${RED}$3${NC}"
        fi
        ((FAILED++))
    fi
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
    ((WARNINGS++))
}

echo -e "${BLUE}API Contract Testing${NC}"
echo "Testing against: $BASE_URL"
echo "=================================================="

# Test 1: Health Check
echo -e "\n${CYAN}Testing Health Check${NC}"
echo "──────────────────────────────────────────────────"

HEALTH_RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/health" || echo "ERROR")
HEALTH_BODY=$(echo "$HEALTH_RESPONSE" | head -n -1)
HEALTH_STATUS=$(echo "$HEALTH_RESPONSE" | tail -n 1)

if [ "$HEALTH_STATUS" = "200" ]; then
    log_test 0 "Status code is 200"
    
    if echo "$HEALTH_BODY" | grep -q '"status"'; then
        log_test 0 "Response has status field"
    else
        log_test 1 "Response has status field" "Missing status field"
    fi
    
    if echo "$HEALTH_BODY" | grep -q '"timestamp"'; then
        log_test 0 "Response has timestamp field"
    else
        log_test 1 "Response has timestamp field" "Missing timestamp field"
    fi
    
    if echo "$HEALTH_BODY" | grep -q '"uptime"'; then
        log_test 0 "Response has uptime field"
    else
        log_test 1 "Response has uptime field" "Missing uptime field"
    fi
else
    log_test 1 "Health check returns 200" "Got status $HEALTH_STATUS"
fi

# Test 2: Rate Limit Headers
echo -e "\n${CYAN}Testing Rate Limit Headers${NC}"
echo "──────────────────────────────────────────────────"

RATE_LIMIT_HEADERS=$(curl -s -I "$BASE_URL/health" | grep -i "x-ratelimit" || echo "")

if echo "$RATE_LIMIT_HEADERS" | grep -qi "x-ratelimit-limit"; then
    log_test 0 "X-RateLimit-Limit header present"
else
    log_test 1 "X-RateLimit-Limit header present" "Missing header"
fi

if echo "$RATE_LIMIT_HEADERS" | grep -qi "x-ratelimit-remaining"; then
    log_test 0 "X-RateLimit-Remaining header present"
else
    log_test 1 "X-RateLimit-Remaining header present" "Missing header"
fi

if echo "$RATE_LIMIT_HEADERS" | grep -qi "x-ratelimit-reset"; then
    log_test 0 "X-RateLimit-Reset header present"
else
    log_test 1 "X-RateLimit-Reset header present" "Missing header"
fi

# Test 3: Voice Translation (validation)
echo -e "\n${CYAN}Testing Voice Translation${NC}"
echo "──────────────────────────────────────────────────"

# Mock base64 audio (minimal valid WAV header)
MOCK_AUDIO="UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="

VOICE_RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST "$BASE_URL/api/v1/voice/translate" \
    -H "Content-Type: application/json" \
    -d "{\"audio\":\"$MOCK_AUDIO\",\"sourceLanguage\":\"en\",\"targetLanguage\":\"hi\"}" \
    || echo "ERROR")
VOICE_BODY=$(echo "$VOICE_RESPONSE" | head -n -1)
VOICE_STATUS=$(echo "$VOICE_RESPONSE" | tail -n 1)

if [ "$VOICE_STATUS" = "200" ]; then
    if echo "$VOICE_BODY" | grep -q '"success":true'; then
        log_test 0 "Response has success: true"
    else
        log_test 1 "Response has success: true" "Missing or incorrect success field"
    fi
elif [ "$VOICE_STATUS" = "400" ] || [ "$VOICE_STATUS" = "500" ]; then
    log_warning "Voice translation returned error (may be expected if API key missing)"
    if echo "$VOICE_BODY" | grep -q '"success":false'; then
        log_test 0 "Error response has correct format"
    else
        log_test 1 "Error response has correct format" "Missing success: false"
    fi
else
    log_test 1 "Voice translation endpoint exists" "Unexpected status: $VOICE_STATUS"
fi

# Test 4: Vision Translation (validation - missing file)
echo -e "\n${CYAN}Testing Vision Translation${NC}"
echo "──────────────────────────────────────────────────"

VISION_RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST "$BASE_URL/api/v1/vision/translate" \
    || echo "ERROR")
VISION_STATUS=$(echo "$VISION_RESPONSE" | tail -n 1)

if [ "$VISION_STATUS" = "400" ]; then
    log_test 0 "Missing file returns 400"
else
    log_test 1 "Missing file returns 400" "Got status $VISION_STATUS"
fi

# Test 5: Document Translation (validation - missing file)
echo -e "\n${CYAN}Testing Document Translation${NC}"
echo "──────────────────────────────────────────────────"

DOC_RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST "$BASE_URL/api/v1/documents/translate" \
    || echo "ERROR")
DOC_STATUS=$(echo "$DOC_RESPONSE" | tail -n 1)

if [ "$DOC_STATUS" = "400" ]; then
    log_test 0 "Missing file returns 400"
else
    log_test 1 "Missing file returns 400" "Got status $DOC_STATUS"
fi

# Test 6: Follow-up Question Handler (validation)
echo -e "\n${CYAN}Testing Follow-up Question Handler${NC}"
echo "──────────────────────────────────────────────────"

FOLLOWUP_RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST "$BASE_URL/api/v1/voice/interactions/invalid-id/follow-up" \
    -H "Content-Type: application/json" \
    -d '{"questionId":"test-question-id"}' \
    || echo "ERROR")
FOLLOWUP_STATUS=$(echo "$FOLLOWUP_RESPONSE" | tail -n 1)

if [ "$FOLLOWUP_STATUS" = "400" ] || [ "$FOLLOWUP_STATUS" = "404" ]; then
    log_test 0 "Invalid interaction returns 400 or 404"
else
    log_test 1 "Invalid interaction returns 400 or 404" "Got status $FOLLOWUP_STATUS"
fi

# Test 7: Error Response Format (404)
echo -e "\n${CYAN}Testing Error Response Format${NC}"
echo "──────────────────────────────────────────────────"

ERROR_RESPONSE=$(curl -s -w "\n%{http_code}" \
    "$BASE_URL/api/v1/nonexistent" \
    || echo "ERROR")
ERROR_BODY=$(echo "$ERROR_RESPONSE" | head -n -1)
ERROR_STATUS=$(echo "$ERROR_RESPONSE" | tail -n 1)

if [ "$ERROR_STATUS" = "404" ]; then
    log_test 0 "404 status code"
    
    if echo "$ERROR_BODY" | grep -q '"success":false'; then
        log_test 0 "Error response has success: false"
    else
        log_test 1 "Error response has success: false" "Missing success: false"
    fi
    
    if echo "$ERROR_BODY" | grep -q '"error"'; then
        log_test 0 "Error response has error message"
    else
        log_test 1 "Error response has error message" "Missing error message"
    fi
else
    log_test 1 "404 status code" "Got status $ERROR_STATUS"
fi

# Summary
echo -e "\n${BLUE}Test Summary${NC}"
echo "=================================================="
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
if [ $WARNINGS -gt 0 ]; then
    echo -e "${YELLOW}Warnings: $WARNINGS${NC}"
fi

TOTAL=$((PASSED + FAILED))
if [ $TOTAL -gt 0 ]; then
    PERCENTAGE=$((PASSED * 100 / TOTAL))
    echo -e "\nSuccess Rate: ${PERCENTAGE}%"
else
    echo -e "\nSuccess Rate: 0%"
fi

if [ $FAILED -gt 0 ]; then
    exit 1
else
    exit 0
fi

