/**
 * Tools check implementations.
 *
 * Validates tools/list, tool schema structure, tools/call responses,
 * and error handling for unknown tools.
 */

import type { CheckFn, CheckContext, TestResult } from '../types.js';

export const toolsChecks: Array<[string, CheckFn]> = [
  /**
   * tools-001: tools/list returns valid tool array.
   */
  ['tools-001', async (ctx: CheckContext): Promise<TestResult> => {
    try {
      const response = await ctx.sendRequest('tools/list');

      if (response.error) {
        return {
          test: ctx.test,
          status: 'fail',
          message: `tools/list returned error: ${response.error.message}`,
          duration_ms: 0,
          actual: response.error,
        };
      }

      const result = response.result as Record<string, unknown>;
      if (!result || !Array.isArray(result.tools)) {
        return {
          test: ctx.test,
          status: 'fail',
          message: 'tools/list result must contain a "tools" array',
          duration_ms: 0,
          expected: '{ tools: [...] }',
          actual: result,
        };
      }

      const tools = result.tools as Array<Record<string, unknown>>;

      // Validate each tool has required fields
      for (const tool of tools) {
        if (typeof tool.name !== 'string' || tool.name.length === 0) {
          return {
            test: ctx.test,
            status: 'fail',
            message: 'Each tool MUST have a non-empty "name" string',
            duration_ms: 0,
            expected: 'string',
            actual: tool.name,
          };
        }
        if (!tool.inputSchema || typeof tool.inputSchema !== 'object') {
          return {
            test: ctx.test,
            status: 'fail',
            message: `Tool "${tool.name}" MUST have an "inputSchema" object`,
            duration_ms: 0,
            expected: 'JSON Schema object',
            actual: tool.inputSchema,
          };
        }
      }

      return {
        test: ctx.test,
        status: 'pass',
        message: `${tools.length} tool(s) returned with valid structure`,
        duration_ms: 0,
      };
    } catch (err) {
      return {
        test: ctx.test,
        status: 'error',
        message: `tools/list failed: ${err instanceof Error ? err.message : String(err)}`,
        duration_ms: 0,
      };
    }
  }],

  /**
   * tools-002: Tool inputSchema is valid JSON Schema.
   */
  ['tools-002', async (ctx: CheckContext): Promise<TestResult> => {
    try {
      const response = await ctx.sendRequest('tools/list');

      if (response.error) {
        return {
          test: ctx.test,
          status: 'fail',
          message: `tools/list returned error: ${response.error.message}`,
          duration_ms: 0,
        };
      }

      const result = response.result as Record<string, unknown>;
      const tools = (result?.tools ?? []) as Array<Record<string, unknown>>;

      if (tools.length === 0) {
        return {
          test: ctx.test,
          status: 'skip',
          message: 'No tools to validate — server returned empty tools list',
          duration_ms: 0,
        };
      }

      const issues: string[] = [];
      for (const tool of tools) {
        const schema = tool.inputSchema as Record<string, unknown>;
        if (!schema) {
          issues.push(`Tool "${tool.name}" missing inputSchema`);
          continue;
        }

        // inputSchema MUST have type: "object"
        if (schema.type !== 'object') {
          issues.push(`Tool "${tool.name}" inputSchema.type must be "object", got "${schema.type}"`);
        }
      }

      if (issues.length > 0) {
        return {
          test: ctx.test,
          status: 'fail',
          message: issues.join('; '),
          duration_ms: 0,
          expected: 'inputSchema with type: "object"',
        };
      }

      return {
        test: ctx.test,
        status: 'pass',
        message: `All ${tools.length} tool(s) have valid JSON Schema inputSchema`,
        duration_ms: 0,
      };
    } catch (err) {
      return {
        test: ctx.test,
        status: 'error',
        message: `Validation failed: ${err instanceof Error ? err.message : String(err)}`,
        duration_ms: 0,
      };
    }
  }],

  /**
   * tools-003: tools/call returns valid content result.
   * Calls the first available tool with empty/minimal arguments.
   */
  ['tools-003', async (ctx: CheckContext): Promise<TestResult> => {
    try {
      // First, list tools to find one to call
      const listResponse = await ctx.sendRequest('tools/list');
      if (listResponse.error) {
        return {
          test: ctx.test,
          status: 'skip',
          message: 'Cannot test tools/call — tools/list failed',
          duration_ms: 0,
        };
      }

      const tools = ((listResponse.result as Record<string, unknown>)?.tools ?? []) as Array<Record<string, unknown>>;
      if (tools.length === 0) {
        return {
          test: ctx.test,
          status: 'skip',
          message: 'No tools available to test tools/call',
          duration_ms: 0,
        };
      }

      // Call the first tool — it may error due to missing args, but the
      // response structure should still be valid JSON-RPC
      const toolName = tools[0].name as string;
      const response = await ctx.sendRequest('tools/call', {
        name: toolName,
        arguments: {},
      });

      // Either a valid result or a valid error is acceptable
      if (response.error) {
        // This is a valid protocol error — the test is about structure, not success
        // Verify the error has proper structure
        if (typeof response.error.code !== 'number' || typeof response.error.message !== 'string') {
          return {
            test: ctx.test,
            status: 'fail',
            message: 'tools/call error response has invalid structure',
            duration_ms: 0,
            expected: '{ code: number, message: string }',
            actual: response.error,
          };
        }
        return {
          test: ctx.test,
          status: 'pass',
          message: `tools/call returned valid error: ${response.error.message}`,
          duration_ms: 0,
        };
      }

      const result = response.result as Record<string, unknown>;
      if (!result || !Array.isArray(result.content)) {
        return {
          test: ctx.test,
          status: 'fail',
          message: 'tools/call result must contain a "content" array',
          duration_ms: 0,
          expected: '{ content: [...] }',
          actual: result,
        };
      }

      // Validate content items
      const content = result.content as Array<Record<string, unknown>>;
      for (const item of content) {
        if (typeof item.type !== 'string') {
          return {
            test: ctx.test,
            status: 'fail',
            message: 'Each content item must have a "type" field',
            duration_ms: 0,
            expected: '"text" | "image" | "audio" | "resource"',
            actual: item.type,
          };
        }
      }

      return {
        test: ctx.test,
        status: 'pass',
        message: `tools/call returned ${content.length} content item(s)`,
        duration_ms: 0,
      };
    } catch (err) {
      return {
        test: ctx.test,
        status: 'error',
        message: `tools/call failed: ${err instanceof Error ? err.message : String(err)}`,
        duration_ms: 0,
      };
    }
  }],

  /**
   * tools-004: tools/call with unknown tool returns error.
   */
  ['tools-004', async (ctx: CheckContext): Promise<TestResult> => {
    try {
      const response = await ctx.sendRequest('tools/call', {
        name: '__mcp_test_nonexistent_tool_12345__',
        arguments: {},
      });

      if (response.error) {
        // Good — server correctly returned an error
        if (typeof response.error.code !== 'number') {
          return {
            test: ctx.test,
            status: 'fail',
            message: 'Error code must be an integer',
            duration_ms: 0,
            expected: 'integer error code',
            actual: response.error.code,
          };
        }
        return {
          test: ctx.test,
          status: 'pass',
          message: `Unknown tool correctly rejected with error code ${response.error.code}`,
          duration_ms: 0,
        };
      }

      // If the server returned a result with isError: true, that's also acceptable
      const result = response.result as Record<string, unknown>;
      if (result?.isError === true) {
        return {
          test: ctx.test,
          status: 'pass',
          message: 'Unknown tool returned result with isError: true',
          duration_ms: 0,
        };
      }

      return {
        test: ctx.test,
        status: 'fail',
        message: 'Server returned successful result for unknown tool — expected error',
        duration_ms: 0,
        expected: 'JSON-RPC error or isError: true',
        actual: result,
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
   * tools-005: tools/list supports cursor-based pagination.
   */
  ['tools-005', async (ctx: CheckContext): Promise<TestResult> => {
    try {
      const response = await ctx.sendRequest('tools/list');

      if (response.error) {
        return {
          test: ctx.test,
          status: 'skip',
          message: 'tools/list returned error — cannot test pagination',
          duration_ms: 0,
        };
      }

      const result = response.result as Record<string, unknown>;
      const nextCursor = result?.nextCursor as string | undefined;

      if (!nextCursor) {
        return {
          test: ctx.test,
          status: 'skip',
          message: 'Server did not return nextCursor — pagination not applicable',
          duration_ms: 0,
        };
      }

      // Fetch the next page
      const page2 = await ctx.sendRequest('tools/list', { cursor: nextCursor });

      if (page2.error) {
        return {
          test: ctx.test,
          status: 'fail',
          message: `Pagination request with cursor failed: ${page2.error.message}`,
          duration_ms: 0,
        };
      }

      const page2Result = page2.result as Record<string, unknown>;
      if (!page2Result || !Array.isArray(page2Result.tools)) {
        return {
          test: ctx.test,
          status: 'fail',
          message: 'Paginated tools/list must still return a "tools" array',
          duration_ms: 0,
        };
      }

      const page1Tools = (result.tools as Array<Record<string, unknown>>).map(t => t.name);
      const page2Tools = (page2Result.tools as Array<Record<string, unknown>>).map(t => t.name);

      const page1Set = new Set(page1Tools);
      const allSame = page2Tools.length > 0 && page2Tools.every(n => page1Set.has(n));

      if (allSame && page2Tools.length === page1Tools.length) {
        return {
          test: ctx.test,
          status: 'fail',
          message: 'Paginated response returned identical results to first page',
          duration_ms: 0,
        };
      }

      return {
        test: ctx.test,
        status: 'pass',
        message: `Pagination works: page 1 has ${page1Tools.length} tools, page 2 has ${page2Tools.length} tools`,
        duration_ms: 0,
      };
    } catch (err) {
      return {
        test: ctx.test,
        status: 'error',
        message: `Pagination test failed: ${err instanceof Error ? err.message : String(err)}`,
        duration_ms: 0,
      };
    }
  }],
];
