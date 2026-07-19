export * from "./domain/types";
export * from "./domain/facts";
export * from "./domain/resolution";
export * from "./domain/credit";
export * from "./domain/opportunity";
export * from "./events";
export * from "./outbox";
export * from "./store";
export * from "./repositories/interfaces";
export * from "./repositories/mock";
export { GOLDEN_KEY_INTAKE, GOLDEN_KEY_PIPELINE, SYNTHETIC_NOW, syntheticDatabase } from "./data/synthetic";
export type { SyntheticDatabase } from "./data/synthetic";

// Facade re-exports: the rules kernel, AI boundary, and notifications kernel
// are separate packages (charter monorepo layout); re-exported here so
// consumers keep one import surface.
export * from "@aflo/rules";
export * from "@aflo/ai";
export * from "@aflo/credit-data";
export * from "@aflo/notifications";
export * from "@aflo/opportunity-intelligence";
export * from "@aflo/academy";
export * from "@aflo/partner-marketplace";
// Security types only (type-only re-export): the signing functions use
// node:crypto and must stay server-side. Types are erased at compile time, so
// this keeps the UI's handoff types on one import surface without pulling any
// crypto runtime into a client bundle.
export type { HandoffFacts, HandoffPackage, HandoffVerification, HandoffVerdict } from "@aflo/security";
