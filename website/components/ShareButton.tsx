'use client';

import { useState } from 'react';

/** Native share sheet on phones; copy-the-link everywhere else. */
export function ShareButton({ title, className = 'btn btn-outline' }: { title: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The visitor closed the share sheet — nothing to do.
    }
  }

  return (
    <button type="button" className={className} onClick={share}>
      {copied ? '✓ Link copied' : '↗ Share'}
    </button>
  );
}
