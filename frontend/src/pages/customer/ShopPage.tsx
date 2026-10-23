import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { PackageX, Plus } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { products, type Product } from "../../api";
import { maxQuantityFor, useCart } from "../../cart/CartContext";
import {
  Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, Pagination, Select, Skeleton, useToast,
} from "../../components/ui";
import { cn } from "../../lib/cn";
import { formatInr, formatNumber } from "../../lib/format";
import { ProductDrawer } from "./ProductDrawer";
import { stockLabel } from "./stock";

const PAGE_SIZE = 24;

// The products API sorts by name, unit_price or stock (prefix - for descending).
const SORTS = [
  { value: "name", label: "Name, A to Z" },
  { value: "unit_price", label: "Price, low to high" },
  { value: "-unit_price", label: "Price, high to low" },
  { value: "-stock", label: "Most in stock" },
];

function ProductCard({ product, onOpen }: { product: Product; onOpen: () => void }) {
  const cart = useCart();
  const toast = useToast();
  const inCart = cart.lines.find((line) => line.product.id === product.id)?.quantity ?? 0;
  const max = maxQuantityFor(product);
  const stock = stockLabel(product.stock);

  return (
    <li className="group flex flex-col overflow-hidden rounded-card border border-line bg-white shadow-card transition duration-200 hover:-translate-y-0.5 hover:shadow-raised">
      <button type="button" onClick={onOpen} className="focus-ring flex flex-1 flex-col rounded-t-card text-left" aria-label={`View ${product.name}`}>
        <div className="aspect-[4/3] w-full overflow-hidden border-b border-line-soft bg-page">
          {product.image_url && (
            <img src={product.image_url} alt="" loading="lazy"
              className="h-full w-full object-contain p-6 transition duration-300 group-hover:scale-[1.03]" />
          )}
        </div>
        <div className="flex flex-1 flex-col p-4">
          <p className="text-2xs font-semibold uppercase text-ink-subtle">{product.category}</p>
          <h3 className="mt-1 text-base font-medium leading-snug text-ink">{product.name}</h3>
          <p className="mt-0.5 font-mono text-xs text-ink-faint">{product.sku}</p>
          <div className="mt-auto pt-3">
            <p className="text-lg font-semibold tabular-nums text-ink">{formatInr(product.unit_price)}</p>
            <p className={cn("text-xs", stock.tone)}>{stock.text}</p>
          </div>
        </div>
      </button>
      <div className="flex items-center justify-between gap-2 px-4 pb-4">
        <span className="text-xs text-ink-subtle" aria-live="polite">{inCart > 0 ? `${formatNumber(inCart)} in cart` : ""}</span>
        <Button
          size="sm"
          variant={inCart > 0 ? "secondary" : "primary"}
          icon={<Plus className="h-4 w-4" aria-hidden="true" />}
          disabled={max === 0 || inCart >= max}
          aria-label={`Add ${product.name} to cart`}
          onClick={() => {
            cart.add(product);
            toast({ tone: "success", title: "Added to cart", description: product.name });
          }}
        >
          {inCart >= max && max > 0 ? "Max in cart" : "Add to cart"}
        </Button>
      </div>
    </li>
  );
}

function ProductGridSkeleton() {
  return (
    <LoadingState label="Loading products" className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-card border border-line bg-white shadow-card">
          <Skeleton className="aspect-[4/3] w-full rounded-none" />
          <div className="space-y-2 p-4">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-5 w-1/3" />
          </div>
        </div>
      ))}
    </LoadingState>
  );
}

export function ShopPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const category = params.get("category") ?? "";
  const sort = params.get("sort") ?? "name";
  const inStock = params.get("in_stock") === "true";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [openProduct, setOpenProduct] = useState<Product | null>(null);

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!("page" in changes)) next.delete("page");
    setParams(next, { replace: true });
  };

  // No categories endpoint: the chips come from the catalogue itself (20 products).
  const all = useQuery({ queryKey: ["products", "all"], queryFn: () => products.list({ page_size: 100 }), staleTime: 5 * 60_000 });
  const categories = [...new Set(all.data?.items.map((p) => p.category) ?? [])].sort();

  const list = useQuery({
    queryKey: ["products", { q, category, sort, inStock, page }],
    queryFn: () => products.list({ q: q || undefined, category: category || undefined, sort, in_stock: inStock || undefined,
      page, page_size: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const hasFilters = Boolean(q || category || inStock);

  return (
    <>
      <PageHeader
        title="Shop"
        description="Seeds, fertilisers, crop protection and equipment, at today's prices."
      />

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
          {["", ...categories].map((name) => {
            const active = category === name;
            return (
              <button
                key={name || "all"}
                type="button"
                aria-pressed={active}
                onClick={() => update({ category: name || null })}
                className={cn(
                  "focus-ring rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                  active ? "border-accent-600 bg-accent-600 text-white" : "border-line-strong bg-white text-ink-muted hover:border-accent-300 hover:text-accent-700",
                )}
              >
                {name || "All products"}
              </button>
            );
          })}
          {all.isPending && <Skeleton className="h-8 w-56 rounded-full" />}
        </div>
        <div className="flex items-end gap-4">
          <label className="flex h-10 items-center gap-2 text-sm text-ink-muted">
            <input type="checkbox" checked={inStock} onChange={(e) => update({ in_stock: e.target.checked ? "true" : null })}
              className="h-4 w-4 rounded border-line-strong text-accent-600 focus-visible:shadow-focus" />
            In stock only
          </label>
          <div className="w-48">
            <Select label="Sort by" hideLabel options={SORTS} value={sort} onChange={(e) => update({ sort: e.target.value })} />
          </div>
        </div>
      </div>

      {q && (
        <p className="mb-4 text-sm text-ink-muted" aria-live="polite">
          Results for <span className="font-medium text-ink">"{q}"</span>
          {list.data && ` · ${list.data.total} ${list.data.total === 1 ? "product" : "products"}`}
        </p>
      )}

      {list.isPending ? (
        <ProductGridSkeleton />
      ) : list.isError ? (
        <Card><ErrorState title="Couldn't load the catalogue" message={list.error.message} onRetry={() => void list.refetch()} /></Card>
      ) : list.data.items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<PackageX className="h-6 w-6" />}
            title={hasFilters ? "No products match" : "The catalogue is empty"}
            description={hasFilters ? "Try another search or category." : "Products will appear here once they're added."}
            action={hasFilters ? (
              <Button variant="secondary" size="sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear filters</Button>
            ) : undefined}
          />
        </Card>
      ) : (
        <>
          <ul aria-label="Products" className={cn("grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4", list.isFetching && "opacity-70 transition-opacity")}>
            {list.data.items.map((product) => (
              <ProductCard key={product.id} product={product} onOpen={() => setOpenProduct(product)} />
            ))}
          </ul>
          {list.data.total > PAGE_SIZE && (
            <Card className="mt-6">
              <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} noun="products"
                onPageChange={(p) => update({ page: String(p) })} />
            </Card>
          )}
        </>
      )}

      <ProductDrawer product={openProduct} onClose={() => setOpenProduct(null)} />
    </>
  );
}
