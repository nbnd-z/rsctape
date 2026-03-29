// rsc-tape public API
export { register } from './interceptor.js';
export { generateSingleHandler as createHandler, generateHandlers } from './msw-generator.js';
export { loadConfig, loadConfigSync } from './config.js';
export { detectFramework, detectFrameworkSync } from './framework-detect.js';
export type {
  Fixture,
  FixtureMeta,
  ParsedFormData,
  FormDataMetadata,
  RscTapeConfig,
  InterceptorOptions,
  FrameworkType,
  GenerateOptions,
} from './types.js';
