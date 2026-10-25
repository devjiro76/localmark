import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWrite, statePath } from './settings.js';
import { contentHash, documentKey, documentPath, renderMarkdown } from './markdown.js';
import type { CollectedPost, Reaction, SyncState } from './types.js';

export function emptyState(): SyncState { return { version: 1, platforms: {}, documents: {} }; }

export function loadState(dataDir: string): SyncState {
  const path = statePath(dataDir);
  if (!existsSync(path)) return emptyState();
  const state = JSON.parse(readFileSync(path, 'utf8')) as SyncState;
  if (state.version !== 1 || !state.documents || !state.platforms) throw new Error('Invalid sync state');
  return state;
}

export class MarkdownStore {
  constructor(readonly dataDir: string) {}

  initialize() {
    for (const dir of ['posts', 'annotations', 'attachments', 'raw', '.localmark']) {
      mkdirSync(join(this.dataDir, dir), { recursive: true, mode: 0o700 });
    }
  }

  save(posts: CollectedPost[], state: SyncState, now = new Date()) {
    this.initialize();
    const collectedAt = now.toISOString();
    const counts = { created: 0, updated: 0, unchanged: 0 };
    const raw = JSON.stringify({ schema: 'localmark-observations-v1', collectedAt, posts }, null, 2) + '\n';
    const rawHash = createHash('sha256').update(raw).digest('hex');
    const rawPath = join(this.dataDir, 'raw', `${rawHash}.json`);
    if (!existsSync(rawPath)) writeFileSync(rawPath, raw, { flag: 'wx', mode: 0o400 });

    for (const post of posts) {
      const key = documentKey(post), previous = state.documents[key], hash = contentHash(post);
      const legacyEntries = post.thread
        ? post.thread.parts.map(part => `${post.platform}:${part.id}`).filter(legacyKey => legacyKey !== key)
          .map(legacyKey => ({ key: legacyKey, document: state.documents[legacyKey] })).filter(entry => entry.document)
        : [];
      const previousDocuments = [previous, ...legacyEntries.map(entry => entry.document!)].filter(Boolean);
      const incomingReactions = post.collectedAs ?? (post.reaction ? [post.reaction] : []);
      const reactions = [...new Set([...previousDocuments.flatMap(document => document!.reactions), ...incomingReactions])].sort() as Reaction[];
      const sourcePostIds = post.thread ? [...new Set([
        ...previousDocuments.flatMap(document => document!.sourcePostIds ?? []),
        ...legacyEntries.map(entry => entry.key.slice(entry.key.indexOf(':') + 1)),
        ...(previous && !previous.sourcePostIds ? [post.thread.rootId] : []),
        post.id,
      ])].sort() : [];
      const previousSourcePostIds = previous?.sourcePostIds ?? [];
      const sameSourcePosts = previousSourcePostIds.length === sourcePostIds.length
        && previousSourcePostIds.every((id, index) => id === sourcePostIds[index]);
      const relativePath = previous?.path ?? documentPath(post, now);
      if (!legacyEntries.length && previous?.contentHash === hash && previous.reactions.length === reactions.length
        && sameSourcePosts && existsSync(join(this.dataDir, relativePath))) {
        counts.unchanged++;
        continue;
      }
      const markdown = renderMarkdown(post, reactions, hash, collectedAt, sourcePostIds);
      atomicWrite(join(this.dataDir, relativePath), markdown, 0o600);
      state.documents[key] = { path: relativePath, contentHash: hash, reactions, ...(post.thread ? { sourcePostIds } : {}) };
      for (const legacy of legacyEntries) {
        delete state.documents[legacy.key];
        const path = legacy.document!.path;
        if (path !== relativePath && path.startsWith('posts/') && !path.includes('..')) rmSync(join(this.dataDir, path), { force: true });
      }
      if (previous || legacyEntries.length) counts.updated++; else counts.created++;
    }
    return counts;
  }

  saveState(state: SyncState) {
    atomicWrite(statePath(this.dataDir), JSON.stringify(state, null, 2) + '\n');
  }
}
