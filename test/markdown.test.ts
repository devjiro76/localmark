import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { contentHash, documentPath, renderMarkdown } from '../src/markdown.js';
import type { CollectedPost } from '../src/types.js';

const post: CollectedPost = {
  platform: 'threads', id: 'abc-123', sourceUrl: 'https://www.threads.com/@writer/post/abc-123',
  authorHandle: 'writer', authorName: 'Writer', text: '원문 #1\n둘째 줄', postedAt: '2026-10-24T01:02:03.000Z',
  reaction: 'save', collectorAccount: 'owner', quoted: { authorHandle: 'other', text: '인용 원문' },
};

test('Markdown keeps source metadata and original text without AI summaries', () => {
  const hash = contentHash(post);
  const output = renderMarkdown(post, ['save'], hash, '2026-10-24T02:00:00.000Z');
  assert.match(output, /id: "threads:abc-123"/);
  assert.match(output, /source_url: "https:\/\/www\.threads\.com\/@writer\/post\/abc-123"/);
  assert.match(output, /원문 #1\n둘째 줄/);
  assert.match(output, /## Quoted post/);
  assert.doesNotMatch(output, /summary|embedding|vector/i);
  assert.equal(documentPath(post, new Date()), 'posts/threads/2026/10/abc-123.md');
});
