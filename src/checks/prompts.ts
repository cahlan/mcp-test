/**
 * Prompts check implementations.
 *
 * Validates prompts/list and prompts/get responses.
 */

import type { CheckFn, CheckContext, TestResult } from '../types.js';

export const promptsChecks: Array<[string, CheckFn]> = [
  /**
   * prompts-001: prompts/list returns valid prompt array.
   */
  ['prompts-001', async (ctx: CheckContext): Promise<TestResult> => {
    try {
      const response = await ctx.sendRequest('prompts/list');

      if (response.error) {
        return {
          test: ctx.test,
          status: 'fail',
          message: `prompts/list returned error: ${response.error.message}`,
          duration_ms: 0,
          actual: response.error,
        };
      }

      const result = response.result as Record<string, unknown>;
      if (!result || !Array.isArray(result.prompts)) {
        return {
          test: ctx.test,
          status: 'fail',
          message: 'prompts/list result must contain a "prompts" array',
          duration_ms: 0,
          expected: '{ prompts: [...] }',
          actual: result,
        };
      }

      const prompts = result.prompts as Array<Record<string, unknown>>;

      // Validate each prompt has required fields
      for (const prompt of prompts) {
        if (typeof prompt.name !== 'string' || prompt.name.length === 0) {
          return {
            test: ctx.test,
            status: 'fail',
            message: 'Each prompt MUST have a non-empty "name" string',
            duration_ms: 0,
            expected: 'non-empty string',
            actual: prompt.name,
          };
        }

        // Validate arguments array if present
        if (prompt.arguments !== undefined) {
          if (!Array.isArray(prompt.arguments)) {
            return {
              test: ctx.test,
              status: 'fail',
              message: `Prompt "${prompt.name}" arguments must be an array`,
              duration_ms: 0,
              actual: typeof prompt.arguments,
            };
          }

          for (const arg of prompt.arguments as Array<Record<string, unknown>>) {
            if (typeof arg.name !== 'string') {
              return {
                test: ctx.test,
                status: 'fail',
                message: `Prompt "${prompt.name}" has argument without "name" string`,
                duration_ms: 0,
              };
            }
          }
        }
      }

      return {
        test: ctx.test,
        status: 'pass',
        message: `${prompts.length} prompt(s) returned with valid structure`,
        duration_ms: 0,
      };
    } catch (err) {
      return {
        test: ctx.test,
        status: 'error',
        message: `prompts/list failed: ${err instanceof Error ? err.message : String(err)}`,
        duration_ms: 0,
      };
    }
  }],

  /**
   * prompts-002: prompts/get returns valid messages.
   */
  ['prompts-002', async (ctx: CheckContext): Promise<TestResult> => {
    try {
      // First list prompts to find one to get
      const listResponse = await ctx.sendRequest('prompts/list');
      if (listResponse.error) {
        return {
          test: ctx.test,
          status: 'skip',
          message: 'Cannot test prompts/get — prompts/list failed',
          duration_ms: 0,
        };
      }

      const prompts = ((listResponse.result as Record<string, unknown>)?.prompts ?? []) as Array<Record<string, unknown>>;
      if (prompts.length === 0) {
        return {
          test: ctx.test,
          status: 'skip',
          message: 'No prompts available to test prompts/get',
          duration_ms: 0,
        };
      }

      // Pick the first prompt, try without arguments first
      const promptName = prompts[0].name as string;
      const promptArgs = prompts[0].arguments as Array<Record<string, unknown>> | undefined;

      // Build minimal arguments from required args
      const args: Record<string, string> = {};
      if (promptArgs) {
        for (const arg of promptArgs) {
          if (arg.required) {
            args[arg.name as string] = 'test-value';
          }
        }
      }

      const response = await ctx.sendRequest('prompts/get', {
        name: promptName,
        arguments: args,
      });

      if (response.error) {
        return {
          test: ctx.test,
          status: 'fail',
          message: `prompts/get returned error: ${response.error.message}`,
          duration_ms: 0,
        };
      }

      const result = response.result as Record<string, unknown>;
      if (!result || !Array.isArray(result.messages)) {
        return {
          test: ctx.test,
          status: 'fail',
          message: 'prompts/get result must contain a "messages" array',
          duration_ms: 0,
          expected: '{ messages: [...] }',
          actual: result,
        };
      }

      const messages = result.messages as Array<Record<string, unknown>>;
      for (const msg of messages) {
        if (msg.role !== 'user' && msg.role !== 'assistant') {
          return {
            test: ctx.test,
            status: 'fail',
            message: `Message role must be "user" or "assistant", got "${msg.role}"`,
            duration_ms: 0,
          };
        }

        const content = msg.content as Record<string, unknown>;
        if (!content || typeof content.type !== 'string') {
          return {
            test: ctx.test,
            status: 'fail',
            message: 'Message content must have a "type" field',
            duration_ms: 0,
          };
        }
      }

      return {
        test: ctx.test,
        status: 'pass',
        message: `prompts/get returned ${messages.length} message(s) with valid structure`,
        duration_ms: 0,
      };
    } catch (err) {
      return {
        test: ctx.test,
        status: 'error',
        message: `prompts/get failed: ${err instanceof Error ? err.message : String(err)}`,
        duration_ms: 0,
      };
    }
  }],
  /**
   * prompts-003: prompts/list supports cursor-based pagination.
   */
  ['prompts-003', async (ctx: CheckContext): Promise<TestResult> => {
    try {
      const response = await ctx.sendRequest('prompts/list');

      if (response.error) {
        return {
          test: ctx.test,
          status: 'skip',
          message: 'prompts/list returned error — cannot test pagination',
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

      const page2 = await ctx.sendRequest('prompts/list', { cursor: nextCursor });

      if (page2.error) {
        return {
          test: ctx.test,
          status: 'fail',
          message: `Pagination request with cursor failed: ${page2.error.message}`,
          duration_ms: 0,
        };
      }

      const page2Result = page2.result as Record<string, unknown>;
      if (!page2Result || !Array.isArray(page2Result.prompts)) {
        return {
          test: ctx.test,
          status: 'fail',
          message: 'Paginated prompts/list must still return a "prompts" array',
          duration_ms: 0,
        };
      }

      const page1Prompts = (result.prompts as Array<Record<string, unknown>>).map(p => p.name);
      const page2Prompts = (page2Result.prompts as Array<Record<string, unknown>>).map(p => p.name);

      const page1Set = new Set(page1Prompts);
      const allSame = page2Prompts.length > 0 && page2Prompts.every(n => page1Set.has(n));

      if (allSame && page2Prompts.length === page1Prompts.length) {
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
        message: `Pagination works: page 1 has ${page1Prompts.length} prompts, page 2 has ${page2Prompts.length} prompts`,
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
