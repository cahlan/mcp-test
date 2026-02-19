#!/usr/bin/env node

import { Command } from 'commander';
import { runSuite } from './runner.js';
import { formatHuman, formatJson, formatTap } from './reporter.js';
import type { RunOptions, Severity } from './types.js';

const program = new Command();

program
  .name('mcp-test')
  .description('Protocol compliance testing for MCP servers')
  .version('0.1.0');

program
  .command('run')
  .description('Run compliance test suite against an MCP server')
  .requiredOption('-s, --server <command>', 'Command to start the MCP server (e.g. "node my-server.js")')
  .option('-o, --output <format>', 'Output format: human | json | tap', 'human')
  .option('-v, --verbose', 'Show all tests including passing (default: failures only)')
  .option('--filter <category>', 'Only run tests in specified category (e.g. lifecycle, tools, errors)')
  .option('--timeout <ms>', 'Timeout per test in milliseconds', '5000')
  .option('--fail-on <severity>', 'Exit with code 1 if tests of this severity or higher fail: critical | major | minor', 'critical')
  .option('--suite <path>', 'Path to custom compliance suite YAML', undefined)
  .action(async (options) => {
    const runOptions: RunOptions = {
      server: options.server,
      output: options.output as 'human' | 'json' | 'tap',
      filter: options.filter,
      timeout: parseInt(options.timeout, 10),
      failOn: options.failOn as Severity,
      verbose: options.verbose ?? false,
    };

    try {
      const result = await runSuite(runOptions, options.suite);

      // Output results
      if (runOptions.output === 'json') {
        console.log(formatJson(result));
      } else if (runOptions.output === 'tap') {
        console.log(formatTap(result));
      } else {
        console.log(formatHuman(result, runOptions.verbose));
      }

      // Determine exit code based on --fail-on severity
      const severityOrder: Severity[] = ['minor', 'major', 'critical'];
      const failThreshold = severityOrder.indexOf(runOptions.failOn);
      const hasFailures = result.results.some(
        (r) =>
          (r.status === 'fail' || r.status === 'error') &&
          severityOrder.indexOf(r.test.severity) >= failThreshold
      );

      process.exit(hasFailures ? 1 : 0);
    } catch (err) {
      console.error('Fatal error:', err instanceof Error ? err.message : err);
      process.exit(2);
    }
  });

program
  .command('list')
  .description('List all tests in the compliance suite')
  .option('--filter <category>', 'Only show tests in specified category')
  .action(async (options) => {
    const { loadSuite } = await import('./runner.js');
    const suite = loadSuite();
    let tests = suite.tests;

    if (options.filter) {
      tests = tests.filter((t) => t.category === options.filter);
    }

    console.log(`\nMCP Compliance Suite v${suite.version} (spec ${suite.spec_version})\n`);
    console.log(`${tests.length} test(s):\n`);

    for (const t of tests) {
      const sev = t.severity === 'critical' ? '🔴' : t.severity === 'major' ? '🟡' : '🟢';
      console.log(`  ${sev} ${t.id.padEnd(16)} ${t.name}`);
    }
    console.log('');
  });

program.parse();
