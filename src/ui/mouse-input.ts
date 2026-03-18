import { Transform } from 'node:stream';

export interface MouseInputFilterResult {
  output: string;
  pending: string;
}

export interface TerminalInputHandle {
  stdin: NodeJS.ReadStream;
  cleanup: () => void;
}

const SGR_MOUSE_PREFIX = '\x1b[<';
const SGR_MOUSE_PATTERN = /^\x1b\[<(\d+);(\d+);(\d+)([mM])/;
const UP_ARROW = '\x1b[A';
const DOWN_ARROW = '\x1b[B';
const DEFAULT_WHEEL_LINES = 3;

function decodeWheelDirection(buttonCode: number): 'up' | 'down' | null {
  if ((buttonCode & 64) === 0) {
    return null;
  }

  const wheelButton = buttonCode & 0b11;
  if (wheelButton === 0) return 'up';
  if (wheelButton === 1) return 'down';
  return null;
}

export function filterMouseTrackingInput(
  chunk: string,
  pending = '',
  wheelLines = DEFAULT_WHEEL_LINES,
): MouseInputFilterResult {
  const input = pending + chunk;
  let output = '';
  let cursor = 0;

  while (cursor < input.length) {
    const start = input.indexOf(SGR_MOUSE_PREFIX, cursor);
    if (start === -1) {
      output += input.slice(cursor);
      return { output, pending: '' };
    }

    output += input.slice(cursor, start);

    const tail = input.slice(start);
    const terminatorOffset = tail.search(/[mM]/);
    if (terminatorOffset === -1) {
      return { output, pending: tail };
    }

    const candidate = tail.slice(0, terminatorOffset + 1);
    const match = SGR_MOUSE_PATTERN.exec(candidate);
    cursor = start + candidate.length;

    if (!match) {
      // Drop malformed CSI <... mouse payloads so they do not leak into Ink.
      continue;
    }

    const buttonCode = Number(match[1]);
    const direction = decodeWheelDirection(buttonCode);
    if (direction === 'up') {
      output += UP_ARROW.repeat(wheelLines);
    } else if (direction === 'down') {
      output += DOWN_ARROW.repeat(wheelLines);
    }
    // Non-wheel mouse events are intentionally swallowed in capture mode.
  }

  return { output, pending: '' };
}

class MouseCaptureInputStream extends Transform {
  private pending = '';
  private cleaned = false;

  constructor(
    private readonly source: NodeJS.ReadStream,
    private readonly wheelLines: number,
  ) {
    super();
    source.pipe(this);
  }

  _transform(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const result = filterMouseTrackingInput(text, this.pending, this.wheelLines);
    this.pending = result.pending;
    if (result.output) {
      this.push(result.output, 'utf8');
    }
    callback();
  }

  dispose(): void {
    if (this.cleaned) return;
    this.cleaned = true;
    this.source.unpipe(this);
    this.end();
  }
}

function attachReadStreamMethods(
  proxy: MouseCaptureInputStream,
  source: NodeJS.ReadStream,
): NodeJS.ReadStream {
  const stdin = proxy as unknown as NodeJS.ReadStream & {
    cleanup?: () => void;
  };

  stdin.isTTY = source.isTTY;
  stdin.setRawMode = source.setRawMode?.bind(source);
  stdin.ref = source.ref?.bind(source);
  stdin.unref = source.unref?.bind(source);
  stdin.pause = source.pause?.bind(source);
  stdin.resume = source.resume?.bind(source);
  stdin.cleanup = () => proxy.dispose();

  return stdin;
}

export function createTerminalInput(
  source: NodeJS.ReadStream = process.stdin,
): TerminalInputHandle {
  const proxy = new MouseCaptureInputStream(source, DEFAULT_WHEEL_LINES);
  return {
    stdin: attachReadStreamMethods(proxy, source),
    cleanup: () => proxy.dispose(),
  };
}
