/**
 * Swaps the written reviews on the DEMO listings for the business-specific
 * text in scripts/demo-reviews.json — same raters, same stars, new words.
 * Run it AFTER scripts/demo-ratings.ts has finished.
 *
 *   npx tsx scripts/demo-reviews-apply.ts
 *
 * Writes E:\listing\demo\reviews-apply.sql; apply it with
 *   npx supabase db query -f E:\listing\demo\reviews-apply.sql --linked
 *
 * Bands: 1–2★ take a "low" line, 3★ a "meh" line, 4–5★ a "good" line. A
 * business that runs out of lines in a band keeps its existing text there.
 */
/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Business, Review } from '@/domain/types';
import { need } from './listing-lib';

type Lines = { good: string[]; meh: string[]; low: string[] };
const OUT = 'E:\\listing\\demo\\reviews-apply.sql';
const sql = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function main() {
  const lines = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'demo-reviews.json'), 'utf8')) as Record<string, Lines>;
  const sb = createClient(need('EXPO_PUBLIC_SUPABASE_URL'), need('EXPO_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false },
  });
  const { data, error } = await sb.from('businesses').select('id, data').eq('data->>demo', 'true');
  if (error) throw error;

  const stmts: string[] = [];
  let missing = 0;
  for (const row of data ?? []) {
    const b = row.data as Business;
    const set = lines[b.name];
    if (!set) { console.log(`no reviews written for ${b.name}`); missing++; continue; }
    const { data: revs, error: e2 } = await sb.from('reviews').select('id, data').eq('business_id', b.id);
    if (e2) throw e2;
    const written = (revs ?? [])
      .map((r) => ({ id: r.id as string, review: r.data as Review }))
      .filter((r) => r.review.comment)
      .sort((a, z) => a.id.localeCompare(z.id));
    const pools = { good: [...set.good], meh: [...set.meh], low: [...set.low] };
    for (const w of written) {
      const band = w.review.rating <= 2 ? 'low' : w.review.rating === 3 ? 'meh' : 'good';
      const text = pools[band].shift();
      if (!text) continue;
      stmts.push(`update reviews set data = jsonb_set(data, '{comment}', to_jsonb(${sql(text)}::text)) where id = ${sql(w.id)};`);
    }
    console.log(`${b.name}: ${written.length} written reviews`);
  }
  writeFileSync(OUT, `begin;\n${stmts.join('\n')}\ncommit;\n`);
  console.log(`\n${stmts.length} updates → ${OUT}${missing ? ` (${missing} listings had no text)` : ''}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
