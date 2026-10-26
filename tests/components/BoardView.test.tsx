// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BoardView } from '../../src/views/BoardView';

describe('BoardView', () => {
  it('renders the three columns and empty drop targets', () => {
    render(<BoardView repo={null} onOpenThread={() => {}} refreshKey={0} />);
    expect(screen.getByText("Haven't touched")).toBeTruthy();
    expect(screen.getByText('In review')).toBeTruthy();
    expect(screen.getByText('Sent')).toBeTruthy();
    expect(screen.getAllByText('Drop cards here')).toHaveLength(3);
  });
});
