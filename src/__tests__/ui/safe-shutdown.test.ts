import { describe, expect, it, vi } from 'vitest';
import { performSafeShutdown } from '../../ui/safe-shutdown.js';

describe('performSafeShutdown', () => {
  it('interrupts output, kills all adapters, saves state, then exits', async () => {
    const outputManager = { interrupt: vi.fn() };
    const coder = { kill: vi.fn().mockResolvedValue(undefined) };
    const reviewer = { kill: vi.fn().mockResolvedValue(undefined) };
    const god = { kill: vi.fn().mockResolvedValue(undefined) };
    const beforeExit = vi.fn();
    const onExit = vi.fn();

    await performSafeShutdown({
      outputManager,
      adapters: [coder, reviewer, god],
      beforeExit,
      onExit,
    });

    expect(outputManager.interrupt).toHaveBeenCalledOnce();
    expect(coder.kill).toHaveBeenCalledOnce();
    expect(reviewer.kill).toHaveBeenCalledOnce();
    expect(god.kill).toHaveBeenCalledOnce();

    const saveOrder = beforeExit.mock.invocationCallOrder[0];
    const exitOrder = onExit.mock.invocationCallOrder[0];
    expect(saveOrder).toBeLessThan(exitOrder);
  });

  it('kills all four adapters including watchdog', async () => {
    const coder = { kill: vi.fn().mockResolvedValue(undefined) };
    const reviewer = { kill: vi.fn().mockResolvedValue(undefined) };
    const god = { kill: vi.fn().mockResolvedValue(undefined) };
    const watchdog = { kill: vi.fn().mockResolvedValue(undefined) };
    const onExit = vi.fn();

    await performSafeShutdown({
      adapters: [coder, reviewer, god, watchdog],
      onExit,
    });

    expect(coder.kill).toHaveBeenCalledOnce();
    expect(reviewer.kill).toHaveBeenCalledOnce();
    expect(god.kill).toHaveBeenCalledOnce();
    expect(watchdog.kill).toHaveBeenCalledOnce();
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('still exits when one of the adapter kills rejects', async () => {
    const onExit = vi.fn();

    await performSafeShutdown({
      adapters: [
        { kill: vi.fn().mockRejectedValue(new Error('already dead')) },
        { kill: vi.fn().mockResolvedValue(undefined) },
      ],
      onExit,
    });

    expect(onExit).toHaveBeenCalledOnce();
  });
});
