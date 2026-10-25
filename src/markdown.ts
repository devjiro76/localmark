import { createHash } from 'node:crypto';
import type { CollectedPost, Reaction } from './types.js';

const yaml = (value: string) => JSON.stringify(value);
const safePart = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_');

type DocumentIdentity = Pick<CollectedPost, 'platform' | 'id'> & { thread?: CollectedPost['thread'] };

function rootPart(post: CollectedPost) {
  return post.thread?.parts.find(part => part.id === post.thread!.rootId);
}

export function documentKey(post: DocumentIdentity) {
  return `${post.platform}:${post.thread?.rootId ?? post.id}`;
}

export function documentPath(post: CollectedPost, now: Date) {
  const root = rootPart(post);
  const postedAt = root?.postedAt ?? post.postedAt;
  const date = postedAt && !Number.isNaN(Date.parse(postedAt)) ? new Date(postedAt) : now;
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `posts/${post.platform}/${year}/${month}/${safePart(post.thread?.rootId ?? post.id)}.md`;
}

export function contentHash(post: CollectedPost) {
  const root = rootPart(post);
  return createHash('sha256').update(JSON.stringify({
    text: root?.text ?? post.text,
    quoted: post.thread ? null : post.quoted ?? null,
    authorHandle: post.authorHandle,
    authorName: post.authorName,
    postedAt: root?.postedAt ?? post.postedAt,
    sourceUrl: root?.sourceUrl ?? post.sourceUrl,
    observationScope: post.observationScope ?? null,
    migration: post.migration ?? null,
    thread: post.thread ? { rootId: post.thread.rootId, parts: post.thread.parts } : null,
  })).digest('hex');
}

export function renderMarkdown(post: CollectedPost, reactions: Reaction[], hash: string, collectedAt: string, collectedPostIds: string[] = []) {
  const root = rootPart(post);
  const sourceUrl = root?.sourceUrl ?? post.sourceUrl;
  const lines = [
    '---',
    `id: ${yaml(documentKey(post))}`,
    `platform: ${post.platform}`,
    `post_id: ${yaml(post.thread?.rootId ?? post.id)}`,
    `author: ${yaml(post.authorHandle ?? '')}`,
    `author_name: ${yaml(post.authorName ?? '')}`,
    `published_at: ${yaml(root?.postedAt ?? post.postedAt ?? '')}`,
    `source_url: ${yaml(sourceUrl)}`,
    `collector_account: ${yaml(post.collectorAccount)}`,
  ];
  if (post.thread) {
    lines.push(`thread_root: ${yaml(documentKey(post))}`, `thread_total: ${post.thread.parts.length}`);
    if (collectedPostIds.length) lines.push('collected_posts:', ...collectedPostIds.map(id => `  - ${yaml(id)}`));
  }
  if (post.collectorAccounts?.length) lines.push('collector_accounts:', ...post.collectorAccounts.map(account => `  - ${yaml(account)}`));
  lines.push(...(reactions.length ? ['collected_as:', ...reactions.map(reaction => `  - ${reaction}`)] : ['collected_as: []']));
  lines.push(`collected_at: ${yaml(collectedAt)}`, `observation_scope: ${yaml(post.observationScope ?? 'rendered_body_partial')}`);
  if (post.migration) {
    lines.push(`migrated_from: ${yaml(post.migration.source)}`, `migration_text_source: ${yaml(post.migration.textSource)}`);
    if (post.migration.sourceObservationSha256) lines.push(`source_observation_sha256: ${yaml(post.migration.sourceObservationSha256)}`);
  }
  lines.push(`content_hash: ${yaml(hash)}`, '---', '');
  if (!post.thread) lines.push(post.text.trim(), '');
  if (!post.thread && post.quoted?.text) {
    lines.push('## Quoted post', '', `Author: @${post.quoted.authorHandle ?? 'unknown'}`, '', post.quoted.text.trim(), '');
  }
  if (post.thread) {
    lines.push(`## Thread (${post.thread.parts.length} parts)`, '');
    post.thread.parts.forEach((part, index) => {
      lines.push(`### Part ${index + 1}`, '', `[Original](${part.sourceUrl})`, '', part.text.trim(), '');
    });
  }
  lines.push('## Source', '', `[Original post](${sourceUrl})`, '');
  return lines.join('\n');
}
