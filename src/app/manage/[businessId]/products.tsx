/**
 * Products for sale — or, for a personal stall, the items in it. Same editor
 * either way; only the words change, because a seller lists "items" and a shop
 * lists "products".
 */
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import type { ProductItem } from '@/domain/types';
import { GoodsEditor } from '@/features/businesses/GoodsEditor';
import { ManageGate, type ManageFormProps } from '@/features/businesses/ManageGate';
import { Button } from '@/components/ui';
import { spacing } from '@/theme/theme';

export default function ManageProductsScreen() {
  return (
    <ManageGate
      title={(b) => (b.type === 'item' ? 'Items for sale' : 'Products')}
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
      <GoodsEditor
        value={products}
        onChange={setProducts}
        noun={isStall ? 'item' : 'product'}
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
