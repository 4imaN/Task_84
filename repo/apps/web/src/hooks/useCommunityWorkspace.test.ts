import { describe, expect, it } from 'vitest';
import { mergeUniqueTitles } from './useCommunityWorkspace';

describe('mergeUniqueTitles', () => {
  it('deduplicates merged community titles by stable title id', () => {
    const merged = mergeUniqueTitles(
      [
        {
          id: 'title-1',
          slug: 'quiet-harbor-digital',
          name: 'Quiet Harbor',
          format: 'DIGITAL',
          isReadable: true,
          price: 12.99,
          inventoryOnHand: 8,
          authorName: 'Lian Sun',
          authorId: 'author-1',
        },
        {
          id: 'title-2',
          slug: 'archive-at-dawn',
          name: 'Archive At Dawn',
          format: 'DIGITAL',
          isReadable: true,
          price: 10.99,
          inventoryOnHand: 4,
          authorName: 'Mira Vale',
          authorId: 'author-2',
        },
      ],
      [
        {
          id: 'title-2',
          slug: 'archive-at-dawn',
          name: 'Archive At Dawn',
          format: 'DIGITAL',
          isReadable: true,
          price: 10.99,
          inventoryOnHand: 4,
          authorName: 'Mira Vale',
          authorId: 'author-2',
        },
        {
          id: 'title-1',
          slug: 'quiet-harbor-digital',
          name: 'Quiet Harbor',
          format: 'DIGITAL',
          isReadable: true,
          price: 12.99,
          inventoryOnHand: 8,
          authorName: 'Lian Sun',
          authorId: 'author-1',
        },
      ],
    );

    expect(merged.map((title) => title.id)).toEqual(['title-1', 'title-2']);
  });
});
