#!/usr/bin/env node
/**
 * Test script for Solo Empire MCP Server
 * Run: node test-mcp.js
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, 'src/index.ts');

let messageId = 0;

function createRequest(method, params = {}) {
  return {
    jsonrpc: '2.0',
    id: ++messageId,
    method,
    params,
  };
}

function createNotification(method, params = {}) {
  return {
    jsonrpc: '2.0',
    method,
    params,
  };
}

async function testMCP() {
  console.log('🚀 Starting MCP server test...\n');

  const proc = spawn('npx', ['tsx', serverPath], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  let buffer = '';

  proc.stdout.on('data', (data) => {
    buffer += data.toString();

    // Try to parse complete JSON-RPC messages
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const response = JSON.parse(line);
        console.log('📥 Response:', JSON.stringify(response, null, 2));
      } catch (e) {
        console.log('⚠️  Non-JSON output:', line);
      }
    }
  });

  function send(message) {
    const json = JSON.stringify(message);
    console.log('📤 Sending:', json);
    proc.stdin.write(json + '\n');
  }

  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Initialize
  send(createNotification('notifications/initialized'));

  // Test 1: List tools
  console.log('\n📋 Test 1: List available tools');
  send(createRequest('tools/list'));

  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test 2: Get dashboard
  console.log('\n📊 Test 2: Get dashboard');
  send(createRequest('tools/call', {
    name: 'get_dashboard',
    arguments: {},
  }));

  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test 3: Get skills
  console.log('\n🎯 Test 3: Get skills (limit 5)');
  send(createRequest('tools/call', {
    name: 'get_skills',
    arguments: { limit: 5 },
  }));

  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test 5: Update skill progress
  console.log('\n📈 Test 5: Update skill progress (test)');
  send(createRequest('tools/call', {
    name: 'update_skill_progress',
    arguments: {
      id: 1,
      progress_percent: 25,
      status: 'learning',
      log_activity: true,
      activity_title: 'Test: Started learning',
      activity_type: 'study',
      hours_spent: 2,
      what_learned: 'This is a test entry',
    },
  }));

  await new Promise(resolve => setTimeout(resolve, 1000));

  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('\n✅ Test completed!');
  proc.kill();
  process.exit(0);
}

testMCP().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
