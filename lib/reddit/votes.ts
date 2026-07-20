import type { UserTag } from '../types';

/** RES stores separate upvote/downvote tallies; net = up − down. */
export function netVoteScore(tag: UserTag): number | null {
  const hasUp = typeof tag.votesUp === 'number';
  const hasDown = typeof tag.votesDown === 'number';
  if (!hasUp && !hasDown) return null;
  return (tag.votesUp ?? 0) - (tag.votesDown ?? 0);
}

export function formatNetVote(score: number): string {
  if (score > 0) return `+${score}`;
  return String(score);
}

/** Slightly transparent green / red / gray for vote chips. */
export function voteBadgeColors(score: number): { bg: string; fg: string; border: string } {
  if (score > 0) {
    return {
      bg: 'rgba(46, 125, 50, 0.18)',
      fg: '#1b5e20',
      border: 'rgba(46, 125, 50, 0.45)',
    };
  }
  if (score < 0) {
    return {
      bg: 'rgba(198, 40, 40, 0.18)',
      fg: '#b71c1c',
      border: 'rgba(198, 40, 40, 0.45)',
    };
  }
  return {
    bg: 'rgba(97, 97, 97, 0.14)',
    fg: '#424242',
    border: 'rgba(97, 97, 97, 0.35)',
  };
}
