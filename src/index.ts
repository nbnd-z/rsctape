// rsc-tape public API
export { register } from './interceptor';
export { generateSingleHandler as createHandler, generateHandlers } from './msw-generator';
export { loadConfig } from './config';
export { detectFramework } from './framework-detect';
export type {
  Fixture,
  FixtureMeta,
  ParsedFormData,
  FormDataMetadata,
  RscTapeConfig,
  InterceptorOptions,
  FrameworkType,
  GenerateOptions,
} from './types';
