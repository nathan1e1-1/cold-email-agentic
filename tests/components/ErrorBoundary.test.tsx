// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';
import { emitGlobalError, onGlobalError } from '../../src/services/errorBus';

function Boom(): React.ReactElement {
  throw new Error('boom');
}

describe('ErrorBoundary', () => {
  it('renders a fallback instead of a blank screen', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
  });

  it('delivers global errors to subscribers', () => {
    const seen: string[] = [];
    const off = onGlobalError((m) => seen.push(m));
    emitGlobalError('kaboom');
    off();
    emitGlobalError('after-off');
    expect(seen).toEqual(['kaboom']);
  });
});
