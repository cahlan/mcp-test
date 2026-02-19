/**
 * Output formatting for mcp-test results.
 * Supports human-readable and JSON output modes.
 */

import chalk from 'chalk';
import type { SuiteResult, TestResult, Severity } from './types.js';

const LINE = '─'.repeat(60);

/**
 * Format results as human-readable terminal output.
 */
export function formatHuman(result: SuiteResult): string {
  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push(chalk.bold(`mcp-test v0.1.0`) + chalk.dim(` — Protocol Compliance Suite`));
  lines.push(chalk.dim(`Testing: ${result.server_command}`));
  lines.push(chalk.dim(LINE));
  lines.push('');

  // Group results by category
  const categories = new Map<string, TestResult[]>();
  for (const r of result.results) {
    const cat = r.test.category;
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(r);
  }

  // Category display names
  const categoryNames: Record<string, string> = {
    lifecycle: 'Lifecycle',
    versioning: 'Versioning',
    tools: 'Tools',
    resources: 'Resources',
    prompts: 'Prompts',
    errors: 'Errors',
    jsonrpc: 'JSON-RPC',
  };

  for (const [category, tests] of categories) {
    const displayName = categoryNames[category] || category.charAt(0).toUpperCase() + category.slice(1);
    lines.push(chalk.bold(`  ${displayName}`));

    for (const r of tests) {
      const icon = statusIcon(r.status);
      const id = chalk.dim(r.test.id.padEnd(16));
      const name = r.test.name;
      const dur = r.duration_ms > 0 ? chalk.dim(` ${r.duration_ms}ms`) : '';

      let statusDetail = '';
      if (r.status === 'skip' && r.message) {
        statusDetail = chalk.dim(` skipped`);
      } else if (r.status === 'error') {
        statusDetail = chalk.red(` error`);
      } else if (r.status === 'fail') {
        statusDetail = chalk.red(` failed`);
      }

      lines.push(`    ${icon} ${id} ${name}${dur}${statusDetail}`);

      // Show details for failures/errors indented below
      if (r.status === 'fail' || r.status === 'error') {
        if (r.message) {
          lines.push(chalk.red(`      ${r.message}`));
        }
        if (r.expected !== undefined) {
          lines.push(chalk.dim(`      Expected: ${formatValue(r.expected)}`));
        }
        if (r.actual !== undefined) {
          lines.push(chalk.dim(`      Actual:   ${truncate(formatValue(r.actual), 200)}`));
        }
      }
    }
    lines.push('');
  }

  // Summary
  lines.push(chalk.dim(LINE));

  const s = result.summary;

  // Results line
  const parts: string[] = [];
  if (s.passed > 0) parts.push(chalk.green(`${s.passed} passed`));
  if (s.failed > 0) parts.push(chalk.red(`${s.failed} failed`));
  if (s.errors > 0) parts.push(chalk.red(`${s.errors} error${s.errors > 1 ? 's' : ''}`));
  if (s.skipped > 0) parts.push(chalk.dim(`${s.skipped} skipped`));
  lines.push(`Results: ${parts.join(chalk.dim(' · '))}`);

  // Compliance score with color
  const scoreColor = s.compliance_score >= 90 ? chalk.green
    : s.compliance_score >= 70 ? chalk.yellow
    : chalk.red;

  // Calculate per-severity scores
  const criticalTests = getResultsBySeverity(result, 'critical');
  const majorTests = getResultsBySeverity(result, 'major');

  const criticalScore = computeScore(criticalTests);
  const majorScore = computeScore(majorTests);

  let scoreDetail = '';
  if (criticalTests.length > 0 || majorTests.length > 0) {
    const detailParts: string[] = [];
    if (criticalTests.length > 0) detailParts.push(`critical: ${criticalScore}%`);
    if (majorTests.length > 0) detailParts.push(`major: ${majorScore}%`);
    scoreDetail = chalk.dim(` (${detailParts.join(' · ')})`);
  }

  lines.push(scoreColor(`Compliance Score: ${s.compliance_score}%`) + scoreDetail);

  // Detailed failures section
  const failures = result.results.filter(r => r.status === 'fail' || r.status === 'error');
  if (failures.length > 0) {
    lines.push('');

    // Check if all failures have the same message (e.g., init failed)
    const uniqueMessages = new Set(failures.map(f => f.message));
    if (uniqueMessages.size === 1 && failures.length > 3) {
      // Collapse repeated failures
      const msg = failures[0].message;
      lines.push(chalk.red.bold(`✗ All ${failures.length} tests failed:`));
      lines.push(chalk.dim(`  ${msg}`));
    } else {
      lines.push(chalk.red.bold('✗ Failures:'));
      for (const f of failures) {
        lines.push(chalk.red(`  ${f.test.id}  ${f.test.name}`));
        if (f.message) {
          lines.push(chalk.dim(`    ${f.message}`));
        }
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Format results as JSON string for CI/CD consumption.
 */
export function formatJson(result: SuiteResult): string {
  return JSON.stringify(result, null, 2);
}

function statusIcon(status: string): string {
  switch (status) {
    case 'pass': return chalk.green('✓');
    case 'fail': return chalk.red('✗');
    case 'skip': return chalk.dim('─');
    case 'error': return chalk.red('⚠');
    default: return '?';
  }
}

function formatValue(val: unknown): string {
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '…';
}

function getResultsBySeverity(result: SuiteResult, severity: Severity): TestResult[] {
  return result.results.filter(r => r.test.severity === severity && r.status !== 'skip');
}

function computeScore(results: TestResult[]): number {
  if (results.length === 0) return 100;
  const passed = results.filter(r => r.status === 'pass').length;
  return Math.round((passed / results.length) * 100);
}
