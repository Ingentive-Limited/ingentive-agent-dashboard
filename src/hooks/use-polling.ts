import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function usePolling<T>(url: string, interval = 5000) {
  return useSWR<T>(url, fetcher, {
    refreshInterval: interval,
    revalidateOnFocus: true,
    dedupingInterval: 2000,
  });
}
