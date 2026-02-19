/**
 * Output formatting for mcp-test results.
 * Supports human-readable and JSON output modes.
 */

import chalk from 'chalk';
import type { SuiteResult, TestResult, Severity } from './types.js';

/**
 * Format results as human-readable terminal output.
 */
export function formatHuman(result: SuiteResult): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(chalk.bold('  MCP Protocol Compliance Test'));
  lines.push(chalk.dim(`  Server: ${result.server_command}`));
  lines.push(chalk.dim(`  Protocol: ${result.protocol_version}`));
  lines.push(chalk.dim(`  Time: ${result.timestamp}`));
  lines.push('');
  lines.push(chalk.dim('  ─'.repeat(35)));
  lines.push('');

  // Group results by category
  const categories = new Map<string, TestResult[]>();
  for (const r of result.results) {
    const cat = r.test.category;
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(r);
  }

  for (const [category, tests] of categories) {
    lines.push(chalk.bold(`  ${category.toUpperCase()}`));
    lines.push('');

    for (const r of tests) {
      const icon = statusIcon(r.status);
      const dur = chalk.dim(`(${r.duration_ms}ms)`);
      const sev = severityBadge(r.test.severity);

      lines.push(`  ${icon} ${r.test.id.padEnd(16)} ${r.test.name} ${dur} ${sev}`);

      if (r.status === 'fail' || r.status === 'error') {
        if (r.message) {
          lines.push(chalk.red(`    ${r.message}`));
        }
        if (r.expected !== undefined) {
          lines.push(chalk.dim(`    Expected: ${formatValue(r.expected)}`));
        }
        if (r.actual !== undefined) {
          lines.push(chalk.dim(`    Actual:   ${formatValue(r.actual)}`));
        }
      }
    }
    lines.push('');
  }

  // Summary
  lines.push(chalk.dim('  ─'.repeat(35)));
  lines.push('');

  const s = result.summary;
  const passColor = s.failed === 0 && s.errors === 0 ? chalk.green : chalk.yellow;
  lines.push(passColor(`  ${s.passed}/${s.total} passed`) +
    (s.failed > 0 ? chalk.red(` | ${s.failed} failed`) : '') +
    (s.errors > 0 ? chalk.red(` | ${s.errors} errors`) : '') +
    (s.skipped > 0 ? chalk.dim(` | ${s.skipped} skipped`) : '') +
    chalk.dim(` | ${result.duration_ms}ms total`)
  );

  const scoreColor = s.compliance_score >= 90 ? chalk.green
    : s.compliance_score >= 70 ? chalk.yellow
    : chalk.red;
  lines.push(scoreColor(`  Compliance Score: ${s.compliance_score}%`));
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
    case 'skip': return chalk.dim('○');
    case 'error': return chalk.red('⚠');
    default: return '?';
  }
}

function severityBadge(severity: Severity): string {
  switch (severity) {
    case 'critical': return chalk.bgRed.white(' CRITICAL ');
    case 'major': return chalk.bgYellow.black(' MAJOR ');
    case 'minor': return chalk.dim('[minor]');
  }
}

function formatValue(val: unknown): string {
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}
