/**
 * Tests for DirectoryPicker component.
 * Source: FR-019 (AC-065, AC-066, AC-067)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

// Mock node:fs at module level
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { existsSync, readFileSync } from 'node:fs';
import { DirectoryPicker } from '../../ui/components/DirectoryPicker.js';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

beforeEach(() => {
  vi.resetAllMocks();
  // Default: no MRU file, no discovered repos
  mockExistsSync.mockReturnValue(false);
});

describe('DirectoryPicker', () => {
  it('renders the title', () => {
    const { lastFrame } = render(
      <DirectoryPicker onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    const output = lastFrame()!;
    expect(output).toContain('Select Project Directory');
  });

  it('renders input path prompt', () => {
    const { lastFrame } = render(
      <DirectoryPicker onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    const output = lastFrame()!;
    expect(output).toContain('Path:');
  });

  it('renders tab hint', () => {
    const { lastFrame } = render(
      <DirectoryPicker onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    const output = lastFrame()!;
    expect(output).toContain('Tab');
  });

  it('renders Recent section header', () => {
    const { lastFrame } = render(
      <DirectoryPicker onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    const output = lastFrame()!;
    expect(output).toContain('Recent');
  });

  it('shows MRU items when available', () => {
    mockExistsSync.mockImplementation((p: any) => {
      if (p.toString().endsWith('recent.json')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify(['/path/to/project1', '/path/to/project2']),
    );

    const { lastFrame } = render(
      <DirectoryPicker onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    const output = lastFrame()!;
    expect(output).toContain('project1');
    expect(output).toContain('project2');
  });

  it('renders Discovered section header', () => {
    const { lastFrame } = render(
      <DirectoryPicker onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    const output = lastFrame()!;
    expect(output).toContain('Discovered');
  });

  // AC-067: non-git warning
  it('renders without crashing when no items', () => {
    const { lastFrame } = render(
      <DirectoryPicker onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(lastFrame()).toBeDefined();
  });

  // Smoke test: stdin interaction doesn't crash
  it('handles stdin input without crashing', () => {
    const { lastFrame, stdin } = render(
      <DirectoryPicker onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    stdin.write('/');
    stdin.write('p');
    expect(lastFrame()).toBeDefined();
  });
});
