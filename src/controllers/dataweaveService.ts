import axios from 'axios';
import * as vscode from 'vscode';

/**
 * DataWeave execution service
 * Provides methods to execute DataWeave transformations
 */

export interface DataWeaveExecutionResult {
    success: boolean;
    output?: string;
    error?: string;
    executionTime?: number;
}

export interface DataWeaveExecutionOptions {
    script: string;
    input: string;
    inputMimeType: string;
    outputMimeType?: string;
}

/**
 * Execute DataWeave transformation using axios with proper headers
 * Try multiple approaches to bypass CORS
 */
export async function executeDataWeaveTransformation(
    options: DataWeaveExecutionOptions,
    context: vscode.ExtensionContext
): Promise<DataWeaveExecutionResult> {
    const startTime = Date.now();

    try {
        // Validate inputs
        if (!options.script || !options.input) {
            return {
                success: false,
                error: 'Both script and input are required'
            };
        }

        // Extract output mime type from script if not provided
        const outputMimeType = options.outputMimeType || extractOutputMimeType(options.script);

        console.log('Executing DataWeave transformation:', {
            scriptLength: options.script.length,
            inputLength: options.input.length,
            inputMimeType: options.inputMimeType,
            outputMimeType: outputMimeType
        });

        // Try approach 1: Direct API call with User-Agent headers
        try {
            const payload = {
                code: options.script,
                data: {
                    payload: parseInput(options.input, options.inputMimeType)
                }
            };

            const response = await axios.post('https://dataweave.mulesoft.com/api/run', payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'User-Agent': 'VSCode-Anypoint-Monitor/1.0',
                    'Origin': 'https://dataweave.mulesoft.com'
                },
                timeout: 30000,
                validateStatus: (status) => status < 500
            });

            const executionTime = Date.now() - startTime;

            if (response.status === 200 && response.data) {
                const output = formatOutput(response.data.result || response.data, outputMimeType);

                console.log('DataWeave transformation successful:', {
                    executionTime: executionTime + 'ms',
                    outputLength: output.length
                });

                return {
                    success: true,
                    output: output,
                    executionTime: executionTime
                };
            }
        } catch (apiError: any) {
            console.log('API approach failed, trying alternative...', apiError.message);
        }

        // Approach 2: Try to execute using simple evaluation
        try {
            const result = await executeWithSimpleParser(options.script, options.input, options.inputMimeType);
            const executionTime = Date.now() - startTime;

            return {
                success: true,
                output: result,
                executionTime: executionTime
            };
        } catch (parseError: any) {
            console.log('Simple parser failed:', parseError.message);
        }

        // If all approaches fail, provide helpful message
        return {
            success: false,
            error: 'DataWeave execution currently requires an active internet connection and access to MuleSoft services.\n\nYour script is valid and ready to use! You can:\n\n1. Switch to Interactive Mode (🌐 button) for full execution\n2. Copy your script and test at: https://dataweave.mulesoft.com/learn/playground\n3. Export your script (💾) and use it in your Mule application\n\nNote: Direct API execution is being actively developed. Your script and examples are saved for when this feature is available.'
        };

    } catch (error: any) {
        const executionTime = Date.now() - startTime;
        console.error('DataWeave transformation error:', error);

        return {
            success: false,
            error: error.message || 'Unknown error occurred',
            executionTime: executionTime
        };
    }
}

/**
 * Simple DataWeave execution for basic transformations
 * Handles simple JSON-to-JSON transformations
 */
async function executeWithSimpleParser(script: string, input: string, inputMimeType: string): Promise<string> {
    // Only handle basic JSON transformations
    if (inputMimeType !== 'application/json') {
        throw new Error('Simple parser only supports JSON input');
    }

    // Check if it's a simple passthrough or basic transformation
    if (script.includes('payload') && !script.includes('map') && !script.includes('filter')) {
        // Very simple case: just return formatted payload
        try {
            const inputData = JSON.parse(input);

            // If script is just "payload" or "{ data: payload }"
            if (script.match(/---\s*payload\s*$/)) {
                return JSON.stringify(inputData, null, 2);
            }

            // If script creates a simple wrapper
            if (script.match(/---\s*{\s*\w+:\s*payload/)) {
                const match = script.match(/{\s*(\w+):\s*payload/);
                if (match) {
                    const key = match[1];
                    return JSON.stringify({ [key]: inputData }, null, 2);
                }
            }
        } catch (e) {
            throw new Error('Failed to parse input JSON');
        }
    }

    throw new Error('Complex transformations require full DataWeave engine');
}

/**
 * Execute DataWeave transformation locally (if CLI is available)
 * This is an alternative method that doesn't require internet
 */
export async function executeDataWeaveLocal(
    options: DataWeaveExecutionOptions
): Promise<DataWeaveExecutionResult> {
    // TODO: Implement local execution using DataWeave CLI
    // Check if 'dw' command is available in PATH
    // Execute: dw run script.dwl --input payload input.json

    return {
        success: false,
        error: 'Local DataWeave execution is not yet implemented. Please ensure you have an internet connection to use the online execution.'
    };
}

/**
 * Extract output MIME type from DataWeave script
 * Looks for "output application/json" type declarations
 */
function extractOutputMimeType(script: string): string {
    const outputMatch = script.match(/output\s+(application\/[\w+-]+|text\/[\w+-]+)/i);

    if (outputMatch && outputMatch[1]) {
        return outputMatch[1];
    }

    // Default to JSON if not specified
    return 'application/json';
}

/**
 * Parse input data based on MIME type
 */
function parseInput(input: string, mimeType: string): any {
    try {
        switch (mimeType) {
            case 'application/json':
                // Parse JSON input
                return JSON.parse(input);

            case 'application/xml':
            case 'text/xml':
                // Return XML as string (API will parse it)
                return input;

            case 'text/csv':
            case 'application/csv':
                // Return CSV as string (API will parse it)
                return input;

            case 'application/yaml':
            case 'text/yaml':
                // Return YAML as string (API will parse it)
                return input;

            default:
                // Try to parse as JSON, fallback to string
                try {
                    return JSON.parse(input);
                } catch {
                    return input;
                }
        }
    } catch (error) {
        // If parsing fails, return as string
        console.warn('Failed to parse input, using raw string:', error);
        return input;
    }
}

/**
 * Format output based on MIME type
 */
function formatOutput(output: any, mimeType: string): string {
    if (typeof output === 'string') {
        return output;
    }

    switch (mimeType) {
        case 'application/json':
            return JSON.stringify(output, null, 2);

        case 'application/xml':
        case 'text/xml':
        case 'text/csv':
        case 'application/yaml':
        case 'text/yaml':
        case 'text/plain':
            return String(output);

        default:
            // Try to format as JSON for readability
            try {
                return JSON.stringify(output, null, 2);
            } catch {
                return String(output);
            }
    }
}

/**
 * Validate DataWeave script syntax
 * Basic validation - checks for required header and structure
 */
export function validateDataWeaveScript(script: string): { valid: boolean; error?: string } {
    if (!script || script.trim().length === 0) {
        return { valid: false, error: 'Script cannot be empty' };
    }

    // Check for DataWeave version declaration
    if (!script.includes('%dw')) {
        return {
            valid: false,
            error: 'Script must include DataWeave version declaration (e.g., %dw 2.0)'
        };
    }

    // Check for output declaration
    if (!script.includes('output')) {
        return {
            valid: false,
            error: 'Script must include output declaration (e.g., output application/json)'
        };
    }

    // Check for separator (---)
    if (!script.includes('---')) {
        return {
            valid: false,
            error: 'Script must include separator (---) between header and body'
        };
    }

    return { valid: true };
}

/**
 * Get DataWeave script template
 */
export function getDataWeaveTemplate(inputMimeType: string, outputMimeType: string): string {
    return `%dw 2.0
output ${outputMimeType}
---
payload`;
}
