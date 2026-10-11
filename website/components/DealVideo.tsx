'use client';

import { useEffect, useRef } from 'react';

/**
 * An offer's reel. Muted (browsers block autoplay with sound), and it plays
 * only while it's mostly on screen — a feed of 27 videos all playing at once
 * would spend the visitor's data and the Cloudinary bandwidth for nothing.
 * `preload="none"` means nothing downloads until it scrolls into view; until
 * then the offer's photo stands in as the poster. Visitors who ask for reduced
 * motion get the poster and a play button instead.
 */
export function DealVideo({ src, poster }: { src: string; poster?: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      video.controls = true;
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) video.play().catch(() => {});
        else video.pause();
      },
      { threshold: 0.6 },
    );
    io.observe(video);
    return () => io.disconnect();
  }, []);

  return <video ref={ref} src={src} poster={poster} muted loop playsInline preload="none" />;
}
