#!/usr/bin/env node

/**
 * API Contract Testing Script
 * Tests all API endpoints against the contracts defined in API_CONTRACTS.md
 * 
 * Usage:
 *   node scripts/test-api-contracts.js [baseUrl]
 * 
 * Example:
 *   node scripts/test-api-contracts.js http://localhost:3000
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const baseUrl = process.argv[2] || 'http://localhost:3000';
const results = {
  passed: 0,
  failed: 0,
  warnings: 0,
};

// Helper function to make HTTP requests
function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(options.url || baseUrl + options.path);
    const client = url.protocol === 'https:' ? https : http;
    
    const reqOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = client.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const jsonBody = body ? JSON.parse(body) : null;
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: jsonBody,
            rawBody: body,
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: null,
            rawBody: body,
          });
        }
      });
    });

    req.on('error', reject);
    
    if (data) {
      if (typeof data === 'string') {
        req.write(data);
      } else {
        req.write(JSON.stringify(data));
      }
    }
    
    req.end();
  });
}

// Test result logger
function logTest(name, passed, message = '') {
  if (passed) {
    console.log(`${colors.green}✓${colors.reset} ${name}`);
    results.passed++;
  } else {
    console.log(`${colors.red}✗${colors.reset} ${name}`);
    if (message) {
      console.log(`  ${colors.red}${message}${colors.reset}`);
    }
    results.failed++;
  }
}

function logWarning(message) {
  console.log(`${colors.yellow}⚠${colors.reset} ${message}`);
  results.warnings++;
}

// Test 1: Health Check
async function testHealthCheck() {
  console.log(`\n${colors.cyan}Testing Health Check${colors.reset}`);
  console.log('─'.repeat(50));
  
  try {
    const response = await makeRequest({
      method: 'GET',
      path: '/health',
    });

    logTest(
      'Status code is 200',
      response.status === 200,
      `Expected 200, got ${response.status}`
    );

    if (response.body) {
      logTest(
        'Response has status field',
        typeof response.body.status === 'string',
        'Missing status field'
      );
      
      logTest(
        'Response has timestamp field',
        typeof response.body.timestamp === 'string',
        'Missing timestamp field'
      );
      
      logTest(
        'Response has uptime field',
        typeof response.body.uptime === 'number',
        'Missing uptime field'
      );
      
      logTest(
        'Response has environment field',
        typeof response.body.environment === 'string',
        'Missing environment field'
      );
    } else {
      logTest('Response is valid JSON', false, 'Invalid JSON response');
    }
  } catch (error) {
    logTest('Health check request succeeds', false, error.message);
  }
}

// Test 2: Voice Translation (with mock data)
async function testVoiceTranslation() {
  console.log(`\n${colors.cyan}Testing Voice Translation${colors.reset}`);
  console.log('─'.repeat(50));
  
  // Mock base64 audio (minimal valid WAV header)
  const mockAudioBase64 = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
  
  try {
    const response = await makeRequest({
      method: 'POST',
      path: '/api/v1/voice/translate',
      headers: {
        'Content-Type': 'application/json',
      },
    }, {
      audio: mockAudioBase64,
      sourceLanguage: 'en',
      targetLanguage: 'hi',
    });

    // Note: This will likely fail without real Gemini API key, but we check structure
    if (response.status === 200 && response.body) {
      logTest(
        'Response has success field',
        response.body.success === true,
        'Missing or incorrect success field'
      );
      
      if (response.body.success && response.body.data) {
        logTest(
          'Response data has interactionId',
          typeof response.body.data.interactionId === 'string',
          'Missing interactionId'
        );
        
        logTest(
          'Response data has translation',
          typeof response.body.data.translation === 'string',
          'Missing translation'
        );
        
        logTest(
          'Response data has followUpQuestions array',
          Array.isArray(response.body.data.followUpQuestions),
          'Missing followUpQuestions array'
        );
      }
    } else if (response.status === 400 || response.status === 500) {
      // Expected if API key is missing or invalid
      logWarning('Voice translation returned error (may be expected if API key missing)');
      if (response.body) {
        logTest(
          'Error response has correct format',
          response.body.success === false && typeof response.body.error === 'string',
          'Error response format incorrect'
        );
      }
    } else {
      logTest('Voice translation endpoint exists', false, `Unexpected status: ${response.status}`);
    }
  } catch (error) {
    logTest('Voice translation request succeeds', false, error.message);
  }
}

// Test 3: Vision Translation (validation only - no real image)
async function testVisionTranslation() {
  console.log(`\n${colors.cyan}Testing Vision Translation${colors.reset}`);
  console.log('─'.repeat(50));
  
  try {
    // Test without file (should return 400)
    const response = await makeRequest({
      method: 'POST',
      path: '/api/v1/vision/translate',
    });

    logTest(
      'Missing file returns 400',
      response.status === 400,
      `Expected 400, got ${response.status}`
    );

    if (response.body) {
      logTest(
        'Error response has correct format',
        response.body.success === false && typeof response.body.error === 'string',
        'Error response format incorrect'
      );
    }
  } catch (error) {
    logTest('Vision translation validation', false, error.message);
  }
}

// Test 4: Document Translation (validation only)
async function testDocumentTranslation() {
  console.log(`\n${colors.cyan}Testing Document Translation${colors.reset}`);
  console.log('─'.repeat(50));
  
  try {
    // Test without file (should return 400)
    const response = await makeRequest({
      method: 'POST',
      path: '/api/v1/documents/translate',
    });

    logTest(
      'Missing file returns 400',
      response.status === 400,
      `Expected 400, got ${response.status}`
    );

    if (response.body) {
      logTest(
        'Error response has correct format',
        response.body.success === false && typeof response.body.error === 'string',
        'Error response format incorrect'
      );
    }
  } catch (error) {
    logTest('Document translation validation', false, error.message);
  }
}

// Test 5: Follow-up Question Handler
async function testFollowUpQuestion() {
  console.log(`\n${colors.cyan}Testing Follow-up Question Handler${colors.reset}`);
  console.log('─'.repeat(50));
  
  try {
    // Test with invalid interaction ID (should return 400 or 404)
    const response = await makeRequest({
      method: 'POST',
      path: '/api/v1/voice/interactions/invalid-id/follow-up',
      headers: {
        'Content-Type': 'application/json',
      },
    }, {
      questionId: 'test-question-id',
    });

    logTest(
      'Invalid interaction returns 400 or 404',
      response.status === 400 || response.status === 404,
      `Expected 400 or 404, got ${response.status}`
    );

    if (response.body) {
      logTest(
        'Error response has correct format',
        response.body.success === false && typeof response.body.error === 'string',
        'Error response format incorrect'
      );
    }
  } catch (error) {
    logTest('Follow-up question validation', false, error.message);
  }
}

// Test 6: Rate Limiting Headers
async function testRateLimitHeaders() {
  console.log(`\n${colors.cyan}Testing Rate Limit Headers${colors.reset}`);
  console.log('─'.repeat(50));
  
  try {
    const response = await makeRequest({
      method: 'GET',
      path: '/health',
    });

    const hasLimitHeader = 'x-ratelimit-limit' in response.headers;
    const hasRemainingHeader = 'x-ratelimit-remaining' in response.headers;
    const hasResetHeader = 'x-ratelimit-reset' in response.headers;

    logTest(
      'X-RateLimit-Limit header present',
      hasLimitHeader,
      'Missing X-RateLimit-Limit header'
    );

    logTest(
      'X-RateLimit-Remaining header present',
      hasRemainingHeader,
      'Missing X-RateLimit-Remaining header'
    );

    logTest(
      'X-RateLimit-Reset header present',
      hasResetHeader,
      'Missing X-RateLimit-Reset header'
    );

    if (hasLimitHeader) {
      const limit = parseInt(response.headers['x-ratelimit-limit']);
      logTest(
        'Rate limit is 100',
        limit === 100,
        `Expected 100, got ${limit}`
      );
    }
  } catch (error) {
    logTest('Rate limit headers check', false, error.message);
  }
}

// Test 7: Error Response Format
async function testErrorResponseFormat() {
  console.log(`\n${colors.cyan}Testing Error Response Format${colors.reset}`);
  console.log('─'.repeat(50));
  
  try {
    // Test invalid endpoint (should return 404)
    const response = await makeRequest({
      method: 'GET',
      path: '/api/v1/nonexistent',
    });

    logTest(
      '404 status code',
      response.status === 404,
      `Expected 404, got ${response.status}`
    );

    if (response.body) {
      logTest(
        'Error response has success: false',
        response.body.success === false,
        'Missing success: false'
      );
      
      logTest(
        'Error response has error message',
        typeof response.body.error === 'string',
        'Missing error message'
      );
    }
  } catch (error) {
    logTest('Error response format check', false, error.message);
  }
}

// Test 8: CORS Headers
async function testCORSHeaders() {
  console.log(`\n${colors.cyan}Testing CORS Headers${colors.reset}`);
  console.log('─'.repeat(50));
  
  try {
    const response = await makeRequest({
      method: 'OPTIONS',
      path: '/health',
    });

    // CORS headers may or may not be present depending on configuration
    const hasCORS = 'access-control-allow-origin' in response.headers;
    
    if (hasCORS) {
      logTest('CORS headers present', true);
    } else {
      logWarning('CORS headers not present (may be configured differently)');
    }
  } catch (error) {
    logWarning(`CORS test failed: ${error.message}`);
  }
}

// Main test runner
async function runTests() {
  console.log(`${colors.blue}API Contract Testing${colors.reset}`);
  console.log(`Testing against: ${baseUrl}`);
  console.log('='.repeat(50));

  await testHealthCheck();
  await testVoiceTranslation();
  await testVisionTranslation();
  await testDocumentTranslation();
  await testFollowUpQuestion();
  await testRateLimitHeaders();
  await testErrorResponseFormat();
  await testCORSHeaders();

  // Summary
  console.log(`\n${colors.blue}Test Summary${colors.reset}`);
  console.log('='.repeat(50));
  console.log(`${colors.green}Passed: ${results.passed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${results.failed}${colors.reset}`);
  if (results.warnings > 0) {
    console.log(`${colors.yellow}Warnings: ${results.warnings}${colors.reset}`);
  }
  
  const total = results.passed + results.failed;
  const percentage = total > 0 ? Math.round((results.passed / total) * 100) : 0;
  console.log(`\nSuccess Rate: ${percentage}%`);
  
  process.exit(results.failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch((error) => {
  console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});

