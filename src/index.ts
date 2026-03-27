// rsc-tape public API
export { register } from './interceptor';
export { generateSingleHandler as createHandler, generateHandlers } from './msw-generator';
export { loadConfig, loadConfigSync } from './config';
export { detectFramework, detectFrameworkSync } from './framework-detect';
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
