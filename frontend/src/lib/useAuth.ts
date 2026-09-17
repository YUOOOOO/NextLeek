import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { queryKeys } from "./queryKeys";

export function useAuthStatus() {
  return useQuery({
    queryKey: queryKeys.authStatus,
    queryFn: api.authStatus,
    retry: false,
  });
}

export function useCurrentUser(enabled = true) {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: api.me,
    enabled,
    retry: false,
  });
}
