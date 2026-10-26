// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { DraftPanel } from '../../src/components/DraftPanel';

function renderPanel(overrides: Partial<Parameters<typeof DraftPanel>[0]> = {}) {
  return render(
    <DraftPanel
      ai={null}
      generating={false}
      draft=""
      onDraftChange={() => {}}
      tone="professional"
      onToneChange={() => {}}
      instruction=""
      onInstructionChange={() => {}}
      onGenerate={() => {}}
      onSend={() => {}}
      canSend={false}
      testMode
      promptText={null}
      to="a@z.com"
      subject="Re: Hi"
      onDisableTestMode={() => {}}
      open
      onToggle={() => {}}
      {...overrides}
    />,
  );
}

afterEach(cleanup);

describe('DraftPanel', () => {
  it('renders an in-thread reply composer', () => {
    renderPanel();
    expect(screen.getByText('Reply to thread')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeDisabled();
    expect(screen.getByLabelText('Draft reply')).toBeInTheDocument();
  });

  it('can turn Test mode off from the callout', async () => {
    const off = vi.fn();
    renderPanel({ onDisableTestMode: off });
    await userEvent.click(screen.getByRole('button', { name: 'Turn off Test mode' }));
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('enables Send reply outside test mode', () => {
    renderPanel({ canSend: true, testMode: false });
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeEnabled();
  });

  it('shows the normal hint outside test mode', () => {
    renderPanel({ testMode: false });
    expect(screen.queryByRole('button', { name: 'Turn off Test mode' })).toBeNull();
    expect(screen.getByText('Sends a real reply from your Gmail account.')).toBeInTheDocument();
  });

  it('stays disabled in test mode even when canSend', () => {
    renderPanel({ canSend: true, testMode: true });
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeDisabled();
  });

  it('focuses the draft after leaving test mode', async () => {
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Turn off Test mode' }));
    expect(screen.getByLabelText('Draft reply')).toHaveFocus();
  });

  it('collapses to a compact expandable bar', async () => {
    const onToggle = vi.fn();
    renderPanel({ open: false, onToggle });
    expect(screen.queryByLabelText('Draft reply')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send reply' })).toBeNull();
    const expand = screen.getByRole('button', { name: 'Expand' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(expand);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('can be minimized when open and keeps focus', async () => {
    const onToggle = vi.fn();
    renderPanel({ open: true, onToggle });
    const minimize = screen.getByRole('button', { name: 'Minimize' });
    expect(minimize).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(minimize);
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(minimize).toHaveFocus();
  });

  function Harness() {
    const [open, setOpen] = useState(true);
    const [draft, setDraft] = useState('hello');
    return (
      <DraftPanel
        ai={null}
        generating={false}
        draft={draft}
        onDraftChange={setDraft}
        tone="professional"
        onToneChange={() => {}}
        instruction=""
        onInstructionChange={() => {}}
        onGenerate={() => {}}
        onSend={() => {}}
        canSend
        testMode={false}
        promptText={null}
        to="a@z.com"
        subject="Re: Hi"
        onDisableTestMode={() => {}}
        open={open}
        onToggle={setOpen}
      />
    );
  }

  it('preserves the draft across collapse and expand', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Minimize' }));
    expect(screen.queryByLabelText('Draft reply')).toBeNull();
    expect(screen.getByRole('button', { name: 'Expand' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(screen.getByLabelText('Draft reply')).toHaveValue('hello');
  });
});
