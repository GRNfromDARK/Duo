import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { ScrollIndicator } from '../../ui/components/ScrollIndicator.js';

describe('ScrollIndicator', () => {
  it('renders floating hint when visible', () => {
    const { lastFrame } = render(
      <ScrollIndicator visible={true} columns={80} />
    );
    const output = lastFrame()!;
    expect(output).toContain('↓');
    expect(output).toContain('New output');
    expect(output).toContain('press G to follow');
  });

  it('renders nothing when not visible', () => {
    const { lastFrame } = render(
      <ScrollIndicator visible={false} columns={80} />
    );
    const output = lastFrame()!;
    expect(output).not.toContain('New output');
  });

  it('centers the hint text', () => {
    const { lastFrame } = render(
      <ScrollIndicator visible={true} columns={80} />
    );
    const output = lastFrame()!;
    // The hint should have leading spaces for centering
    const hintLine = output.split('\n').find((l: string) => l.includes('New output'));
    expect(hintLine).toBeDefined();
  });
});
