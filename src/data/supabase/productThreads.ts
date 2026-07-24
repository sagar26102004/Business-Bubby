/**
 * Supabase-backed ProductThreadRepository over the public `product_messages`
 * table (world-readable; author writes own). One noticeboard per stall product.
 */
import type { Business, ProductMessage } from '@/domain/types';
import type { NewProductMessageInput, ProductThreadRepository } from '@/data/repositories';
import { sb, uuid, nowIso, notify } from './shared';

async function loadBusiness(id: string): Promise<Business | null> {
  const { data, error } = await sb().from('businesses').select('data').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? (data.data as Business) : null;
}

export function createSupabaseProductThreads(): ProductThreadRepository {
  return {
    async listForProduct(businessId: string, productId: string): Promise<ProductMessage[]> {
      const { data, error } = await sb()
        .from('product_messages')
        .select('data')
        .eq('business_id', businessId)
        .eq('product_id', productId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => r.data as ProductMessage);
    },

    async listForBusiness(businessId: string): Promise<ProductMessage[]> {
      const { data, error } = await sb()
        .from('product_messages')
        .select('data')
        .eq('business_id', businessId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => r.data as ProductMessage);
    },

    async setPinned(
      businessId: string,
      productId: string,
      messageId: string,
      pinned: boolean,
      actorId: string,
    ): Promise<ProductMessage> {
      const business = await loadBusiness(businessId);
      if (!business) throw new Error(`Business ${businessId} not found`);
      if (business.ownerId !== actorId) throw new Error('Only the seller can pin messages.');
      const { data, error } = await sb()
        .from('product_messages')
        .select('data')
        .eq('id', messageId)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error(`Message ${messageId} not found`);
      const message = { ...(data.data as ProductMessage), pinned };
      const { error: uErr } = await sb()
        .from('product_messages')
        .update({ data: message })
        .eq('id', messageId);
      if (uErr) throw uErr;
      return message;
    },

    async post(input: NewProductMessageInput): Promise<ProductMessage> {
      const business = await loadBusiness(input.businessId);
      if (!business) throw new Error(`Business ${input.businessId} not found`);
      const product = business.products?.find((p) => p.id === input.productId);
      if (!product) throw new Error(`Product ${input.productId} not found`);
      if (!input.text.trim() && !input.offerPrice) {
        throw new Error('Write a question, or propose a price.');
      }

      const fromSeller = business.ownerId === input.authorId;
      const message: ProductMessage = {
        id: uuid(),
        businessId: input.businessId,
        productId: input.productId,
        authorId: input.authorId,
        authorName: input.authorName,
        fromSeller,
        text: input.text.trim(),
        offerPrice: input.offerPrice,
        replyToId: input.replyToId,
        createdAt: nowIso(),
      };
      const { error } = await sb().from('product_messages').insert({
        id: message.id,
        business_id: input.businessId,
        product_id: input.productId,
        author_id: input.authorId,
        data: message,
      });
      if (error) throw error;

      if (!fromSeller) {
        await notify({
          recipientId: business.ownerId,
          kind: 'product_question',
          title: `${input.authorName} on ${product.name}`,
          body: input.offerPrice
            ? `Offered ${input.offerPrice}${message.text ? ` — ${message.text}` : ''}`
            : message.text,
          businessId: business.id,
          productId: product.id,
        });
      } else if (input.replyToId) {
        const { data: answeredRow } = await sb()
          .from('product_messages')
          .select('data')
          .eq('id', input.replyToId)
          .maybeSingle();
        const answered = answeredRow?.data as ProductMessage | undefined;
        if (answered && answered.authorId !== input.authorId) {
          await notify({
            recipientId: answered.authorId,
            kind: 'product_reply',
            title: `${business.name} replied`,
            body: message.text || `About ${product.name}`,
            businessId: business.id,
            productId: product.id,
          });
        }
      }
      return message;
    },
  };
}
