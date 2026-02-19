/**
 * MCP connection management via stdio transport.
 *
 * Spawns the MCP server as a child process and communicates over stdin/stdout
 * using newline-delimited JSON-RPC 2.0 messages.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import type { JsonRpcResponse, JsonRpcRequest, JsonRpcNotification } from './types.js';

interface PendingRequest {
  id: number;
  resolve: (msg: JsonRpcResponse) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class McpConnection {
  private process: ChildProcess | null = null;
  private readline: Interface | null = null;
  private pendingRequests = new Map<number, PendingRequest>();
  /** Queue for notifications / messages with no id (server-initiated) */
  private notificationQueue: unknown[] = [];
  private notificationWaiters: Array<(msg: unknown) => void> = [];
  private nextId = 1;
  private _closed = false;
  private stderrOutput = '';

  constructor(private serverCommand: string) {}

  /**
   * Start the server subprocess and set up I/O.
   * Retries with backoff if the server doesn't start immediately.
   */
  async start(): Promise<void> {
    const parts = this.serverCommand.split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    this.process = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    if (!this.process.stdout || !this.process.stdin) {
      throw new Error('Failed to open stdio on server process');
    }

    // Capture stderr for diagnostics
    if (this.process.stderr) {
      this.process.stderr.on('data', (chunk: Buffer) => {
        this.stderrOutput += chunk.toString();
        // Keep only last 4KB of stderr
        if (this.stderrOutput.length > 4096) {
          this.stderrOutput = this.stderrOutput.slice(-4096);
        }
      });
    }

    this.readline = createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity,
    });

    this.readline.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const msg = JSON.parse(trimmed);
        this.dispatchMessage(msg);
      } catch {
        // Non-JSON output — ignore (could be server debug output that leaked to stdout)
      }
    });

    this.process.on('exit', (code, signal) => {
      this._closed = true;
      // Reject all pending requests
      for (const [, pending] of this.pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Server process exited (code=${code}, signal=${signal})`));
      }
      this.pendingRequests.clear();
    });

    // Register cleanup handlers for SIGINT/SIGTERM
    const cleanup = () => {
      this.close().catch(() => {});
    };
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
    process.once('exit', cleanup);

    // Wait for the process to be ready with retry logic
    await this.waitForReady();
  }

  /**
   * Wait for the server process to be ready, with retries.
   */
  private async waitForReady(): Promise<void> {
    const maxWait = 3000; // up to 3 seconds
    const checkInterval = 100;
    let waited = 0;

    while (waited < maxWait) {
      if (this._closed) {
        const stderr = this.stderrOutput.trim();
        throw new Error(
          `Server process exited immediately${stderr ? `\nStderr: ${stderr.slice(0, 500)}` : ''}`
        );
      }

      // The process is alive, give it a moment
      await new Promise<void>((resolve) => setTimeout(resolve, checkInterval));
      waited += checkInterval;

      // After 200ms, assume it's ready if still alive
      if (waited >= 200 && !this._closed) {
        return;
      }
    }

    if (this._closed) {
      throw new Error('Server process exited during startup');
    }
  }

  /**
   * Dispatch an incoming message to the right handler based on whether
   * it has an 'id' field (response to a request) or not (notification).
   */
  private dispatchMessage(msg: unknown): void {
    const obj = msg as Record<string, unknown>;

    // If it has an 'id' and no 'method', it's a response to one of our requests
    if ('id' in obj && !('method' in obj)) {
      const id = obj.id as number;
      const pending = this.pendingRequests.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(id);
        pending.resolve(msg as JsonRpcResponse);
      }
      // If no pending request, drop it (stale response)
      return;
    }

    // It's a notification or server-initiated request
    if (this.notificationWaiters.length > 0) {
      const waiter = this.notificationWaiters.shift()!;
      waiter(msg);
    } else {
      this.notificationQueue.push(msg);
    }
  }

  /**
   * Send a JSON-RPC request and wait for the response with matching ID.
   */
  async sendRequest(method: string, params?: Record<string, unknown>, timeoutMs = 5000): Promise<JsonRpcResponse> {
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

    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Timeout waiting for response to ${method} (${timeoutMs}ms)`));
      }, timeoutMs);

      this.pendingRequests.set(id, { id, resolve, reject, timer });
      this.write(JSON.stringify(request));
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   */
  sendNotification(method: string, params?: Record<string, unknown>): void {
    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params ? { params } : {}),
    };
    this.write(JSON.stringify(notification));
  }

  /**
   * Send a raw string to the server's stdin.
   */
  sendRaw(data: string): void {
    this.write(data);
  }

  /**
   * Read the next notification/server-initiated message from the server.
   * This is for messages that are NOT responses to requests (those are
   * handled automatically by sendRequest).
   */
  readMessage(timeoutMs = 5000): Promise<unknown> {
    // Check notification queue first
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
   * Read a raw response for a specific raw request (used by error checks).
   * Waits for a message that has the given id, or any message if id not specified.
   */
  readRawResponse(timeoutMs = 5000): Promise<unknown> {
    return this.readMessage(timeoutMs);
  }

  /**
   * Perform the MCP initialization handshake.
   * Returns the initialize response result.
   */
  async initialize(timeoutMs = 10000): Promise<{
    protocolVersion: string;
    capabilities: Record<string, unknown>;
    serverInfo: { name: string; version?: string };
  }> {
    const response = await this.sendRequest('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: {
        name: 'mcp-test',
        version: '0.1.0',
      },
    }, timeoutMs);

    if (response.error) {
      throw new Error(`Initialize failed: ${response.error.message} (code ${response.error.code})`);
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
   * Close the connection and kill the server process.
   */
  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;

    // Reject all pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Connection closing'));
    }
    this.pendingRequests.clear();

    if (this.readline) {
      this.readline.close();
    }

    if (this.process && !this.process.killed) {
      // Close stdin first (graceful shutdown per spec)
      this.process.stdin?.end();

      // Wait briefly, then SIGTERM, then SIGKILL
      await new Promise<void>((resolve) => {
        const killTimer = setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.process.kill('SIGKILL');
          }
          resolve();
        }, 2000);

        const termTimer = setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.process.kill('SIGTERM');
          }
        }, 500);

        this.process!.on('exit', () => {
          clearTimeout(killTimer);
          clearTimeout(termTimer);
          resolve();
        });
      });
    }
  }

  get closed(): boolean {
    return this._closed;
  }

  get stderr(): string {
    return this.stderrOutput;
  }

  private write(data: string): void {
    if (this._closed || !this.process?.stdin?.writable) {
      throw new Error('Connection is closed');
    }
    this.process.stdin.write(data + '\n');
  }
}
