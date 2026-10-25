import type { Browser } from '../types.js';
import { ChromeCollector } from './chrome.js';
import { DomCollector, EgoCollector } from './ego.js';

export function createCollector(browser: Browser): DomCollector {
  if (browser === 'chrome') return new ChromeCollector();
  return new EgoCollector();
}
