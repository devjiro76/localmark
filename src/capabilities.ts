import type { Browser } from './types.js';

export interface BrowserCapability {
  id: Browser;
  label: string;
}

export interface SurfaceCapability {
  key: string;
  label: string;
  supported: boolean;
  unavailableReason?: string;
}

export interface PlatformCapability {
  browsers: BrowserCapability[];
  supportsAccountVerification: boolean;
  supportsScheduledCollection: boolean;
  surfaces: SurfaceCapability[];
}

const browsers: BrowserCapability[] = [
  { id: 'ego', label: 'ego lite' },
  { id: 'chrome', label: 'Chrome' },
];

export const platformCapabilities: Record<'x' | 'threads', PlatformCapability> = {
  x: {
    browsers,
    supportsAccountVerification: true,
    supportsScheduledCollection: true,
    surfaces: [
      { key: 'bookmarks', label: '북마크', supported: true },
      { key: 'likes', label: '좋아요', supported: true },
    ],
  },
  threads: {
    browsers,
    supportsAccountVerification: true,
    supportsScheduledCollection: true,
    surfaces: [
      { key: 'saved', label: '저장하기', supported: true },
      { key: 'reposts', label: '리포스트', supported: true },
      { key: 'likes', label: '좋아요', supported: true },
    ],
  },
};
