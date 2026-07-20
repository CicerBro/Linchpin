export type PictureInPictureResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * This function is intentionally self-contained: browser.scripting serializes it
 * into the active tab only after the user clicks the popup action.
 */
export async function requestPictureInPictureForBestVideo(): Promise<PictureInPictureResult> {
  const pipDocument = document as Document & {
    pictureInPictureEnabled?: boolean;
    pictureInPictureElement?: Element | null;
    exitPictureInPicture?: () => Promise<void>;
  };

  const isVisible = (video: HTMLVideoElement): boolean => {
    const rect = video.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(video);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number.parseFloat(style.opacity || '1') > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < innerHeight &&
      rect.left < innerWidth
    );
  };

  if (
    pipDocument.pictureInPictureEnabled !== true ||
    typeof HTMLVideoElement.prototype.requestPictureInPicture !== 'function'
  ) {
    return {
      ok: false,
      error: 'This browser or page does not expose the Picture-in-Picture API.',
    };
  }

  const videos = Array.from(document.querySelectorAll('video')).filter(isVisible);
  if (!videos.length) {
    return { ok: false, error: 'No visible video was found on this page.' };
  }

  const selected = videos.sort((a, b) => {
    const playingA = !a.paused && !a.ended && a.readyState >= 2 ? 1 : 0;
    const playingB = !b.paused && !b.ended && b.readyState >= 2 ? 1 : 0;
    if (playingA !== playingB) return playingB - playingA;
    const areaA = a.getBoundingClientRect().width * a.getBoundingClientRect().height;
    const areaB = b.getBoundingClientRect().width * b.getBoundingClientRect().height;
    return areaB - areaA;
  })[0];

  if (selected.disablePictureInPicture) {
    return {
      ok: false,
      error: 'The selected video has disabled Picture in Picture.',
    };
  }

  try {
    if (
      pipDocument.pictureInPictureElement &&
      pipDocument.pictureInPictureElement !== selected &&
      pipDocument.exitPictureInPicture
    ) {
      await pipDocument.exitPictureInPicture();
    }
    await selected.requestPictureInPicture();
    return { ok: true };
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError') {
      return { ok: false, error: 'The browser denied Picture in Picture. Try clicking the action again.' };
    }
    if (name === 'SecurityError' || name === 'NotSupportedError') {
      return { ok: false, error: 'This video is protected or does not support Picture in Picture.' };
    }
    return { ok: false, error: 'Picture in Picture could not be started for this video.' };
  }
}
