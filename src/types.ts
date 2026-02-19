/**
 * Core types for mcp-test compliance testing.
 */

export type Severity = 'critical' | 'major' | 'minor';
export type TestStatus = 'pass' | 'fail' | 'skip' | 'error';

/**
 * A single test case definition, loaded from the compliance suite YAML.
 */
export interface TestCase {
  id: string;
  category: string;
  name: string;
  description: string;
  severity: Severity;
  spec_ref: string;
}

/**
 * The result of running a single test case.
 */
export interface TestResult {
  test: TestCase;
  status: TestStatus;
  message?: string;
  duration_ms: number;
  actual?: unknown;
  expected?: unknown;
}

/**
 * Aggregated results for an entire compliance suite run.
 */
export interface SuiteResult {
  server_command: string;
  timestamp: string;
  duration_ms: number;
  protocol_version: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    errors: number;
    compliance_score: number; // percentage of critical+major tests passing
  };
  results: TestResult[];
}

/**
 * The YAML compliance suite file structure.
 */
export interface ComplianceSuite {
  version: string;
  spec_version: string;
  tests: TestCase[];
}

/**
 * Options passed from the CLI to the test runner.
 */
export interface RunOptions {
  server: string;
  output: 'human' | 'json';
  filter?: string;
  timeout: number;
  failOn: Severity;
}

/**
 * A check function that receives a connection and returns a test result.
 */
export type CheckFn = (ctx: CheckContext) => Promise<TestResult>;

/**
 * Context passed to individual check functions.
 */
export interface CheckContext {
  test: TestCase;
  /** Send a JSON-RPC request and wait for response */
  sendRequest: (method: string, params?: Record<string, unknown>) => Promise<JsonRpcResponse>;
  /** Send a JSON-RPC notification (no response expected) */
  sendNotification: (method: string, params?: Record<string, unknown>) => void;
  /** Send raw JSON string to server stdin */
  sendRaw: (data: string) => void;
  /** Read next notification/server-initiated message from server stdout */
  readMessage: (timeoutMs?: number) => Promise<unknown>;
  /** The server capabilities from initialization */
  serverCapabilities: Record<string, unknown>;
  /** The server info from initialization */
  serverInfo: { name: string; version?: string };
  /** Timeout in ms */
  timeout: number;
  /** The protocol version from initialization */
  protocolVersion: string;
}

/**
 * Standard JSON-RPC 2.0 response.
 */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: Record<string, unknown>;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Standard JSON-RPC 2.0 request.
 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * Standard JSON-RPC 2.0 notification.
 */
export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}
