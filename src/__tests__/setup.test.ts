import { describe, it, expect } from 'vitest';
import { VERSION } from '../index.js';

describe('Project Setup', () => {
  it('should export a version string', () => {
    expect(VERSION).toBe('1.0.0');
  });

  it('should have version as a string type', () => {
    expect(typeof VERSION).toBe('string');
  });
});
