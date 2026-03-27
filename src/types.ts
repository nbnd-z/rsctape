/**
 * Supported RSC framework types detected from project or FormData patterns.
 */
export type FrameworkType = 'next' | 'waku' | 'parcel' | 'unknown';

/**
 * Metadata extracted from FormData parsing, describing the invocation
 * pattern and framework-specific serialization details.
 */
export interface FormDataMetadata {
  invocationType: 'programmatic' | 'form';
  frameworkHint: FrameworkType;
  actionId?: string;
  actionRef?: string;
  args?: unknown[];
  unknownPrefixes?: string[];
  checkboxFields?: string[];
  parseFailed?: boolean;
}

/**
 * Result of parsing a multipart/form-data request body into
 * structured fields and framework metadata.
 */
export interface ParsedFormData {
  fields: Record<string, unknown>;
  metadata: FormDataMetadata;
}

/**
 * A captured Server Action fixture containing the parsed input
 * and raw RSC Payload output.
 */
export interface Fixture {
  input: Record<string, unknown>;
  output: string;
}

/**
 * Metadata associated with a captured fixture, recording HTTP
 * request/response details and timing information.
 */
export interface FixtureMeta {
  actionId: string;
  url: string;
  method: string;
  statusCode: number;
  contentType: string;
  timestamp: string;
  error?: boolean;
  formDataMetadata?: FormDataMetadata;
}

/**
 * Configuration for rsc-tape loaded from rsctape.config.json.
 */
export interface RscTapeConfig {
  fixtureDir: string;
  ignore: string[];
}

/**
 * Options for the HTTP interceptor controlling capture behavior.
 */
export interface InterceptorOptions {
  fixtureDir: string;
  ignore: string[];
  verbose: boolean;
}

/**
 * Options for MSW handler generation from fixtures.
 */
export interface GenerateOptions {
  fixtureDir: string;
  outputPath: string;
  actionIds?: string[];
}
