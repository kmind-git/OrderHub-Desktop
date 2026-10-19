import { useCallback, useEffect, useState } from "react";

function readPath(): string {
  const raw = window.location.hash.replace(/^#/, "");
  return raw || "/workspace";
}

export function useHashRoute() {
  const [path, setPath] = useState(readPath);

  useEffect(() => {
    const onChange = () => setPath(readPath());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((to: string) => {
    if (window.location.hash === `#${to}`) {
      setPath(to);
    } else {
      window.location.hash = to;
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  return { path, navigate };
}
