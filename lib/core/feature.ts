export type FeatureController = {
  start(): void | Promise<void>;
  stop(): void;
};

/** Reddit controllers may consume the shared, deduplicated mutation roots. */
export type RootFeatureController = FeatureController & {
  process(root: ParentNode): void;
};
