/**
 * Alternate screen buffer management.
 *
 * Entering the alternate screen buffer (\x1b[?1049h) provides a clean
 * full-screen canvas for the TUI. While in the alternate screen we also
 * enable alternate scroll mode (\x1b[?1007h), which lets terminals turn
 * mouse-wheel gestures into ordinary up/down cursor key input. This preserves
 * native text selection while keeping wheel scrolling available.
 *
 * Signal handlers use the standard Unix re-raise pattern:
 *   1. Run cleanup (leave alternate screen)
 *   2. Remove our handler so the default action is restored
 *   3. Re-send the signal so the process exits with the correct status
 */
export function enterAlternateScreen(
  stdout: { write: (s: string) => unknown } = process.stdout,
): () => void {
  stdout.write('\x1b[?1049h');
  stdout.write('\x1b[?1007h');

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    // Always disable legacy mouse tracking modes as a last-resort recovery path
    // in case an earlier session or crashed build left them enabled.
    stdout.write('\x1b[?1007l');
    stdout.write('\x1b[?1000l');
    stdout.write('\x1b[?1006l');
    stdout.write('\x1b[?1049l');
  };

  // Re-raise pattern: cleanup → remove handler → re-send signal.
  // This preserves the correct exit status (128 + signal number) and
  // lets the parent process see that we exited due to a signal.
  const makeSignalHandler = (signal: NodeJS.Signals) => {
    const handler = () => {
      cleanup();
      process.removeListener(signal, handler);
      process.kill(process.pid, signal);
    };
    return handler;
  };

  const onSIGINT = makeSignalHandler('SIGINT');
  const onSIGTERM = makeSignalHandler('SIGTERM');
  const onSIGHUP = makeSignalHandler('SIGHUP');

  process.on('SIGINT', onSIGINT);
  process.on('SIGTERM', onSIGTERM);
  process.on('SIGHUP', onSIGHUP);
  // 'exit' fires on normal exit — last-resort cleanup
  process.on('exit', cleanup);

  return cleanup;
}
