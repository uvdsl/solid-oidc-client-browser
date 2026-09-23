export interface WorkerIntegrityPlugins {
  computeWorkerIntegrity: {
    name: string;
    generateBundle(options: unknown, bundle: Record<string, { type: string; code: string }>): void;
  };
  injectWorkerIntegrity: {
    name: string;
    transform(code: string, id: string): { code: string; map: null } | null;
  };
}

export function createWorkerIntegrityPlugins(): WorkerIntegrityPlugins;
