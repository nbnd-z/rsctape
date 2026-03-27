import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { generateSingleHandler } from './msw-generator';
import type { Fixture } from './types';

/** Arbitrary: random action IDs including special chars, numbers, unicode */
const actionIdArb = fc.oneof(
  // Alphanumeric with dashes/underscores
  fc.stringOf(
    fc.oneof(
      fc.char().filter((c) => /[a-zA-Z0-9]/.test(c)),
      fc.constant('-'),
      fc.constant('_'),
      fc.constant('/'),
      fc.constant(':')
    ),
    { minLength: 1, maxLength: 60 }
  ),
  // Starting with digits
  fc.tuple(
    fc.stringOf(fc.char().filter((c) => /[0-9]/.test(c)), { minLength: 1, maxLength: 5 }),
    fc.stringOf(fc.char().filter((c) => /[a-zA-Z0-9_]/.test(c)), { minLength: 0, maxLength: 30 })
  ).map(([digits, rest]) => digits + rest),
  // Unicode characters
  fc.unicodeString({ minLength: 1, maxLength: 40 }),
  // Special characters mixed
  fc.stringOf(
    fc.oneof(
      fc.char().filter((c) => /[a-zA-Z0-9]/.test(c)),
      fc.constant('.'),
      fc.constant('$'),
      fc.constant('#'),
      fc.constant('@')
    ),
    { minLength: 1, maxLength: 40 }
  )
);

/** Arbitrary: random RSC payload strings */
const rscPayloadArb = fc.oneof(
  fc.string({ minLength: 0, maxLength: 500 }),
  fc.unicodeString({ minLength: 0, maxLength: 300 }),
  fc.array(
    fc.tuple(fc.nat({ max: 20 }), fc.string({ minLength: 1, maxLength: 100 })).map(
      ([idx, content]) => `${idx}:${content}`
    ),
    { minLength: 1, maxLength: 10 }
  ).map((lines) => lines.join('\n') + '\n')
);

function makeFixture(output: string): Fixture {
  return { input: { key: 'value' }, output };
}

/**
 * Property P7: MSW Handler Correct Matching (MSW Handler 正確比對)
 * Validates: Requirements 5.1, 5.2
 */
describe('P7: MSW Handler Correct Matching', () => {
  /**
   * **Validates: Requirements 5.1**
   * Handler code contains exact action ID in header check:
   * For any random action ID string, the generated handler code must contain
   * a check against `request.headers.get('Next-Action') !== '{actionId}'`
   * with the EXACT original action ID (not sanitized).
   */
  it('handler code checks Next-Action header against exact original action ID', () => {
    fc.assert(
      fc.property(actionIdArb, rscPayloadArb, (actionId, payload) => {
        const fixture = makeFixture(payload);
        const code = generateSingleHandler(actionId, fixture);

        const escapedId = actionId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        expect(code).toContain(
          `request.headers.get('Next-Action') !== '${escapedId}'`
        );
      }),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 5.2**
   * Handler code uses http.post method:
   * For any random action ID and fixture, the generated handler must use `http.post('*')`.
   */
  it('handler code uses http.post method', () => {
    fc.assert(
      fc.property(actionIdArb, rscPayloadArb, (actionId, payload) => {
        const fixture = makeFixture(payload);
        const code = generateSingleHandler(actionId, fixture);

        expect(code).toContain("http.post('*'");
      }),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 5.1, 5.2**
   * Handler variable name is a valid JS identifier:
   * For any random action ID, the generated handler's export name (`handle_xxx`)
   * must be a valid JavaScript identifier (matches /^[a-zA-Z_][a-zA-Z0-9_]*$/).
   */
  it('handler export name is a valid JavaScript identifier', () => {
    fc.assert(
      fc.property(actionIdArb, rscPayloadArb, (actionId, payload) => {
        const fixture = makeFixture(payload);
        const code = generateSingleHandler(actionId, fixture);

        // Extract the handler name from `export const handle_xxx = ...`
        const match = code.match(/export const (\w+)\s*=/);
        expect(match).not.toBeNull();

        const handlerName = match![1];
        expect(handlerName).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*$/);
      }),
      { numRuns: 200 }
    );
  });
});

/**
 * Reverse the escapeTemplateLiteral transformation.
 * The generator escapes: \ → \\, ` → \`, $ → \$
 * This helper reverses: \$ → $, \` → `, \\ → \
 */
function unescapeTemplateLiteral(str: string): string {
  return str
    .replace(/\\\$/g, '$')
    .replace(/\\`/g, '`')
    .replace(/\\\\/g, '\\');
}

/**
 * Property P8: MSW Handler Response Fidelity (MSW Handler 回應忠實性)
 * Validates: Requirements 5.3
 */
describe('P8: MSW Handler Response Fidelity', () => {
  /**
   * **Validates: Requirements 5.3**
   * Handler response contains text/x-component content type:
   * For any random fixture, the generated handler code must set
   * Content-Type to text/x-component.
   */
  it('handler code sets Content-Type to text/x-component', () => {
    fc.assert(
      fc.property(actionIdArb, rscPayloadArb, (actionId, payload) => {
        const fixture = makeFixture(payload);
        const code = generateSingleHandler(actionId, fixture);

        expect(code).toContain("'Content-Type': 'text/x-component'");
      }),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 5.3**
   * Handler response body matches fixture output:
   * For any random RSC payload, the escaped payload embedded in the
   * template literal, when unescaped, must equal the original fixture.output.
   */
  it('escaped payload in template literal round-trips to original output', () => {
    fc.assert(
      fc.property(actionIdArb, rscPayloadArb, (actionId, payload) => {
        const fixture = makeFixture(payload);
        const code = generateSingleHandler(actionId, fixture);

        // Extract the content between the backticks in: new HttpResponse(`...`, {
        const match = code.match(/new HttpResponse\(`([\s\S]*?)`,\s*\{/);
        expect(match).not.toBeNull();

        const escapedContent = match![1];
        const unescaped = unescapeTemplateLiteral(escapedContent);

        expect(unescaped).toBe(fixture.output);
      }),
      { numRuns: 200 }
    );
  });
});
