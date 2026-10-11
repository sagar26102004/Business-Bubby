import { priceLabel, type CatalogBucket } from '@/lib/catalog';
import { THUMB_WIDTH, sized } from '@/lib/media';

/**
 * One offering list (menu, services, plans, rentals or products), shown the way
 * the app's catalog screen shows it: collapsible sections, folders inside, a
 * row per item with its photo. Plain <details> — no JavaScript needed.
 */
export function Catalog({ bucket }: { bucket: CatalogBucket }) {
  return (
    <section className="block" id={bucket.bucket}>
      <h2>
        {bucket.icon} {bucket.title} <small>{bucket.count}</small>
      </h2>
      {bucket.sections.map((section, i) => (
        <details key={section.title} className="card cat" open={i < 2}>
          <summary>
            {section.title}
            <span className="muted">{section.count}</span>
          </summary>
          {section.folders.map((folder) => (
            <div key={folder.path || '_root'}>
              {folder.path && <div className="folder-title">{folder.path}</div>}
              {folder.items.map((item, j) => (
                <div className="item" key={`${item.name}-${j}`}>
                  <div className="item-body">
                    <div className={`item-name${item.sold ? ' sold' : ''}`}>
                      {item.isVeg !== undefined && (
                        <span
                          className={`veg ${item.isVeg ? 'veg-yes' : 'veg-no'}`}
                          aria-label={item.isVeg ? 'Veg' : 'Non-veg'}
                        />
                      )}
                      {item.name}
                    </div>
                    {item.detail && <div className="item-desc">{item.detail}</div>}
                    {item.description && <div className="item-desc">{item.description}</div>}
                    {(item.price || item.badge || item.sold) && (
                      <div className="item-price">
                        {priceLabel(item.price)}
                        {item.badge && <span className="chip chip-sticker">{item.badge}</span>}
                        {item.sold && <span className="chip chip-closed">Sold</span>}
                      </div>
                    )}
                  </div>
                  {item.imageUrl && (
                    <img src={sized(item.imageUrl, THUMB_WIDTH)} alt="" loading="lazy" />
                  )}
                </div>
              ))}
            </div>
          ))}
        </details>
      ))}
    </section>
  );
}
