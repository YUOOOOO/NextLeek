import { Star } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

export function WatchlistToggle({ symbol, name }: { symbol: string; name?: string | null }) {
  const queryClient = useQueryClient();
  const watchlist = useQuery({
    queryKey: queryKeys.watchlist,
    queryFn: api.listWatchlist,
  });
  const saved = watchlist.data?.items.some((item) => item.symbol === symbol) ?? false;

  const add = useMutation({
    mutationFn: () => api.addWatchlist({ symbol, name: name || undefined }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.watchlist });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.removeWatchlist(symbol),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.watchlist });
    },
  });

  const pending = add.isPending || remove.isPending;
  return (
    <button
      type="button"
      className={`btn-quiet wl-star${saved ? " is-on" : ""}`}
      disabled={pending || !symbol}
      onClick={() => (saved ? remove.mutate() : add.mutate())}
    >
      <Star size={16} fill={saved ? "currentColor" : "none"} />
      {saved ? "已自选" : "加自选"}
    </button>
  );
}
