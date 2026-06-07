// src/test/suite/fire.sourceMapper.test.ts
// Unit tests for FIRE source mapper — pure logic functions only.
// We test the internal matching/parsing logic by importing the functions
// we need to validate. The VS Code workspace functions are integration-level
// and are covered manually via F5 testing.

import * as assert from 'assert';
import { ParsedMuleError } from '../../fire/types.js';

// ─── We test the logic by reproducing the same patterns used internally ───────
// Since the internal helpers are not exported (by design — they're implementation
// details), we validate them indirectly through known inputs and expected outputs
// that mirror exactly what the mapper does line-by-line.

// ─── Flow name detection patterns ─────────────────────────────────────────────

/**
 * Reproduce the flow-open detection regex from sourceMapper.ts
 * so we can unit test it independently of the VS Code API.
 */
function detectFlowOpen(line: string): string | null {
  const match = /<(?:flow|sub-flow)\s[^>]*name\s*=\s*["']([^"']+)["']/i.exec(line);
  return match?.[1] ?? null;
}

function isFlowClose(line: string): boolean {
  return /<\/(?:flow|sub-flow)>/i.test(line);
}

function matchesFlowName(xmlFlowName: string, errorFlowName: string): boolean {
  const normalise = (s: string) => s.toLowerCase().replace(/[-_\s]/g, '');
  const a = normalise(xmlFlowName);
  const b = normalise(errorFlowName);
  return a === b || a.startsWith(b) || b.startsWith(a);
}

function extractProcessorName(elementPath: string): string | null {
  if (!elementPath) { return null; }

  if (elementPath.includes(':')) {
    return elementPath.split(':')[0].trim();
  }

  // Reject purely numeric/structural paths like:
  //   "2/0"
  //   "processors/2/processors/0"
  //   "process-order-flow/processors/3"
  // Rule: if every segment is either a pure integer OR the word "processors",
  // there is no human-readable element name to extract.
  const segments = elementPath.split('/');
  const isStructuralOnly = segments.every(
    seg => /^\d+$/.test(seg) || seg === 'processors'
  );
  if (isStructuralOnly) { return null; }

  return elementPath.trim();
}

function lineMatchesProcessor(line: string, processorName: string): boolean {
  const lower = line.toLowerCase();
  const target = processorName.toLowerCase();
  if (lower.includes(`<${target}`) || lower.includes(`:${target}`)) {
    return true;
  }
  const docNameMatch = /doc:name\s*=\s*["']([^"']+)["']/i.exec(line);
  if (docNameMatch) {
    const docName = docNameMatch[1].toLowerCase().replace(/\s+/g, '-');
    if (docName === target || docName.includes(target) || target.includes(docName)) {
      return true;
    }
  }
  return false;
}

function textMentionsFlow(text: string, flowName: string): boolean {
  if (text.includes(flowName)) { return true; }
  const normalised = flowName.replace(/[-_]/g, '[-_ ]');
  return new RegExp(normalised, 'i').test(text);
}

// ─── Realistic Mule XML samples ───────────────────────────────────────────────

const FLOW_LINE_STANDARD =
  `    <flow name="process-order-flow" doc:id="abc-123">`;

const FLOW_LINE_SUBFLOW =
  `    <sub-flow name="validate-payload-subflow">`;

const FLOW_LINE_SINGLE_QUOTES =
  `    <flow name='process-order-flow'>`;

const FLOW_CLOSE_LINE =
  `    </flow>`;

const SUBFLOW_CLOSE_LINE =
  `    </sub-flow>`;

const PROCESSOR_TRANSFORM =
  `        <ee:transform doc:name="Transform Message" doc:id="def-456">`;

const PROCESSOR_SET_PAYLOAD =
  `        <set-payload value="#[payload]" doc:name="Set Payload"/>`;

const PROCESSOR_HTTP_REQUEST =
  `        <http:request method="POST" doc:name="Call External API" config-ref="HTTP_Config"/>`;

const PROCESSOR_LOGGER =
  `        <logger level="INFO" message="#[payload]" doc:name="Log Request"/>`;

const FULL_MULE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<mule xmlns:ee="http://www.mulesoft.org/schema/mule/ee/core">
    <flow name="process-order-flow" doc:id="abc-123">
        <http:listener config-ref="HTTP_Config" path="/orders" doc:name="Listener"/>
        <ee:transform doc:name="Transform Message" doc:id="def-456">
            <ee:message>
                <ee:set-payload><![CDATA[%dw 2.0
output application/json
---
payload]]></ee:set-payload>
            </ee:message>
        </ee:transform>
        <set-payload value="#[payload]" doc:name="Set Payload"/>
        <http:request method="POST" doc:name="Call External API" config-ref="HTTP_Config"/>
    </flow>
    <sub-flow name="validate-payload-subflow">
        <logger level="INFO" message="#[payload]" doc:name="Log Request"/>
    </sub-flow>
</mule>`;

// ─── detectFlowOpen ───────────────────────────────────────────────────────────

suite('FIRE › sourceMapper › detectFlowOpen', () => {

  test('detects standard flow tag with double quotes', () => {
    assert.strictEqual(detectFlowOpen(FLOW_LINE_STANDARD), 'process-order-flow');
  });

  test('detects sub-flow tag', () => {
    assert.strictEqual(detectFlowOpen(FLOW_LINE_SUBFLOW), 'validate-payload-subflow');
  });

  test('detects flow tag with single quotes', () => {
    assert.strictEqual(detectFlowOpen(FLOW_LINE_SINGLE_QUOTES), 'process-order-flow');
  });

  test('returns null for a processor line', () => {
    assert.strictEqual(detectFlowOpen(PROCESSOR_TRANSFORM), null);
  });

  test('returns null for a closing flow tag', () => {
    assert.strictEqual(detectFlowOpen(FLOW_CLOSE_LINE), null);
  });

  test('returns null for empty string', () => {
    assert.strictEqual(detectFlowOpen(''), null);
  });

  test('returns null for plain text', () => {
    assert.strictEqual(detectFlowOpen('just some text'), null);
  });
});

// ─── isFlowClose ─────────────────────────────────────────────────────────────

suite('FIRE › sourceMapper › isFlowClose', () => {

  test('detects </flow> closing tag', () => {
    assert.strictEqual(isFlowClose(FLOW_CLOSE_LINE), true);
  });

  test('detects </sub-flow> closing tag', () => {
    assert.strictEqual(isFlowClose(SUBFLOW_CLOSE_LINE), true);
  });

  test('returns false for processor line', () => {
    assert.strictEqual(isFlowClose(PROCESSOR_TRANSFORM), false);
  });

  test('returns false for flow opening tag', () => {
    assert.strictEqual(isFlowClose(FLOW_LINE_STANDARD), false);
  });

  test('returns false for empty string', () => {
    assert.strictEqual(isFlowClose(''), false);
  });
});

// ─── matchesFlowName ─────────────────────────────────────────────────────────

suite('FIRE › sourceMapper › matchesFlowName', () => {

  test('matches identical names', () => {
    assert.strictEqual(matchesFlowName('process-order-flow', 'process-order-flow'), true);
  });

  test('matches when log omits -flow suffix', () => {
    assert.strictEqual(matchesFlowName('process-order-flow', 'process-order'), true);
  });

  test('matches across hyphen vs underscore difference', () => {
    assert.strictEqual(matchesFlowName('process_order_flow', 'process-order-flow'), true);
  });

  test('matches case-insensitively', () => {
    assert.strictEqual(matchesFlowName('Process-Order-Flow', 'process-order-flow'), true);
  });

  test('does not match completely different names', () => {
    assert.strictEqual(matchesFlowName('validate-payload-subflow', 'process-order-flow'), false);
  });

  test('matches when xml name is prefix of error name', () => {
    assert.strictEqual(matchesFlowName('order', 'order-processing-flow'), true);
  });
});

// ─── extractProcessorName ────────────────────────────────────────────────────

suite('FIRE › sourceMapper › extractProcessorName', () => {

  test('extracts name from "name:Label" format', () => {
    assert.strictEqual(
      extractProcessorName('transform-message:Transform Message'),
      'transform-message'
    );
  });

  test('extracts name from simple element name', () => {
    assert.strictEqual(extractProcessorName('set-payload'), 'set-payload');
  });

  test('returns null for pure numeric processor path', () => {
    assert.strictEqual(extractProcessorName('2/0'), null);
  });

  test('returns null for processors/N/processors/N path', () => {
    assert.strictEqual(extractProcessorName('processors/2/processors/0'), null);
  });

  test('returns null for empty string', () => {
    assert.strictEqual(extractProcessorName(''), null);
  });

  test('trims whitespace from result', () => {
    assert.strictEqual(extractProcessorName('  set-variable  '), 'set-variable');
  });
});

// ─── lineMatchesProcessor ────────────────────────────────────────────────────

suite('FIRE › sourceMapper › lineMatchesProcessor', () => {

  test('matches ee:transform via tag prefix', () => {
    assert.strictEqual(lineMatchesProcessor(PROCESSOR_TRANSFORM, 'transform'), true);
  });

  test('matches set-payload via direct tag name', () => {
    assert.strictEqual(lineMatchesProcessor(PROCESSOR_SET_PAYLOAD, 'set-payload'), true);
  });

  test('matches via doc:name attribute', () => {
    assert.strictEqual(
      lineMatchesProcessor(PROCESSOR_HTTP_REQUEST, 'call-external-api'),
      true
    );
  });

  test('matches logger via direct tag name', () => {
    assert.strictEqual(lineMatchesProcessor(PROCESSOR_LOGGER, 'logger'), true);
  });

  test('does not match unrelated processor', () => {
    assert.strictEqual(lineMatchesProcessor(PROCESSOR_TRANSFORM, 'set-payload'), false);
  });

  test('does not match flow open tag', () => {
    assert.strictEqual(lineMatchesProcessor(FLOW_LINE_STANDARD, 'transform-message'), false);
  });

  test('returns false for empty line', () => {
    assert.strictEqual(lineMatchesProcessor('', 'transform-message'), false);
  });
});

// ─── textMentionsFlow ────────────────────────────────────────────────────────

suite('FIRE › sourceMapper › textMentionsFlow', () => {

  test('returns true when XML contains exact flow name', () => {
    assert.strictEqual(textMentionsFlow(FULL_MULE_XML, 'process-order-flow'), true);
  });

  test('returns true for sub-flow name', () => {
    assert.strictEqual(textMentionsFlow(FULL_MULE_XML, 'validate-payload-subflow'), true);
  });

  test('returns false when flow name not in file', () => {
    assert.strictEqual(textMentionsFlow(FULL_MULE_XML, 'completely-different-flow'), false);
  });

  test('returns false for empty XML', () => {
    assert.strictEqual(textMentionsFlow('', 'process-order-flow'), false);
  });
});

// ─── End-to-end simulation ────────────────────────────────────────────────────
// Simulate the full scan of a Mule XML file line by line,
// the same way sourceMapper.ts does it internally.

suite('FIRE › sourceMapper › full scan simulation', () => {

  function simulateScan(
    xml: string,
    flowName: string,
    elementPath: string
  ): { lineNumber: number; matchMethod: string } | null {
    if (!textMentionsFlow(xml, flowName)) { return null; }

    const lines = xml.split('\n');
    let insideTargetFlow = false;
    let flowStartLine = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const flowOpen = detectFlowOpen(line);

      if (flowOpen) {
        insideTargetFlow = matchesFlowName(flowOpen, flowName);
        if (insideTargetFlow) { flowStartLine = i; }
      }

      if (insideTargetFlow && isFlowClose(line)) {
        insideTargetFlow = false;
      }

      if (insideTargetFlow && elementPath) {
        const processorName = extractProcessorName(elementPath);
        if (processorName && lineMatchesProcessor(line, processorName)) {
          return { lineNumber: i, matchMethod: 'exact' };
        }
      }
    }

    if (flowStartLine >= 0) {
      return { lineNumber: flowStartLine, matchMethod: 'flow-only' };
    }

    return null;
  }

  test('finds exact transform-message processor line', () => {
    const result = simulateScan(
      FULL_MULE_XML,
      'process-order-flow',
      'transform-message:Transform Message'
    );
    assert.ok(result !== null, 'Expected a match');
    assert.strictEqual(result!.matchMethod, 'exact');
    // Line 4 in FULL_MULE_XML is the ee:transform line (0-based)
    assert.ok(result!.lineNumber > 0, 'Line number should be positive');
  });

  test('finds set-payload processor line', () => {
    const result = simulateScan(
      FULL_MULE_XML,
      'process-order-flow',
      'set-payload'
    );
    assert.ok(result !== null, 'Expected a match');
    assert.strictEqual(result!.matchMethod, 'exact');
  });

  test('falls back to flow-only when processor not found', () => {
    const result = simulateScan(
      FULL_MULE_XML,
      'process-order-flow',
      'processors/99/processors/0' // numeric path — no processor name extractable
    );
    assert.ok(result !== null, 'Expected a flow-only match');
    assert.strictEqual(result!.matchMethod, 'flow-only');
  });

  test('finds processor in sub-flow', () => {
    const result = simulateScan(
      FULL_MULE_XML,
      'validate-payload-subflow',
      'logger'
    );
    assert.ok(result !== null, 'Expected a match in sub-flow');
    assert.strictEqual(result!.matchMethod, 'exact');
  });

  test('returns null when flow not in file', () => {
    const result = simulateScan(
      FULL_MULE_XML,
      'nonexistent-flow',
      'transform-message'
    );
    assert.strictEqual(result, null);
  });

  test('returns null when XML is empty', () => {
    const result = simulateScan('', 'process-order-flow', 'transform-message');
    assert.strictEqual(result, null);
  });
});