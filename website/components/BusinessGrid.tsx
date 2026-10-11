import type { DirectoryEntry } from '@/lib/data';
import { BusinessCard } from './BusinessCard';

export function BusinessGrid({ entries }: { entries: DirectoryEntry[] }) {
  return (
    <div className="grid">
      {entries.map((e) => (
        <BusinessCard key={e.id} entry={e} />
      ))}
    </div>
  );
}
