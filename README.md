# mcp-test

[![MCP Compliance](https://img.shields.io/badge/MCP-compliant-green)](https://github.com/cahlan/mcp-test)
[![npm version](https://img.shields.io/npm/v/mcp-test)](https://www.npmjs.com/package/mcp-test)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Protocol compliance testing for MCP servers.**

The MCP ecosystem has hundreds of servers. No one knows if they actually follow the spec. Until now.

`mcp-test` runs 24 automated compliance checks against any MCP server over stdio, validating the initialization handshake, version negotiation, tool/resource/prompt schemas, error handling, and JSON-RPC correctness — all against the [official MCP specification](https://modelcontextprotocol.io/specification/2025-03-26).

## Quick Start

```bash
npx @cahlan/mcp-test run --server "node my-server.js"
```

That's it. One command. Works with any MCP server that speaks stdio.

## What It Looks Like

```
mcp-test v0.1.0 — Protocol Compliance Suite
Testing: node my-server.js
────────────────────────────────────────────────────────────

  Lifecycle
    ✓ lifecycle-001    Initialize handshake completes successfully
    ✓ lifecycle-002    Server accepts initialized notification
    ✓ lifecycle-003    Server response contains valid serverInfo
    ✓ lifecycle-004    Server responds to ping after initialization

  Versioning
    ✓ version-001      Server returns a valid protocol version
    ✓ version-002      Server capabilities object is well-formed

  Tools
    ✓ tools-001        tools/list returns valid tool array
    ✓ tools-002        Tool inputSchema is valid JSON Schema
    ✓ tools-003        tools/call returns valid content result
    ✓ tools-004        tools/call with unknown tool returns error
    ─ tools-005        tools/list supports cursor-based pagination  skipped

  ...

────────────────────────────────────────────────────────────
Results: 20 passed · 4 skipped
Compliance Score: 100% (critical: 100% · major: 100%)
```

By default, only failures are shown. Use `-v` for the full view above.

## Installation

```bash
# Run directly with npx (no install needed)
npx @cahlan/mcp-test run --server "node my-server.js"

# Or install globally
npm install -g mcp-test
mcp-test run --server "python my_server.py"
```

## Usage

### Run compliance tests

```bash
# Basic usage
mcp-test run --server "node dist/server.js"

# Show all tests (not just failures)
mcp-test run --server "node dist/server.js" --verbose

# TAP output for CI systems
mcp-test run --server "node dist/server.js" --output tap

# JSON output for programmatic use
mcp-test run --server "node dist/server.js" --output json

# Only test specific categories
mcp-test run --server "node dist/server.js" --filter tools
mcp-test run --server "node dist/server.js" --filter lifecycle

# Fail CI if any major or higher test fails
mcp-test run --server "node dist/server.js" --fail-on major

# Custom timeout per test
mcp-test run --server "node dist/server.js" --timeout 10000
```

### List available tests

```bash
mcp-test list
mcp-test list --filter errors
```

## What It Checks

24 tests across 7 categories:

| Category | Tests | What it validates |
|----------|-------|-------------------|
| **Lifecycle** | 4 | Initialize handshake, `initialized` notification, serverInfo structure, ping |
| **Versioning** | 2 | Protocol version format (YYYY-MM-DD), capabilities object structure |
| **Tools** | 5 | `tools/list` array, inputSchema validation, `tools/call` content, unknown tool error, pagination |
| **Resources** | 5 | `resources/list` array, `resources/read` contents, invalid URI error, pagination, templates |
| **Prompts** | 3 | `prompts/list` array, `prompts/get` messages, pagination |
| **Errors** | 3 | Unknown method error, malformed request handling, error response structure |
| **JSON-RPC** | 2 | Response ID matching, concurrent request handling |

### Severity Levels

- 🔴 **Critical** — MUST requirements. Server is broken without these.
- 🟡 **Major** — MUST/SHOULD requirements. Important for interoperability.
- 🟢 **Minor** — SHOULD/MAY requirements. Nice to have.

### Smart Skipping

Tests are automatically skipped when they don't apply:
- Tool tests skip if the server doesn't declare `tools` capability
- Resource tests skip if the server doesn't declare `resources` capability
- Pagination tests skip if the server doesn't return `nextCursor`

## CI Integration

### GitHub Actions

Add this to your MCP server repo:

```yaml
# .github/workflows/mcp-compliance.yml
name: MCP Protocol Compliance

on:
  push:
    branches: [main]
  pull_request:

jobs:
  compliance:
    name: MCP Compliance Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run build
      - name: Run MCP compliance tests
        run: npx @cahlan/mcp-test@latest run --server "node dist/server.js" --output tap --fail-on critical
```

### TAP Output

Use `--output tap` for [TAP](https://testanything.org/) format, supported natively by most CI systems:

```
TAP version 14
1..24
ok 1 - lifecycle-001 Initialize handshake completes successfully
ok 2 - lifecycle-002 Server accepts initialized notification
not ok 3 - tools-001 tools/list returns valid tool array
  ---
  message: tools/list result must contain a "tools" array
  severity: critical
  ...
# Tests: 24, Passed: 20, Failed: 1, Errors: 0, Skipped: 3
# Compliance Score: 95%
```

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All tests passed (at the configured `--fail-on` severity level) |
| `1` | One or more tests failed at or above the `--fail-on` threshold |
| `2` | Fatal error (server wouldn't start, bad arguments, etc.) |

## Compliance Score

The compliance score is the percentage of **critical + major** tests that pass (skipped tests don't count). A server can score 100% even if minor tests are skipped.

```
Compliance Score: 92% (critical: 100% · major: 83%)
```

## Found a Bug in Your Server?

Check the [MCP specification](https://modelcontextprotocol.io/specification/2025-03-26) for the authoritative requirements. Each test links to the relevant spec section.

Common issues we've found:
- **tools/list returns object instead of array** — `{ tools: { myTool: ... } }` instead of `{ tools: [...] }`
- **Error codes are strings** — JSON-RPC requires integer error codes (`-32601`, not `"NOT_FOUND"`)
- **Missing `jsonrpc: "2.0"` in responses** — every JSON-RPC message must include this field
- **Ping response ID mismatch** — response ID must match the request ID exactly

## Badge

Show your server is compliant:

```markdown
[![MCP Compliance](https://img.shields.io/badge/MCP-compliant-green)](https://github.com/cahlan/mcp-test)
```

## Contributing

Found a spec requirement we're not testing? [Open an issue](https://github.com/cahlan/mcp-test/issues).

## License

MIT
