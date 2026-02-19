/**
 * MCP connection management via stdio transport.
 *
 * Spawns the MCP server as a child process and communicates over stdin/stdout
 * using newline-delimited JSON-RPC 2.0 messages.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import type { JsonRpcResponse, JsonRpcRequest, JsonRpcNotification } from './types.js';

export class McpConnection {
  private process: ChildProcess | null = null;
  private readline: Interface | null = null;
  private messageQueue: unknown[] = [];
  private waiters: Array<(msg: unknown) => void> = [];
  private nextId = 1;
  private _closed = false;

  constructor(private serverCommand: string) {}

  /**
   * Start the server subprocess and set up I/O.
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

    this.readline = createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity,
    });

    this.readline.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const msg = JSON.parse(trimmed);
        if (this.waiters.length > 0) {
          const waiter = this.waiters.shift()!;
          waiter(msg);
        } else {
          this.messageQueue.push(msg);
        }
      } catch {
        // Non-JSON output — ignore (could be server debug output that leaked to stdout)
      }
    });

    this.process.on('exit', () => {
      this._closed = true;
    });

    // Give the process a moment to start
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    if (this._closed) {
      throw new Error('Server process exited immediately');
    }
  }

  /**
   * Send a JSON-RPC request and wait for the response.
   */
  async sendRequest(method: string, params?: Record<string, unknown>, timeoutMs = 5000): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params ? { params } : {}),
    };

    this.write(JSON.stringify(request));
    const response = await this.readMessage(timeoutMs) as JsonRpcResponse;
    return response;
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
   * Read the next message from the server's stdout.
   */
  readMessage(timeoutMs = 5000): Promise<unknown> {
    // Check queue first
    if (this.messageQueue.length > 0) {
      return Promise.resolve(this.messageQueue.shift());
    }

    if (this._closed) {
      return Promise.reject(new Error('Connection closed'));
    }

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(waiter);
        if (idx !== -1) this.waiters.splice(idx, 1);
        reject(new Error(`Timeout waiting for response (${timeoutMs}ms)`));
      }, timeoutMs);

      const waiter = (msg: unknown) => {
        clearTimeout(timer);
        resolve(msg);
      };

      this.waiters.push(waiter);
    });
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

    if (this.readline) {
      this.readline.close();
    }

    if (this.process && !this.process.killed) {
      // Close stdin first (graceful shutdown per spec)
      this.process.stdin?.end();

      // Wait briefly, then SIGTERM
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.process.kill('SIGTERM');
          }
          setTimeout(() => {
            if (this.process && !this.process.killed) {
              this.process.kill('SIGKILL');
            }
            resolve();
          }, 1000);
        }, 500);

        this.process!.on('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    // Reject all pending waiters
    for (const waiter of this.waiters) {
      // Trigger timeout indirectly
    }
    this.waiters = [];
  }

  get closed(): boolean {
    return this._closed;
  }

  private write(data: string): void {
    if (this._closed || !this.process?.stdin?.writable) {
      throw new Error('Connection is closed');
    }
    this.process.stdin.write(data + '\n');
  }
}
