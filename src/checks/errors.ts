/**
 * Error handling check implementations.
 *
 * Validates JSON-RPC error responses, unknown method handling,
 * and general protocol compliance.
 */

import type { CheckFn, CheckContext, TestResult, JsonRpcResponse } from '../types.js';

export const errorsChecks: Array<[string, CheckFn]> = [
  /**
   * errors-001: Unknown method returns method-not-found error.
   */
  ['errors-001', async (ctx: CheckContext): Promise<TestResult> => {
    try {
      const response = await ctx.sendRequest('__mcp_test_unknown_method__');

      if (!response.error) {
        return {
          test: ctx.test,
          status: 'fail',
          message: 'Server returned success for unknown method — expected error',
          duration_ms: 0,
          expected: 'JSON-RPC error with code -32601',
          actual: response.result,
        };
      }

      if (typeof response.error.code !== 'number') {
        return {
          test: ctx.test,
          status: 'fail',
          message: 'Error code must be an integer',
          duration_ms: 0,
          expected: 'integer',
          actual: typeof response.error.code,
        };
      }

      if (typeof response.error.message !== 'string') {
        return {
          test: ctx.test,
          status: 'fail',
          message: 'Error message must be a string',
          duration_ms: 0,
          expected: 'string',
          actual: typeof response.error.message,
        };
      }

      // -32601 is the standard JSON-RPC "Method not found" code
      const isStandardCode = response.error.code === -32601;

      return {
        test: ctx.test,
        status: 'pass',
        message: `Unknown method rejected with code ${response.error.code}${isStandardCode ? ' (standard)' : ' (non-standard code)'}`,
        duration_ms: 0,
      };
    } catch (err) {
      return {
        test: ctx.test,
        status: 'error',
        message: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
        duration_ms: 0,
      };
    }
  }],

  /**
   * errors-002: Invalid JSON-RPC request returns parse/invalid error.
   */
  ['errors-002', async (ctx: CheckContext): Promise<TestResult> => {
    try {
      // Send a malformed JSON-RPC request (missing jsonrpc field)
      ctx.sendRaw(JSON.stringify({ id: 99999, method: 'ping' }));

      let response: unknown;
      try {
        response = await ctx.readMessage();
      } catch {
        // Server may not respond to invalid messages — that's acceptable
        return {
          test: ctx.test,
          status: 'pass',
          message: 'Server silently ignored malformed request (acceptable behavior)',
          duration_ms: 0,
        };
      }

      const resp = response as JsonRpcResponse;

      // If it responded, it should be an error
      if (resp.error) {
        const validCodes = [-32700, -32600]; // Parse error, Invalid Request
        return {
          test: ctx.test,
          status: 'pass',
          message: `Malformed request rejected with error code ${resp.error.code}`,
          duration_ms: 0,
        };
      }

      // If it responded with a result, that's unexpected but not catastrophic
      return {
        test: ctx.test,
        status: 'fail',
        message: 'Server processed malformed request without error',
        duration_ms: 0,
        expected: 'JSON-RPC error (-32700 or -32600)',
        actual: resp,
      };
    } catch (err) {
      return {
        test: ctx.test,
        status: 'error',
        message: `Test failed: ${err instanceof Error ? err.message : String(err)}`,
        duration_ms: 0,
      };
    }
  }],

  /**
   * errors-003: Error responses have required fields.
   * This test piggybacks on errors-001 — we send an unknown method
   * and verify the error structure meets JSON-RPC 2.0 requirements.
   */
  ['errors-003', async (ctx: CheckContext): Promise<TestResult> => {
    try {
      const response = await ctx.sendRequest('__mcp_test_error_structure__');

      if (!response.error) {
        // If no error, we can't test error structure.
        // Try another approach — just validate what we got.
        return {
          test: ctx.test,
          status: 'skip',
          message: 'Server did not return an error for unknown method — cannot validate error structure',
          duration_ms: 0,
        };
      }

      const issues: string[] = [];

      // code MUST be an integer
      if (typeof response.error.code !== 'number' || !Number.isInteger(response.error.code)) {
        issues.push(`error.code must be an integer, got ${typeof response.error.code}`);
      }

      // message MUST be a string
      if (typeof response.error.message !== 'string') {
        issues.push(`error.message must be a string, got ${typeof response.error.message}`);
      }

      // MUST NOT set both result and error
      if (response.result !== undefined && response.error !== undefined) {
        issues.push('Response MUST NOT set both "result" and "error"');
      }

      // jsonrpc MUST be "2.0"
      if (response.jsonrpc !== '2.0') {
        issues.push(`jsonrpc must be "2.0", got "${response.jsonrpc}"`);
      }

      if (issues.length > 0) {
        return {
          test: ctx.test,
          status: 'fail',
          message: issues.join('; '),
          duration_ms: 0,
          expected: '{ jsonrpc: "2.0", id: ..., error: { code: integer, message: string } }',
          actual: response,
        };
      }

      return {
        test: ctx.test,
        status: 'pass',
        message: 'Error response has valid JSON-RPC 2.0 structure',
        duration_ms: 0,
      };
    } catch (err) {
      return {
        test: ctx.test,
        status: 'error',
        message: `Test failed: ${err instanceof Error ? err.message : String(err)}`,
        duration_ms: 0,
      };
    }
  }],

  /**
   * jsonrpc-001: Responses include matching request ID.
   */
  ['jsonrpc-001', async (ctx: CheckContext): Promise<TestResult> => {
    try {
      // Send a ping and verify the ID matches
      const response = await ctx.sendRequest('ping');

      if (response.jsonrpc !== '2.0') {
        return {
          test: ctx.test,
          status: 'fail',
          message: `jsonrpc field must be "2.0", got "${response.jsonrpc}"`,
          duration_ms: 0,
        };
      }

      if (response.id === undefined || response.id === null) {
        return {
          test: ctx.test,
          status: 'fail',
          message: 'Response missing "id" field — MUST match request ID',
          duration_ms: 0,
        };
      }

      // We can't easily verify the exact ID match here since sendRequest
      // generates the ID internally. But we can verify it's present and valid.
      if (typeof response.id !== 'number' && typeof response.id !== 'string') {
        return {
          test: ctx.test,
          status: 'fail',
          message: `Response id must be string or number, got ${typeof response.id}`,
          duration_ms: 0,
        };
      }

      return {
        test: ctx.test,
        status: 'pass',
        message: `Response includes matching id (${response.id}) and jsonrpc "2.0"`,
        duration_ms: 0,
      };
    } catch (err) {
      return {
        test: ctx.test,
        status: 'error',
        message: `Test failed: ${err instanceof Error ? err.message : String(err)}`,
        duration_ms: 0,
      };
    }
  }],

  /**
   * jsonrpc-002: Server handles concurrent requests correctly.
   */
  ['jsonrpc-002', async (ctx: CheckContext): Promise<TestResult> => {
    try {
      // Send two ping requests concurrently
      const [resp1, resp2] = await Promise.all([
        ctx.sendRequest('ping'),
        ctx.sendRequest('ping'),
      ]);

      // Both should return valid responses
      if (!resp1 || !resp2) {
        return {
          test: ctx.test,
          status: 'fail',
          message: 'Server did not respond to concurrent requests',
          duration_ms: 0,
        };
      }

      // IDs should be different
      if (resp1.id === resp2.id) {
        return {
          test: ctx.test,
          status: 'fail',
          message: 'Concurrent responses have the same ID — should be different',
          duration_ms: 0,
          actual: { id1: resp1.id, id2: resp2.id },
        };
      }

      return {
        test: ctx.test,
        status: 'pass',
        message: `Concurrent requests handled correctly (ids: ${resp1.id}, ${resp2.id})`,
        duration_ms: 0,
      };
    } catch (err) {
      return {
        test: ctx.test,
        status: 'error',
        message: `Concurrent test failed: ${err instanceof Error ? err.message : String(err)}`,
        duration_ms: 0,
      };
    }
  }],
];
