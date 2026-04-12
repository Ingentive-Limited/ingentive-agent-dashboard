"use client";

import { usePersistedState } from "@/hooks/use-persisted-state";
import { useCallback } from "react";

/**
 * Hook to manage favorite/pinned project IDs, persisted in localStorage.
 */
export function useFavorites() {
  const [favoriteIds, setFavoriteIds] = usePersistedState<string[]>(
    "ingentive-favorite-projects",
    []
  );

  const isFavorite = useCallback(
    (id: string) => favoriteIds.includes(id),
    [favoriteIds]
  );

  const toggleFavorite = useCallback(
    (id: string) => {
      setFavoriteIds((prev) =>
        prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]
      );
    },
    [setFavoriteIds]
  );

  return { favoriteIds, isFavorite, toggleFavorite };
}
