/**
 * Caps 1–2★ ratings on each DEMO listing at MAX_LOW. Any extra low rating is
 * lifted to 4–5★ and given an unused "good" line from scripts/demo-reviews.json
 * (or no text once those run out).
 *
 *   npx tsx scripts/demo-reviews-cap-low.ts
 *   npx supabase db query -f E:\listing\demo\reviews-cap-low.sql --linked
 */
/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Business, Review } from '@/domain/types';
import { need } from './listing-lib';

const MAX_LOW = 2;
const OUT = 'E:\\listing\\food data\\demo\\reviews-cap-low.sql';
const sql = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function main() {
  const lines = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'demo-reviews.json'), 'utf8')) as Record<string, { good: string[] }>;
  const sb = createClient(need('EXPO_PUBLIC_SUPABASE_URL'), need('EXPO_PUBLIC_SUPABASE_ANON_KEY'), { auth: { persistSession: false } });
  const { data, error } = await sb.from('businesses').select('id, data').eq('data->>demo', 'true');
  if (error) throw error;

  const stmts: string[] = [];
  for (const row of data ?? []) {
    const b = row.data as Business;
    const { data: revs, error: e2 } = await sb.from('reviews').select('id, data').eq('business_id', b.id);
    if (e2) throw e2;
    const all = (revs ?? []).map((r) => ({ id: r.id as string, review: r.data as Review }));
    const used = new Set(all.map((r) => r.review.comment).filter(Boolean));
    const spare = (lines[b.name]?.good ?? []).filter((g) => !used.has(g));
    const low = all.filter((r) => r.review.rating <= 2).sort((a, z) => a.id.localeCompare(z.id));
    low.slice(MAX_LOW).forEach((r, i) => {
      const rating = i % 3 === 2 ? 4 : 5;
      const text = spare.shift();
      const next = text
        ? `jsonb_set(jsonb_set(data, '{rating}', '${rating}'), '{comment}', to_jsonb(${sql(text)}::text))`
        : `jsonb_set(data, '{rating}', '${rating}') - 'comment'`;
      stmts.push(`update reviews set data = ${next} where id = ${sql(r.id)};`);
    });
  }
  writeFileSync(OUT, `begin;\n${stmts.join('\n')}\ncommit;\n`);
  console.log(`${stmts.length} low ratings lifted → ${OUT}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
