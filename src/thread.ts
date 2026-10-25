import type { Platform, ThreadInfo, ThreadPart } from './types.js';

export interface ThreadEntry {
  id: string;
  authorHandle: string | null;
  text: string;
  postedAt: string | null;
}

export function threadPartUrl(platform: Platform, handle: string, id: string) {
  return platform === 'x'
    ? `https://x.com/${handle}/status/${id}`
    : `https://www.threads.com/@${handle}/post/${id}`;
}

/**
 * Assemble a self-reply thread ("연글") from the posts visible on a detail page.
 * Keeps only posts by the focal author, in document order, and requires the
 * focal post plus at least one other part. Other authors' replies are ignored.
 */
export function assembleThread(
  entries: ThreadEntry[],
  focal: { id: string; authorHandle: string; platform: Platform },
): ThreadInfo | undefined {
  const seen = new Set<string>();
  const sameAuthor: ThreadPart[] = [];
  for (const entry of entries) {
    if (!entry.id || seen.has(entry.id)) continue;
    if (entry.authorHandle?.toLowerCase() !== focal.authorHandle.toLowerCase()) continue;
    seen.add(entry.id);
    sameAuthor.push({
      id: entry.id,
      sourceUrl: threadPartUrl(focal.platform, focal.authorHandle, entry.id),
      text: entry.text,
      postedAt: entry.postedAt,
    });
  }
  const position = sameAuthor.findIndex(part => part.id === focal.id);
  if (position < 0 || sameAuthor.length < 2) return undefined;
  return { rootId: sameAuthor[0]!.id, position: position + 1, parts: sameAuthor };
}
