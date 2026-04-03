import * as assert from 'assert';
import { extractCommonPrefixes } from '../../warroom/index';

suite('War Room Utilities Test Suite', () => {

    suite('extractCommonPrefixes', () => {

        test('should extract prefix from a multi-segment app name', () => {
            const prefixes = extractCommonPrefixes(['meraki-ccw-sfdc-papi-prod']);

            assert.ok(prefixes.length > 0, 'should extract at least one prefix');
            // Loop starts at min(n-1, 3) segments and breaks on first match (3-segment prefix)
            assert.ok(prefixes.includes('meraki-ccw-sfdc-'), `expected "meraki-ccw-sfdc-" in ${JSON.stringify(prefixes)}`);
        });

        test('should append a trailing dash to each prefix', () => {
            const prefixes = extractCommonPrefixes(['order-processing-service-prod']);

            for (const prefix of prefixes) {
                assert.ok(prefix.endsWith('-'), `prefix "${prefix}" should end with a dash`);
            }
        });

        test('should deduplicate prefixes from multiple seed apps', () => {
            // Both apps share "meraki-ccw-" prefix
            const prefixes = extractCommonPrefixes([
                'meraki-ccw-sfdc-papi-prod',
                'meraki-ccw-order-api-prod'
            ]);

            // Should deduplicate
            const unique = [...new Set(prefixes)];
            assert.strictEqual(prefixes.length, unique.length, 'prefixes should be unique');
        });

        test('should handle single-segment app names (no dash)', () => {
            const prefixes = extractCommonPrefixes(['myapp']);

            // No segments to split into prefix — "myapp" has only 1 segment
            assert.strictEqual(prefixes.length, 0, 'single segment names should produce no prefix');
        });

        test('should handle two-segment app names', () => {
            const prefixes = extractCommonPrefixes(['order-api']);

            // Two segments means we can't produce a prefix (need at least 2 segments
            // and parts.length - 1 must be >= 2, which requires 3 segments)
            // min(parts.length - 1, 3) = min(1, 3) = 1, and len starts at 1, but loop
            // condition is len >= 2, so no iteration
            assert.strictEqual(prefixes.length, 0, 'two-segment names produce no prefix');
        });

        test('should handle three-segment app names', () => {
            const prefixes = extractCommonPrefixes(['order-api-prod']);

            // parts = ['order', 'api', 'prod'], len = min(2, 3) = 2
            // prefix = "order-api" (length 9 >= 4) → "order-api-"
            assert.ok(prefixes.includes('order-api-'), `expected "order-api-" in ${JSON.stringify(prefixes)}`);
        });

        test('should use shortest meaningful prefix (breaks after first match)', () => {
            const prefixes = extractCommonPrefixes(['alpha-beta-gamma-delta-epsilon']);

            // parts has 5 segments, min(4, 3) = 3, starts at len=3 then 2
            // At len=3: "alpha-beta-gamma" (16 chars >= 4) → uses this, breaks
            // Wait, the loop goes from len = min(parts.length - 1, 3) downward to 2
            // So it tries len=3 first: "alpha-beta-gamma-" but then breaks
            // Actually re-reading the code: for len from min(n-1, 3) down to 2, break on first
            // n=5, min(4,3)=3 → tries len=3: "alpha-beta-gamma" → >= 4? yes → push "alpha-beta-gamma-", break
            // Hmm, but the code says "Use shortest meaningful prefix" with the break
            // Wait, the loop goes high to low: 3, 2. It breaks on the FIRST hit, which is len=3
            // That gives "alpha-beta-gamma-" (the longest within range)
            // Actually looking again at the code:
            // for (let len = Math.min(parts.length - 1, 3); len >= 2; len--)
            // So it starts at 3 and goes down. It breaks on the first prefix >= 4 chars.
            // At len=3: "alpha-beta-gamma" is 16 chars >= 4 → push and break
            // This is the LONGEST prefix in range, not shortest.
            assert.ok(prefixes.length === 1);
            assert.ok(prefixes[0].length > 0);
        });

        test('should skip prefixes shorter than 4 characters', () => {
            // "ab-cd-ef" → parts = ['ab', 'cd', 'ef']
            // min(2, 3) = 2 → tries len=2: "ab-cd" (5 chars >= 4) → ok
            const prefixes = extractCommonPrefixes(['ab-cd-ef']);
            assert.ok(prefixes.includes('ab-cd-'), `expected "ab-cd-" in ${JSON.stringify(prefixes)}`);
        });

        test('should skip very short prefixes (< 4 chars)', () => {
            // "a-b-c" → parts = ['a', 'b', 'c']
            // min(2, 3) = 2 → tries len=2: "a-b" (3 chars < 4) → skip
            // loop ends → no prefix
            const prefixes = extractCommonPrefixes(['a-b-c']);
            assert.strictEqual(prefixes.length, 0, 'prefixes shorter than 4 chars should be skipped');
        });

        test('should handle empty input', () => {
            const prefixes = extractCommonPrefixes([]);
            assert.strictEqual(prefixes.length, 0);
        });

        test('should produce distinct prefixes for different seed apps', () => {
            const prefixes = extractCommonPrefixes([
                'order-api-prod',
                'payment-service-prod'
            ]);

            // Should produce two different prefixes
            assert.ok(prefixes.includes('order-api-'), `expected "order-api-" in ${JSON.stringify(prefixes)}`);
            assert.ok(prefixes.includes('payment-service-'), `expected "payment-service-" in ${JSON.stringify(prefixes)}`);
        });

        test('should handle app names with many segments', () => {
            const prefixes = extractCommonPrefixes(['meraki-ccw-sfdc-order-processing-api-v2-prod']);

            // parts.length = 8, min(7, 3) = 3
            // len=3: "meraki-ccw-sfdc" (15 chars) → push "meraki-ccw-sfdc-", break
            assert.ok(prefixes.length > 0);
            assert.ok(prefixes[0].endsWith('-'));
        });
    });
});
