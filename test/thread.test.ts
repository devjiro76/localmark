import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleThread, threadPartUrl } from '../src/thread.js';
import { contentHash, renderMarkdown } from '../src/markdown.js';
import type { CollectedPost } from '../src/types.js';

const focal = { id: '2', authorHandle: 'writer', platform: 'x' as const };

test('assembleThread keeps only same-author parts and locates the focal position', () => {
  const thread = assembleThread([
    { id: '1', authorHandle: 'writer', text: '1/4 시작', postedAt: '2026-10-24T01:00:00Z' },
    { id: '2', authorHandle: 'writer', text: '2/4 이어서', postedAt: '2026-10-24T01:01:00Z' },
    { id: 'x9', authorHandle: 'someoneelse', text: '다른 사람 답글', postedAt: null },
    { id: '3', authorHandle: 'writer', text: '3/4 계속', postedAt: '2026-10-24T01:02:00Z' },
    { id: '4', authorHandle: 'writer', text: '4/4 끝', postedAt: '2026-10-24T01:03:00Z' },
  ], focal);
  assert.ok(thread);
  assert.equal(thread.rootId, '1');
  assert.equal(thread.position, 2);
  assert.deepEqual(thread.parts.map(part => part.id), ['1', '2', '3', '4']);
  assert.equal(thread.parts[0]!.sourceUrl, 'https://x.com/writer/status/1');
  assert.equal(thread.parts[2]!.text, '3/4 계속');
});

test('assembleThread returns undefined for standalone posts or missing focal post', () => {
  assert.equal(assembleThread([
    { id: '2', authorHandle: 'writer', text: '독립 글', postedAt: null },
    { id: 'x9', authorHandle: 'someoneelse', text: '다른 사람 답글', postedAt: null },
  ], focal), undefined);
  assert.equal(assembleThread([
    { id: '1', authorHandle: 'writer', text: '1/2', postedAt: null },
    { id: '3', authorHandle: 'writer', text: '2/2', postedAt: null },
  ], focal), undefined);
});

test('assembleThread dedupes repeated entries and matches handles case-insensitively', () => {
  const thread = assembleThread([
    { id: '1', authorHandle: 'Writer', text: '1/2', postedAt: null },
    { id: '1', authorHandle: 'Writer', text: '1/2 중복', postedAt: null },
    { id: '2', authorHandle: 'writer', text: '2/2', postedAt: null },
  ], focal);
  assert.ok(thread);
  assert.deepEqual(thread.parts.map(part => part.id), ['1', '2']);
  assert.equal(thread.parts[0]!.text, '1/2');
});

test('threadPartUrl builds platform-specific permalinks', () => {
  assert.equal(threadPartUrl('threads', 'writer', 'abc-1'), 'https://www.threads.com/@writer/post/abc-1');
  assert.equal(threadPartUrl('x', 'writer', '42'), 'https://x.com/writer/status/42');
});

test('Markdown uses one root document containing every thread part exactly once', () => {
  const post: CollectedPost = {
    platform: 'x', id: '2', sourceUrl: 'https://x.com/writer/status/2',
    authorHandle: 'writer', authorName: 'Writer', text: '2/4 이어서', postedAt: '2026-10-24T01:01:00Z',
    reaction: 'save', collectorAccount: 'owner',
    thread: {
      rootId: '1', position: 2,
      parts: [
        { id: '1', sourceUrl: 'https://x.com/writer/status/1', text: '1/4 시작', postedAt: '2026-10-24T01:00:00Z' },
        { id: '2', sourceUrl: 'https://x.com/writer/status/2', text: '2/4 이어서', postedAt: '2026-10-24T01:01:00Z' },
      ],
    },
  };
  const hash = contentHash(post);
  const output = renderMarkdown(post, ['save'], hash, '2026-10-24T02:00:00.000Z', ['2']);
  assert.match(output, /id: "x:1"/);
  assert.match(output, /post_id: "1"/);
  assert.match(output, /source_url: "https:\/\/x\.com\/writer\/status\/1"/);
  assert.match(output, /thread_root: "x:1"/);
  assert.match(output, /thread_total: 2/);
  assert.match(output, /collected_posts:\n  - "2"/);
  assert.match(output, /## Thread \(2 parts\)/);
  assert.match(output, /### Part 1\n/);
  assert.match(output, /### Part 2\n/);
  assert.equal(output.match(/1\/4 시작/g)?.length, 1);
  assert.equal(output.match(/2\/4 이어서/g)?.length, 1);
  assert.doesNotMatch(output, /thread_position|this post/);
  const withoutThread = { ...post, thread: undefined };
  assert.notEqual(contentHash(withoutThread), hash);
  assert.doesNotMatch(renderMarkdown(withoutThread, ['save'], contentHash(withoutThread), '2026-10-24T02:00:00.000Z'), /thread_root/);
});
