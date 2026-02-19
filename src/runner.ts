/**
 * Test runner: loads the compliance suite, spawns the server, runs checks.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { McpConnection } from './connection.js';
import type {
  ComplianceSuite,
  RunOptions,
  SuiteResult,
  TestResult,
  TestCase,
  CheckContext,
  CheckFn,
} from './types.js';
import { getChecks } from './checks/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load the compliance suite YAML.
 */
export function loadSuite(customPath?: string): ComplianceSuite {
  const suitePath = customPath || resolve(__dirname, '..', 'tests', 'compliance-suite.yaml');
  const raw = readFileSync(suitePath, 'utf-8');
  const suite = yaml.load(raw) as ComplianceSuite;
  return suite;
}

/**
 * Run the full compliance suite against a server.
 */
export async function runSuite(options: RunOptions, suitePath?: string): Promise<SuiteResult> {
  const suite = loadSuite(suitePath);
  const startTime = Date.now();

  // Filter tests by category if specified
  let tests = suite.tests;
  if (options.filter) {
    tests = tests.filter((t) => t.category === options.filter);
  }

  // Get check implementations
  const checks = getChecks();
  const results: TestResult[] = [];

  // Spawn server and connect
  const conn = new McpConnection(options.server);

  try {
    await conn.start();

    // Initialize the connection
    let serverCapabilities: Record<string, unknown> = {};
    let serverInfo: { name: string; version?: string } = { name: 'unknown' };
    let protocolVersion = 'unknown';

    try {
      const initResult = await conn.initialize(options.timeout * 2);
      serverCapabilities = initResult.capabilities;
      serverInfo = initResult.serverInfo;
      protocolVersion = initResult.protocolVersion;
    } catch (err) {
      // If initialization fails, mark all tests as errors
      for (const test of tests) {
        results.push({
          test,
          status: 'error',
          message: `Initialization failed: ${err instanceof Error ? err.message : String(err)}`,
          duration_ms: 0,
        });
      }
      return buildSuiteResult(options, results, startTime, 'unknown');
    }

    // Run each test
    for (const test of tests) {
      const checkFn = checks.get(test.id);
      if (!checkFn) {
        results.push({
          test,
          status: 'skip',
          message: 'Check not implemented yet',
          duration_ms: 0,
        });
        continue;
      }

      // Check if the test requires a capability the server doesn't have
      if (shouldSkipForCapability(test, serverCapabilities)) {
        results.push({
          test,
          status: 'skip',
          message: `Server does not declare required capability for ${test.category}`,
          duration_ms: 0,
        });
        continue;
      }

      const ctx: CheckContext = {
        test,
        sendRequest: (method, params) => conn.sendRequest(method, params, options.timeout),
        sendNotification: (method, params) => conn.sendNotification(method, params),
        sendRaw: (data) => conn.sendRaw(data),
        readMessage: () => conn.readMessage(options.timeout),
        serverCapabilities,
        serverInfo,
        timeout: options.timeout,
      };

      const testStart = Date.now();
      try {
        const result = await checkFn(ctx);
        result.duration_ms = Date.now() - testStart;
        results.push(result);
      } catch (err) {
        results.push({
          test,
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
          duration_ms: Date.now() - testStart,
        });
      }
    }

    return buildSuiteResult(options, results, startTime, protocolVersion);
  } finally {
    await conn.close();
  }
}

/**
 * Determine if a test should be skipped because the server lacks the needed capability.
 */
function shouldSkipForCapability(test: TestCase, capabilities: Record<string, unknown>): boolean {
  // Only skip feature-specific tests if the capability isn't declared
  switch (test.category) {
    case 'tools':
      return !capabilities.tools;
    case 'resources':
      return !capabilities.resources;
    case 'prompts':
      return !capabilities.prompts;
    default:
      return false; // lifecycle, errors, jsonrpc, versioning always run
  }
}

/**
 * Build the final SuiteResult with summary statistics.
 */
function buildSuiteResult(
  options: RunOptions,
  results: TestResult[],
  startTime: number,
  protocolVersion: string,
): SuiteResult {
  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  const errors = results.filter((r) => r.status === 'error').length;

  // Compliance score: % of critical+major tests that passed
  const criticalMajor = results.filter(
    (r) => r.test.severity !== 'minor' && r.status !== 'skip'
  );
  const criticalMajorPassed = criticalMajor.filter((r) => r.status === 'pass').length;
  const complianceScore = criticalMajor.length > 0
    ? Math.round((criticalMajorPassed / criticalMajor.length) * 100)
    : 100;

  return {
    server_command: options.server,
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - startTime,
    protocol_version: protocolVersion,
    summary: {
      total: results.length,
      passed,
      failed,
      skipped,
      errors,
      compliance_score: complianceScore,
    },
    results,
  };
}
