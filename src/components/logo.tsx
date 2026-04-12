"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function Logo({ className }: { className?: string }) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

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
