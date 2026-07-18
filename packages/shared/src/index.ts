export * from "./domain/types";
export * from "./domain/facts";
export * from "./events";
export * from "./outbox";
export * from "./store";
export * from "./repositories/interfaces";
export * from "./repositories/mock";
export { GOLDEN_KEY_PIPELINE, SYNTHETIC_NOW, syntheticDatabase } from "./data/synthetic";
export type { SyntheticDatabase } from "./data/synthetic";

// Facade re-exports: the rules kernel and AI boundary are separate packages
// (charter monorepo layout); re-exported here so consumers keep one surface.
export * from "@aflo/rules";
export * from "@aflo/ai";
