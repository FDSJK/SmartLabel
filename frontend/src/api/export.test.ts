import { describe, it, expect } from 'vitest';
import { unconfirmedPending } from './export';
import { ApiError } from './client';

describe('unconfirmedPending', () => {
  it('returns the pending list for a 409 unconfirmed error', () => {
    const err = new ApiError(
      409,
      '{"code":"unconfirmed_labels","pending":[{"image":"a.png","labels":["dog"]}]}',
      { detail: { code: 'unconfirmed_labels', pending: [{ image: 'a.png', labels: ['dog'] }] } },
    );
    expect(unconfirmedPending(err)).toEqual([{ image: 'a.png', labels: ['dog'] }]);
  });

  it('returns null for non-409 or non-unconfirmed errors', () => {
    expect(unconfirmedPending(new ApiError(500, 'boom', { detail: 'boom' }))).toBeNull();
    expect(unconfirmedPending(new Error('network'))).toBeNull();
  });
});
