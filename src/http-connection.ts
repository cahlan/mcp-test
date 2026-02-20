/**
 * MCP connection management via Streamable HTTP transport.
 *
 * Connects to an MCP server over HTTP, sending JSON-RPC requests via POST
 * and handling both SSE (Server-Sent Events) and plain JSON responses.
 *
 * Implements the MCP Streamable HTTP transport specification (2025-03-26).
 * See: https://spec.modelcontextprotocol.io/specification/basic/transports/#streamable-http
 */

import type { JsonRpcResponse, JsonRpcRequest, JsonRpcNotification } from './types.js';

/**
 * Parse SSE (Server-Sent Events) text into individual data payloads.
 * SSE format: lines prefixed with "data:", separated by blank lines.
 * Returns parsed JSON objects from each complete event.
 */
function parseSseEvents(text: string): unknown[] {
  const results: unknown[] = [];
  const events = text.split(/\n\n+/);

  for (const event of events) {
    const lines = event.split('\n');
    let dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
      // Ignore event:, id:, retry:, and comment lines for our purposes
    }

    if (dataLines.length > 0) {
      const data = dataLines.join('\n');
      try {
        results.push(JSON.parse(data));
      } catch {
        // Not valid JSON yet, skip
      }
    }
  }

  return results;
}

export class McpHttpConnection {
  private sessionId: string | undefined;
  private _closed = false;
  private notificationQueue: unknown[] = [];
  private notificationWaiters: Array<(msg: unknown) => void> = [];
  private nextId = 1;
  private mcpEndpoint: string;

  constructor(private baseUrl: string) {
    // Ensure baseUrl doesn't end with /
    const base = baseUrl.replace(/\/+$/, '');
    this.mcpEndpoint = `${base}/mcp`;
  }

  /**
   * Start the connection by verifying the server is reachable.
   * Does not perform initialization — that's done separately via sendRequest.
   */
  async start(): Promise<void> {
    // Verify server is reachable with a simple request
    // We'll do a GET to see if the endpoint exists at all
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(this.mcpEndpoint, {
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      // 405 is expected if server doesn't support GET SSE stream — that's fine
      // Any response means the server is reachable
      // Drain the body to avoid resource leaks
      if (response.body) {
        try {
          await response.body.cancel();
        } catch {
          // Ignore cancel errors
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Server at ${this.baseUrl} is not reachable (timeout)`);
      }
      throw new Error(
        `Server at ${this.baseUrl} is not reachable: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Send a JSON-RPC request via HTTP POST and return the response.
   * Handles both SSE and plain JSON response formats.
   */
  async sendRequest(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = 5000,
  ): Promise<JsonRpcResponse> {
    if (this._closed) {
      throw new Error('Connection is closed');
    }

    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params ? { params } : {}),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      };
      if (this.sessionId) {
        headers['mcp-session-id'] = this.sessionId;
      }

      const response = await fetch(this.mcpEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timer);

      // Capture session ID from response
      const newSessionId = response.headers.get('mcp-session-id');
      if (newSessionId) {
        this.sessionId = newSessionId;
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          `HTTP ${response.status} from server: ${errorText || response.statusText}`
        );
      }

      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('text/event-stream')) {
        return await this.readSseResponse(response, id);
      } else if (contentType.includes('application/json')) {
        const data = await response.json();
        // Server might return an array of responses (batching)
        if (Array.isArray(data)) {
          const match = data.find(
            (r: JsonRpcResponse) => r.id === id,
          ) as JsonRpcResponse | undefined;
          if (match) return match;
          // If no matching id, return first response
          return data[0] as JsonRpcResponse;
        }
        return data as JsonRpcResponse;
      } else {
        // Try to parse as JSON anyway
        const text = await response.text();
        return JSON.parse(text) as JsonRpcResponse;
      }
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Timeout waiting for response to ${method} (${timeoutMs}ms)`);
      }
      throw err;
    }
  }

  /**
   * Read a JSON-RPC response from an SSE stream.
   */
  private async readSseResponse(
    response: Response,
    expectedId: number,
  ): Promise<JsonRpcResponse> {
    const body = response.body;
    if (!body) {
      throw new Error('No response body for SSE stream');
    }

    const reader = body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += value;

        // Try to parse complete SSE events from the buffer
        const events = parseSseEvents(buffer);
        for (const event of events) {
          const msg = event as Record<string, unknown>;

          // Check if this is the response to our request
          if ('id' in msg && !('method' in msg)) {
            if (msg.id === expectedId) {
              // Cancel the rest of the stream
              reader.cancel().catch(() => {});
              return msg as unknown as JsonRpcResponse;
            }
          }

          // Server-initiated notification — queue it
          if ('method' in msg) {
            this.dispatchNotification(msg);
          }
        }
      }
    } catch (err) {
      reader.cancel().catch(() => {});
      throw err;
    }

    throw new Error('SSE stream ended without a response');
  }

  /**
   * Dispatch a notification to waiting handlers or queue it.
   */
  private dispatchNotification(msg: unknown): void {
    if (this.notificationWaiters.length > 0) {
      const waiter = this.notificationWaiters.shift()!;
      waiter(msg);
    } else {
      this.notificationQueue.push(msg);
    }
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   * Per the spec, server responds with 202 Accepted for notifications.
   */
  sendNotification(method: string, params?: Record<string, unknown>): void {
    if (this._closed) return;

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params ? { params } : {}),
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    };
    if (this.sessionId) {
      headers['mcp-session-id'] = this.sessionId;
    }

    // Fire and forget — notifications don't expect a response body
    fetch(this.mcpEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(notification),
    })
      .then(async (response) => {
        // Capture session ID if provided
        const newSessionId = response.headers.get('mcp-session-id');
        if (newSessionId) {
          this.sessionId = newSessionId;
        }
        // Drain body
        if (response.body) {
          await response.body.cancel().catch(() => {});
        }
      })
      .catch(() => {
        // Ignore notification send errors
      });
  }

  /**
   * Send raw data — for HTTP transport, parse as JSON and send as POST.
   * Used by error-checking tests that send malformed requests.
   */
  sendRaw(data: string): void {
    if (this._closed) return;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    };
    if (this.sessionId) {
      headers['mcp-session-id'] = this.sessionId;
    }

    fetch(this.mcpEndpoint, {
      method: 'POST',
      headers,
      body: data,
    })
      .then(async (response) => {
        const newSessionId = response.headers.get('mcp-session-id');
        if (newSessionId) {
          this.sessionId = newSessionId;
        }

        const contentType = response.headers.get('content-type') || '';

        if (contentType.includes('text/event-stream') && response.body) {
          // Read SSE events and dispatch as notifications
          const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
          let buffer = '';
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              buffer += value;
              const events = parseSseEvents(buffer);
              for (const event of events) {
                this.dispatchNotification(event);
              }
            }
          } catch {
            // Stream ended
          }
        } else if (contentType.includes('application/json')) {
          const json = await response.json();
          this.dispatchNotification(json);
        } else {
          if (response.body) {
            await response.body.cancel().catch(() => {});
          }
        }
      })
      .catch(() => {
        // Ignore raw send errors
      });
  }

  /**
   * Read the next notification/server-initiated message.
   */
  readMessage(timeoutMs = 5000): Promise<unknown> {
    // Check queue first
    if (this.notificationQueue.length > 0) {
      return Promise.resolve(this.notificationQueue.shift());
    }

    if (this._closed) {
      return Promise.reject(new Error('Connection closed'));
    }

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.notificationWaiters.indexOf(waiter);
        if (idx !== -1) this.notificationWaiters.splice(idx, 1);
        reject(new Error(`Timeout waiting for message (${timeoutMs}ms)`));
      }, timeoutMs);

      const waiter = (msg: unknown) => {
        clearTimeout(timer);
        resolve(msg);
      };

      this.notificationWaiters.push(waiter);
    });
  }

  /**
   * Read a raw response (alias for readMessage, used by error checks).
   */
  readRawResponse(timeoutMs = 5000): Promise<unknown> {
    return this.readMessage(timeoutMs);
  }

  /**
   * Perform the MCP initialization handshake over HTTP.
   */
  async initialize(timeoutMs = 10000): Promise<{
    protocolVersion: string;
    capabilities: Record<string, unknown>;
    serverInfo: { name: string; version?: string };
  }> {
    const response = await this.sendRequest(
      'initialize',
      {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: {
          name: 'mcp-test',
          version: '0.1.0',
        },
      },
      timeoutMs,
    );

    if (response.error) {
      throw new Error(
        `Initialize failed: ${response.error.message} (code ${response.error.code})`,
      );
    }

    const result = response.result as {
      protocolVersion: string;
      capabilities: Record<string, unknown>;
      serverInfo: { name: string; version?: string };
    };

    // Send initialized notification
    this.sendNotification('notifications/initialized');

    // Small delay to let server process the notification
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    return result;
  }

  /**
   * Close the connection. For HTTP transport, optionally terminate the session.
   */
  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;

    // Reject all notification waiters
    for (const waiter of this.notificationWaiters) {
      // We can't reject a waiter directly since they're resolve functions.
      // They'll time out naturally.
    }
    this.notificationWaiters = [];

    // Attempt to terminate the session via DELETE per spec
    if (this.sessionId) {
      try {
        const headers: Record<string, string> = {
          'mcp-session-id': this.sessionId,
        };
        const response = await fetch(this.mcpEndpoint, {
          method: 'DELETE',
          headers,
        });
        if (response.body) {
          await response.body.cancel().catch(() => {});
        }
      } catch {
        // Ignore termination errors — server may not support DELETE
      }
    }
  }

  get closed(): boolean {
    return this._closed;
  }

  get stderr(): string {
    return ''; // No stderr for HTTP transport
  }
}
