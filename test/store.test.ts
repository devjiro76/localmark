import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { emptyState, MarkdownStore } from '../src/store.js';
import type { CollectedPost } from '../src/types.js';

const post: CollectedPost = {
  platform: 'x', id: '123', sourceUrl: 'https://x.com/writer/status/123', authorHandle: 'writer',
  authorName: 'Writer', text: 'Local Markdown', postedAt: '2026-10-24T00:00:00.000Z', reaction: 'save', collectorAccount: 'owner',
};

test('store deduplicates content and merges collection reactions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'localmark-store-')), store = new MarkdownStore(dir), state = emptyState();
  assert.deepEqual(store.save([post], state), { created: 1, updated: 0, unchanged: 0 });
  assert.deepEqual(store.save([post], state), { created: 0, updated: 0, unchanged: 1 });
  assert.deepEqual(store.save([{ ...post, reaction: 'like' }], state), { created: 0, updated: 1, unchanged: 0 });
  const path = state.documents['x:123']!.path;
  const markdown = readFileSync(join(dir, path), 'utf8');
  assert.match(markdown, /  - like\n  - save/);
  assert.equal(state.documents['x:123']!.reactions.length, 2);
  assert.ok(existsSync(join(dir, 'annotations')));
});

test('store consolidates legacy thread parts into one root document and preserves reactions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'localmark-thread-store-')), store = new MarkdownStore(dir), state = emptyState();
  const root = { ...post, id: '1', sourceUrl: 'https://x.com/writer/status/1', text: '1/2 시작' };
  const part = { ...post, id: '2', sourceUrl: 'https://x.com/writer/status/2', text: '2/2 끝', reaction: 'like' as const };
  store.save([root, part], state);
  const legacyPartPath = state.documents['x:2']!.path;
  const threaded = {
    ...part,
    reaction: 'repost' as const,
    thread: {
      rootId: '1', position: 2,
      parts: [
        { id: '1', sourceUrl: root.sourceUrl, text: root.text, postedAt: root.postedAt },
        { id: '2', sourceUrl: part.sourceUrl, text: part.text, postedAt: part.postedAt },
      ],
    },
  };
  assert.deepEqual(store.save([threaded], state), { created: 0, updated: 1, unchanged: 0 });
  assert.deepEqual(Object.keys(state.documents), ['x:1']);
  assert.equal(existsSync(join(dir, legacyPartPath)), false);
  const document = state.documents['x:1']!;
  assert.deepEqual(document.reactions, ['like', 'repost', 'save']);
  assert.deepEqual(document.sourcePostIds, ['1', '2']);
  const markdown = readFileSync(join(dir, document.path), 'utf8');
  assert.match(markdown, /id: "x:1"/);
  assert.match(markdown, /collected_posts:\n  - "1"\n  - "2"/);
  assert.equal(markdown.match(/1\/2 시작/g)?.length, 1);
  assert.equal(markdown.match(/2\/2 끝/g)?.length, 1);
  assert.deepEqual(store.save([threaded], state), { created: 0, updated: 0, unchanged: 1 });
  assert.deepEqual(store.save([{ ...threaded, id: '1', thread: { ...threaded.thread, position: 1 } }], state), { created: 0, updated: 0, unchanged: 1 });
});
