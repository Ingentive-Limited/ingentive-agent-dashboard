"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

export function Logo({ className }: { className?: string }) {
  const { resolvedTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (!mounted) {
    return <div className={`h-7 ${className || ""}`} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={
        resolvedTheme === "dark"
          ? "/ingentive-logo-light.svg"
          : "/ingentive-logo-dark.svg"
      }
      alt="Ingentive"
      className={`h-7 ${className || ""}`}
      style={{ width: "auto", maxWidth: "130px" }}
    />
  );
}
