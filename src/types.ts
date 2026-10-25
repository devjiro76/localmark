export type Platform = 'x' | 'threads';
export type Reaction = 'like' | 'save' | 'repost';
export type Browser = 'ego' | 'chrome';

export interface PlatformSettings {
  enabled: boolean;
  account: string;
  browser: Browser;
  intervalSeconds: number;
  surfaces: Record<string, boolean>;
}

export interface LocalmarkSettings {
  version: 1;
  autoSync: boolean;
  platforms: Record<Platform, PlatformSettings>;
}

export interface ThreadPart {
  id: string;
  sourceUrl: string;
  text: string;
  postedAt: string | null;
}

export interface ThreadInfo {
  rootId: string;
  position: number;
  parts: ThreadPart[];
}

export interface CollectedPost {
  platform: Platform;
  id: string;
  sourceUrl: string;
  authorHandle: string | null;
  authorName: string | null;
  text: string;
  postedAt: string | null;
  reaction: Reaction | null;
  collectedAs?: Reaction[];
  collectorAccount: string;
  collectorAccounts?: string[];
  observationScope?: string;
  migration?: {
    source: 'idea-vault';
    textSource: string;
    sourceObservationSha256?: string;
  };
  quoted?: {
    authorHandle: string | null;
    text: string;
  };
  thread?: ThreadInfo;
}

export interface Collector {
  collect(platform: Platform, settings: PlatformSettings): Promise<CollectedPost[]>;
}

export interface DocumentState {
  path: string;
  contentHash: string;
  reactions: Reaction[];
  sourcePostIds?: string[];
}

export interface SyncState {
  version: 1;
  platforms: Partial<Record<Platform, { lastSuccess: string | null; lastError: string | null }>>;
  documents: Record<string, DocumentState>;
}

export interface SyncResult {
  platform: Platform;
  discovered: number;
  created: number;
  updated: number;
  unchanged: number;
  account: string;
}
