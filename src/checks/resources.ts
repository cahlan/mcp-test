/**
 * Resources check implementations.
 *
 * Validates resources/list, resources/read, and error handling.
 */

import type { CheckFn, CheckContext, TestResult } from '../types.js';

export const resourcesChecks: Array<[string, CheckFn]> = [
  /**
   * resources-001: resources/list returns valid resource array.
   */
  ['resources-001', async (ctx: CheckContext): Promise<TestResult> => {
    try {
      const response = await ctx.sendRequest('resources/list');

      if (response.error) {
        return {
          test: ctx.test,
          status: 'fail',
          message: `resources/list returned error: ${response.error.message}`,
          duration_ms: 0,
          actual: response.error,
        };
      }

      const result = response.result as Record<string, unknown>;
      if (!result || !Array.isArray(result.resources)) {
        return {
          test: ctx.test,
          status: 'fail',
          message: 'resources/list result must contain a "resources" array',
          duration_ms: 0,
          expected: '{ resources: [...] }',
          actual: result,
        };
      }

      const resources = result.resources as Array<Record<string, unknown>>;

      // Validate each resource has required fields
      for (const resource of resources) {
        if (typeof resource.uri !== 'string' || resource.uri.length === 0) {
          return {
            test: ctx.test,
            status: 'fail',
            message: 'Each resource MUST have a non-empty "uri" string',
            duration_ms: 0,
            expected: 'string URI',
            actual: resource.uri,
          };
        }
        if (typeof resource.name !== 'string' || resource.name.length === 0) {
          return {
            test: ctx.test,
            status: 'fail',
            message: `Resource "${resource.uri}" MUST have a non-empty "name" string`,
            duration_ms: 0,
            expected: 'string',
            actual: resource.name,
          };
        }
      }

      return {
        test: ctx.test,
        status: 'pass',
        message: `${resources.length} resource(s) returned with valid structure`,
        duration_ms: 0,
      };
    } catch (err) {
      return {
        test: ctx.test,
        status: 'error',
        message: `resources/list failed: ${err instanceof Error ? err.message : String(err)}`,
        duration_ms: 0,
      };
    }
  }],

  /**
   * resources-002: resources/read returns valid contents.
   */
  ['resources-002', async (ctx: CheckContext): Promise<TestResult> => {
    try {
      // First list resources to find one to read
      const listResponse = await ctx.sendRequest('resources/list');
      if (listResponse.error) {
        return {
          test: ctx.test,
          status: 'skip',
          message: 'Cannot test resources/read — resources/list failed',
          duration_ms: 0,
        };
      }

      const resources = ((listResponse.result as Record<string, unknown>)?.resources ?? []) as Array<Record<string, unknown>>;
      if (resources.length === 0) {
        return {
          test: ctx.test,
          status: 'skip',
          message: 'No resources available to test resources/read',
          duration_ms: 0,
        };
      }

      const uri = resources[0].uri as string;
      const response = await ctx.sendRequest('resources/read', { uri });

      if (response.error) {
        return {
          test: ctx.test,
          status: 'fail',
          message: `resources/read returned error: ${response.error.message}`,
          duration_ms: 0,
        };
      }

      const result = response.result as Record<string, unknown>;
      if (!result || !Array.isArray(result.contents)) {
        return {
          test: ctx.test,
          status: 'fail',
          message: 'resources/read result must contain a "contents" array',
          duration_ms: 0,
          expected: '{ contents: [...] }',
          actual: result,
        };
      }

      const contents = result.contents as Array<Record<string, unknown>>;
      for (const item of contents) {
        if (typeof item.uri !== 'string') {
          return {
            test: ctx.test,
            status: 'fail',
            message: 'Each content item must have a "uri" field',
            duration_ms: 0,
          };
        }

        // Must have either text or blob
        if (item.text === undefined && item.blob === undefined) {
          return {
            test: ctx.test,
            status: 'fail',
            message: 'Each content item must have either "text" or "blob" field',
            duration_ms: 0,
            expected: '"text" (string) or "blob" (base64 string)',
            actual: item,
          };
        }
      }

      return {
        test: ctx.test,
        status: 'pass',
        message: `resources/read returned ${contents.length} content item(s)`,
        duration_ms: 0,
      };
    } catch (err) {
      return {
        test: ctx.test,
        status: 'error',
        message: `resources/read failed: ${err instanceof Error ? err.message : String(err)}`,
        duration_ms: 0,
      };
    }
  }],

  /**
   * resources-003: resources/read with invalid URI returns error.
   */
  ['resources-003', async (ctx: CheckContext): Promise<TestResult> => {
    try {
      const response = await ctx.sendRequest('resources/read', {
        uri: 'mcp-test://nonexistent/invalid-resource-uri-12345',
      });

      if (response.error) {
        if (typeof response.error.code !== 'number') {
          return {
            test: ctx.test,
            status: 'fail',
            message: 'Error code must be an integer',
            duration_ms: 0,
          };
        }
        return {
          test: ctx.test,
          status: 'pass',
          message: `Invalid URI correctly rejected with error code ${response.error.code}`,
          duration_ms: 0,
        };
      }

      // A result with empty contents is also acceptable
      const result = response.result as Record<string, unknown>;
      const contents = result?.contents as unknown[];
      if (Array.isArray(contents) && contents.length === 0) {
        return {
          test: ctx.test,
          status: 'pass',
          message: 'Server returned empty contents for invalid URI (acceptable)',
          duration_ms: 0,
        };
      }

      return {
        test: ctx.test,
        status: 'fail',
        message: 'Server returned data for nonexistent resource — expected error or empty',
        duration_ms: 0,
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
];
