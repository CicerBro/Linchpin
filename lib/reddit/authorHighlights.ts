import type { FeatureSettings } from '../types';

const STYLE_ID = 'linchpin-author-highlight-styles';

/** RES User Highlighter defaults. */
const ADMIN = { bg: '#ff0011', hover: '#b3000c' };
const MOD = { bg: '#228822', hover: '#134913' };
const OP = { bg: '#0055df', hover: '#4e7eab' };

function roleRule(role: string, bg: string, hover: string): string {
  return `
    .tagline a.author.${role},
    .crosspost-preview-tagline a.author.${role},
    .search-result-meta a.author.${role} {
      color: #fff !important;
      font-weight: 700;
      padding: 0 2px;
      border-radius: 3px;
      background-color: ${bg} !important;
    }
    .collapsed .tagline a.author.${role},
    .collapsed .crosspost-preview-tagline a.author.${role} {
      color: #fff !important;
      background-color: #aaa !important;
    }
    .tagline a.author.${role}:hover,
    .crosspost-preview-tagline a.author.${role}:hover,
    .search-result-meta a.author.${role}:hover {
      background-color: ${hover} !important;
      text-decoration: none !important;
    }
  `;
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  // Later rules win when an author has multiple roles (admin > mod > OP).
  style.textContent = [
    roleRule('submitter', OP.bg, OP.hover),
    roleRule('moderator', MOD.bg, MOD.hover),
    roleRule('admin', ADMIN.bg, ADMIN.hover),
  ].join('\n');
  document.documentElement.appendChild(style);
}

function removeStyles(): void {
  document.getElementById(STYLE_ID)?.remove();
}

/**
 * RES-style username highlights from Reddit's author classes:
 * admin (red), moderator (green), submitter / OP (blue).
 */
export function applyAuthorHighlights(settings: FeatureSettings): void {
  if (!settings.reddit.authorHighlights) {
    removeStyles();
    return;
  }
  ensureStyles();
}
