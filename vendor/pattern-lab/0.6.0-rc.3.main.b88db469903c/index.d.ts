/** Documents and plans are validated opaque payloads. The host's 1.0.0 public
 * contract is their authority; this module does not redefine their schema. */
export interface SourceSnapshot {
  projectId: string;
  revision: string | number;
  document: unknown;
}
export interface ExperimentDraft {
  labId: 'facet-pattern-lab';
  moduleVersion: string;
  contractVersion: '1.0.0';
  source: SourceSnapshot | null;
  plan: unknown;
}
export interface CandidateResult {
  document: unknown;
  source: SourceSnapshot | null;
  moduleVersion: string;
  contractVersion: '1.0.0';
  diagnostics: { warnings: string[]; compatibility: unknown };
}
export interface HostContext { signal: AbortSignal }
export type SessionOptions = ({ source: SourceSnapshot; newDesign?: never } | {
  source?: never;
  newDesign: { teeth?: number; symmetry?: number; density?: number; sizeMm?: number; name?: string };
}) & {
  /** embedded omits lab branding, project/file navigation and save status. */
  presentation?: { layout?: 'embedded' | 'standalone'; resultAction?: 'host' | 'module' };
  persistence?: {
    load?(context: HostContext): ExperimentDraft | null | Promise<ExperimentDraft | null>;
    save(draft: ExperimentDraft, context: HostContext): void | Promise<void>;
  };
  onResult?(candidate: CandidateResult, context: HostContext): void | Promise<void>;
  signal?: AbortSignal;
};
export interface LabSession {
  /** Wait for the latest draft save without generating a candidate or exiting. */
  flush(): Promise<void>;
  pause(): void;
  resume(): void;
  dispose(): void;
  returnResult(): Promise<CandidateResult | undefined>;
  /** Existing laboratory controller for diagnostics/tests. Hosts should use the
   * lifecycle and candidate methods above, not depend on internal state fields. */
  controller: object;
}
export declare const moduleInfo: Readonly<{
  id: 'facet-pattern-lab'; moduleVersion: string; contractVersion: '1.0.0';
  entryApiVersion: 2; react: '19.2.0'; reactStrategy: 'bundled-private-root';
}>;
export declare function createLabSession(options: SessionOptions): Promise<LabSession>;
export declare function mountPatternLab(element: HTMLElement, options: SessionOptions): Promise<LabSession>;
