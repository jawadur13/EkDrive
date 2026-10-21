import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { canPreview, PreviewModal } from './PreviewModal';

describe('canPreview', () => {
  it('accepts what the browser can render and rejects the rest', () => {
    for (const mime of ['image/png', 'image/jpeg', 'video/mp4', 'audio/mpeg', 'application/pdf', 'text/plain']) {
      expect(canPreview(mime)).toBe(true);
    }
    for (const mime of ['application/zip', 'application/octet-stream', 'image/svg+xml', null]) {
      expect(canPreview(mime)).toBe(false);
    }
  });
});

describe('PreviewModal', () => {
  const file = { id: '11111111-1111-1111-1111-111111111111', name: 'holiday.png', mime_type: 'image/png' };

  it('shows the file with a download link and closes on Escape', async () => {
    const onClose = vi.fn();
    render(<PreviewModal file={file} onClose={onClose} />);

    expect(screen.getByRole('dialog', { name: 'holiday.png' })).toBeInTheDocument();
    expect(screen.getByAltText('holiday.png')).toHaveAttribute('src', `/api/v1/files/${file.id}/preview`);
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute('href', `/api/v1/files/${file.id}/download`);

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when the backdrop is clicked but not when the panel is', async () => {
    const onClose = vi.fn();
    render(<PreviewModal file={file} onClose={onClose} />);

    await userEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByText('holiday.png'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sandboxes a PDF rather than rendering it as an image', () => {
    render(<PreviewModal file={{ ...file, name: 'report.pdf', mime_type: 'application/pdf' }} onClose={() => {}} />);
    const frame = screen.getByTitle('report.pdf');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('sandbox', '');
  });
});
