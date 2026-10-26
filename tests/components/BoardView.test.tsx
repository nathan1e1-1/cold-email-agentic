// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BoardView } from '../../src/views/BoardView';

describe('BoardView', () => {
  it('renders the three columns and empty drop targets', () => {
    render(<BoardView repo={null} onOpenThread={() => {}} refreshKey={0} testMode />);
    expect(screen.getByText("Haven't touched")).toBeInTheDocument();
    expect(screen.getByText('In review')).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.getAllByText('Drop cards here')).toHaveLength(3);
  });
});
