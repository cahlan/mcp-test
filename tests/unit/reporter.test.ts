import { describe, it, expect } from 'vitest';
import { formatJson } from '../../src/reporter.js';
import type { SuiteResult } from '../../src/types.js';

const mockResult: SuiteResult = {
  server_command: 'node test-server.js',
  timestamp: '2025-01-01T00:00:00.000Z',
  duration_ms: 1234,
  protocol_version: '2025-03-26',
  summary: {
    total: 3,
    passed: 2,
    failed: 1,
    skipped: 0,
    errors: 0,
    compliance_score: 75,
  },
  results: [
    {
      test: {
        id: 'lifecycle-001',
        category: 'lifecycle',
        name: 'Initialize handshake completes successfully',
        description: 'Test description',
        severity: 'critical',
        spec_ref: 'https://example.com',
      },
      status: 'pass',
      duration_ms: 142,
    },
    {
      test: {
        id: 'lifecycle-002',
        category: 'lifecycle',
        name: 'Server accepts initialized notification',
        description: 'Test description',
        severity: 'critical',
        spec_ref: 'https://example.com',
      },
      status: 'pass',
      duration_ms: 50,
    },
    {
      test: {
        id: 'tools-001',
        category: 'tools',
        name: 'tools/list returns valid tool array',
        description: 'Test description',
        severity: 'critical',
        spec_ref: 'https://example.com',
      },
      status: 'fail',
      message: 'tools/list result must contain a "tools" array',
      duration_ms: 89,
      expected: '{ tools: [...] }',
      actual: '{}',
    },
  ],
};

describe('Reporter', () => {
  describe('formatJson', () => {
    it('should produce valid JSON', () => {
      const output = formatJson(mockResult);
      const parsed = JSON.parse(output);
      expect(parsed).toBeDefined();
      expect(parsed.summary.total).toBe(3);
    });

    it('should include all results', () => {
      const output = formatJson(mockResult);
      const parsed = JSON.parse(output);
      expect(parsed.results).toHaveLength(3);
    });

    it('should include compliance score', () => {
      const output = formatJson(mockResult);
      const parsed = JSON.parse(output);
      expect(parsed.summary.compliance_score).toBe(75);
    });

    it('should preserve test metadata', () => {
      const output = formatJson(mockResult);
      const parsed = JSON.parse(output);
      expect(parsed.results[0].test.id).toBe('lifecycle-001');
      expect(parsed.results[0].test.severity).toBe('critical');
    });

    it('should include failure details', () => {
      const output = formatJson(mockResult);
      const parsed = JSON.parse(output);
      const failed = parsed.results.find((r: { status: string }) => r.status === 'fail');
      expect(failed).toBeDefined();
      expect(failed.message).toBeDefined();
      expect(failed.expected).toBeDefined();
      expect(failed.actual).toBeDefined();
    });
  });
});
