/**
 * Products for sale — or, for a personal stall, the items in it. Same editor
 * either way; only the words change, because a seller lists "items" and a shop
 * lists "products".
 */
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import type { ProductItem } from '@/domain/types';
import { ManageGate, type ManageFormProps } from '@/features/businesses/ManageGate';
import { OfferingsEditor } from '@/features/businesses/OfferingsEditor';
import { Button } from '@/components/ui';
import { spacing } from '@/theme/theme';

export default function ManageProductsScreen() {
  return (
    <ManageGate
      title={(b) => (b.type === 'item' ? 'Items for sale' : 'Products')}
      intro={(b) =>
        b.type === 'item'
          ? 'Everything in your stall — buyers browse these and send you a purchase request.'
          : 'What you sell, with a price on each. Customers pick from these when they order, and your team quick-adds them onto bills.'
      }
      need="offerings"
      what="products"
      Form={ProductsForm}
    />
  );
}

function ProductsForm({ business, save, saving }: ManageFormProps) {
  const isStall = business.type === 'item';
  const [products, setProducts] = useState<ProductItem[]>(business.products ?? []);

  return (
    <>
      <OfferingsEditor
        value={products}
        onChange={setProducts}
        namePlaceholder={
          isStall ? 'Item (e.g. iPhone 15 Pro)' : 'Product (e.g. Touring tyre 205/55 R16)'
        }
        addLabel={isStall ? 'Add item' : 'Add product'}
        // Buyers browse stalls picture-first, so items sell on their photo.
        withImage
      />
      <Button
        title="Save"
        onPress={() => save({ products: products.length > 0 ? products : undefined })}
        loading={saving}
        style={styles.save}
      />
    </>
  );
}

const styles = StyleSheet.create({
  save: { marginTop: spacing.lg },
});
