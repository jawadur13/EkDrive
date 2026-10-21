import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RowMenu } from './RowMenu';

const actions = (onSelect = vi.fn()) => [
  { label: 'Download', href: '/api/v1/files/1/download' },
  { label: 'Rename', onSelect },
  { label: 'Delete', onSelect, danger: true },
];

describe('RowMenu', () => {
  it('stays closed until asked, then shows the actions', async () => {
    render(<RowMenu label="report.pdf" actions={actions()} />);
    const trigger = screen.getByRole('button', { name: 'Actions for report.pdf' });

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: 'Download' })).toHaveAttribute('href', '/api/v1/files/1/download');
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
  });

  it('runs the action and closes', async () => {
    const onSelect = vi.fn();
    render(<RowMenu label="report.pdf" actions={actions(onSelect)} />);

    await userEvent.click(screen.getByRole('button', { name: 'Actions for report.pdf' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on Escape and on a click elsewhere', async () => {
    render(
      <div>
        <RowMenu label="report.pdf" actions={actions()} />
        <button>somewhere else</button>
      </div>
    );
    const trigger = screen.getByRole('button', { name: 'Actions for report.pdf' });

    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('button', { name: 'somewhere else' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
