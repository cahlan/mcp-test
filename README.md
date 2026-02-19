# mcp-test

**Protocol compliance testing CLI for MCP servers.**

[![npm version](https://img.shields.io/npm/v/mcp-test)](https://www.npmjs.com/package/mcp-test)

Automated testing tool that validates [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server implementations against the official specification. No more manual testing with the Inspector — get a compliance score in seconds.

## The Problem

MCP is a powerful protocol, but there's no automated way to verify server compliance:

- **No CI/CD integration** — can't catch regressions in your MCP server
- **No batch testing** — manually clicking through the Inspector for each feature
- **No compliance scoring** — no way to quantify how well your server follows the spec
- **No standard test suite** — every developer reinvents testing

## Quick Start

```bash
npx mcp-test run --server "node my-server.js"
```

That's it. No global install required.

### Output

```
  MCP Protocol Compliance Test
  Server: node my-server.js
  Protocol: 2025-03-26

  ──────────────────────────────────────

  LIFECYCLE

  ✓ lifecycle-001    Initialize handshake completes successfully (142ms)  CRITICAL
  ✓ lifecycle-002    Server accepts initialized notification (23ms)  CRITICAL
  ✓ lifecycle-003    Server response contains valid serverInfo (5ms)  CRITICAL
  ✓ lifecycle-004    Server responds to ping after initialization (12ms)  CRITICAL

  TOOLS

  ✓ tools-001        tools/list returns valid tool array (89ms)  CRITICAL
  ✓ tools-002        Tool inputSchema is valid JSON Schema (45ms)  MAJOR
  ✗ tools-003        tools/call returns valid content result (201ms)  MAJOR
    tools/call result must contain a "content" array

  ──────────────────────────────────────

  12/15 passed | 1 failed | 2 skipped | 850ms total
  Compliance Score: 85%
```

## CLI Options

```
mcp-test run [options]

Options:
  -s, --server <command>    Command to start the MCP server (required)
  -o, --output <format>     Output format: human | json (default: "human")
  --filter <category>       Only run tests in a specific category
  --timeout <ms>            Timeout per test in milliseconds (default: "5000")
  --fail-on <severity>      Exit code 1 if tests of this severity fail:
                            critical | major | minor (default: "critical")
  --suite <path>            Path to custom compliance suite YAML

mcp-test list [options]

Options:
  --filter <category>       Only show tests in a specific category
```

## Test Categories

### Lifecycle (4 tests)
Validates the initialization handshake, `serverInfo` structure, `initialized` notification handling, and ping responsiveness.

### Versioning (2 tests)
Checks protocol version negotiation and capability object structure.

### Tools (4 tests)
Tests `tools/list` response format, `inputSchema` validity (JSON Schema with `type: "object"`), `tools/call` content results, and unknown tool error handling.

### Resources (3 tests)
Validates `resources/list` format, `resources/read` content structure (text/blob), and error handling for invalid URIs.

### Prompts (2 tests)
Tests `prompts/list` format and `prompts/get` message structure (role + typed content).

### Errors & JSON-RPC (5 tests)
Verifies unknown method handling (-32601), malformed request handling, error response structure (code + message), response ID matching, and concurrent request handling.

## Compliance Score

The compliance score is calculated as:

```
(critical + major tests passing) / (critical + major tests run) × 100%
```

- **Minor** tests don't affect the score (they're informational)
- **Skipped** tests (e.g., server doesn't declare `tools` capability) are excluded from the denominator
- A score of **100%** means full compliance with all applicable spec requirements

## CI/CD Integration

### GitHub Actions

```yaml
name: MCP Compliance Check
on: [push, pull_request]

jobs:
  mcp-compliance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Install dependencies
        run: npm install
      - name: Run MCP compliance tests
        run: npx mcp-test run --server "node my-server.js" --output json --fail-on critical
```

### JSON Output

Use `--output json` for machine-readable results:

```json
{
  "server_command": "node my-server.js",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "duration_ms": 1234,
  "protocol_version": "2025-03-26",
  "summary": {
    "total": 20,
    "passed": 18,
    "failed": 1,
    "skipped": 1,
    "errors": 0,
    "compliance_score": 94
  },
  "results": [...]
}
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0    | All tests at or above `--fail-on` severity passed |
| 1    | One or more tests at or above `--fail-on` severity failed |
| 2    | Fatal error (couldn't connect to server, etc.) |

## Custom Test Suites

You can provide your own compliance suite YAML:

```bash
mcp-test run --server "node my-server.js" --suite ./my-tests.yaml
```

See `tests/compliance-suite.yaml` for the format.

## MCP Spec Reference

This tool tests against the [MCP specification (2025-03-26)](https://modelcontextprotocol.io/specification/2025-03-26):

- [Lifecycle](https://modelcontextprotocol.io/specification/2025-03-26/basic/lifecycle) — initialization, capability negotiation, shutdown
- [Messages](https://modelcontextprotocol.io/specification/2025-03-26/basic) — JSON-RPC 2.0 message format
- [Tools](https://modelcontextprotocol.io/specification/2025-03-26/server/tools) — tool listing, calling, schemas
- [Resources](https://modelcontextprotocol.io/specification/2025-03-26/server/resources) — resource listing, reading
- [Prompts](https://modelcontextprotocol.io/specification/2025-03-26/server/prompts) — prompt templates
- [Transports](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports) — stdio, Streamable HTTP

## Development

```bash
git clone https://github.com/yourname/mcp-test
cd mcp-test
npm install
npm run build
npm run dev -- run --server "node ../your-server.js"
npm test
```

## License

MIT
