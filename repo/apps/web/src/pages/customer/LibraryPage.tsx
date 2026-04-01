import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { QueryBoundary } from '../../components/common/QueryBoundary';
import { useAppContext } from '../../context/AppContext';
import { graphQLRequest } from '../../lib/api';
import { currency } from '../../lib/format';
import { catalogQuery } from '../../lib/queries';
import type { CatalogResponse } from '../../lib/types';

export function LibraryPage() {
  const { session } = useAppContext();
  const navigate = useNavigate();
  const catalog = useQuery({
    queryKey: ['catalog'],
    queryFn: () => graphQLRequest<CatalogResponse>(catalogQuery, undefined, session!),
  });
  const hasTitles =
    (catalog.data?.catalog.bestSellers.length ?? 0) + (catalog.data?.catalog.featured.length ?? 0) > 0;

  return (
    <QueryBoundary
      isPending={catalog.isPending}
      isError={catalog.isError}
      isEmpty={!hasTitles}
      emptyTitle="Catalog Empty"
      emptyMessage="No seeded titles are available in the local catalog yet."
      errorMessage="The catalog could not be loaded from the local GraphQL service."
      onRetry={() => void catalog.refetch()}
      loading={
        <div className="space-y-8">
          <section className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="skeleton h-64" />
            <div className="skeleton h-64" />
          </section>
          <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            <div className="skeleton h-56" />
            <div className="skeleton h-56" />
            <div className="skeleton h-56" />
          </section>
        </div>
      }
    >
      <div className="space-y-8">
        <section className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-[2rem] bg-ink p-8 text-white">
            <p className="font-ui text-xs uppercase tracking-[0.35em] text-white/55">Offline Reader</p>
            <h2 className="mt-4 font-display text-5xl">Open a title, keep it encrypted, and keep reading.</h2>
            <p className="mt-4 max-w-xl font-ui text-sm text-white/70">
              GraphQL serves the current chapter payloads. IndexedDB keeps an AES-encrypted copy sealed with a
              per-user non-extractable browser key so offline reopen does not depend on clear-text secrets in browser
              storage.
            </p>
          </div>
          <div className="shell-panel p-6">
            <p className="font-ui text-sm uppercase tracking-[0.25em] text-black/45 dark:text-white/45">
              Best Sellers
            </p>
            <div className="mt-5 space-y-3">
              {(catalog.data?.catalog.bestSellers ?? []).map((title, index) => (
                <button
                  key={title.id}
                  className="flex w-full items-center justify-between rounded-2xl border border-black/10 px-4 py-3 text-left transition hover:border-black/25 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
                  onClick={() => navigate(`/app/reader/${title.id}`)}
                >
                  <span>
                    <span className="block font-ui text-xs uppercase tracking-[0.2em] text-black/40 dark:text-white/45">
                      #{index + 1}
                    </span>
                    <span className="block pt-1 font-display text-2xl">{title.name}</span>
                  </span>
                  <span className="font-ui text-sm opacity-70">{currency(title.price)}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {(catalog.data?.catalog.featured ?? []).map((title) => (
            <article
              key={title.id}
              className="shell-panel cursor-pointer p-6 transition hover:-translate-y-1"
              onClick={() => navigate(`/app/reader/${title.id}`)}
            >
              <p className="font-ui text-xs uppercase tracking-[0.2em] text-black/40 dark:text-white/45">
                {title.format}
              </p>
              <h3 className="mt-3 font-display text-3xl">{title.name}</h3>
              <p className="mt-3 font-ui text-sm text-black/60 dark:text-white/60">{title.authorName}</p>
              <div className="mt-6 flex items-center justify-between font-ui text-sm">
                <span>{currency(title.price)}</span>
                <span>{title.inventoryOnHand} in stock</span>
              </div>
            </article>
          ))}
        </section>
      </div>
    </QueryBoundary>
  );
}
