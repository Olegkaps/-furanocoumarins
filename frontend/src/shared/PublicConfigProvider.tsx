import { useEffect, useState, type ReactNode } from "react";
import { PublicConfigContext, loadPublicConfig, type PublicConfig } from "./publicConfig";

export function PublicConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfig>({});

  useEffect(() => {
    const controller = new AbortController();
    void loadPublicConfig(controller.signal).then(config => {
      if (!controller.signal.aborted) setConfig(config);
    });
    return () => controller.abort();
  }, []);

  return <PublicConfigContext.Provider value={config}>{children}</PublicConfigContext.Provider>;
}
