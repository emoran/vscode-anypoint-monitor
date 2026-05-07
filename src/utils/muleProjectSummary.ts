/**
 * Generates human-readable narratives for a parsed MuleProject.
 *
 * Two paths:
 *   1. buildHeuristicNarrative(project)  - always available, no network call.
 *   2. buildLlmNarrative(project, opts)  - opt-in, uses VS Code's Language
 *      Model API. Only the structured ProjectSummary is sent to the model;
 *      raw XML never leaves the user's machine.
 */

// NOTE: We intentionally use a typeof-import for vscode so this module remains
// loadable under plain Node (e.g. unit tests), since the heuristic narrative
// has no runtime dependency on the VS Code API. The LLM path resolves the
// real vscode module lazily via require() at call time.
import type * as vscodeNS from 'vscode';
import { MuleProject, ProjectSummary } from './muleProject';

export interface NarrativeResult {
    text: string;
    /** 'heuristic' or 'llm' */
    source: 'heuristic' | 'llm';
    /** Set when source === 'llm' */
    modelName?: string;
}

// ---------------------------------------------------------------------------
// Heuristic narrative
// ---------------------------------------------------------------------------

export function buildHeuristicNarrative(project: MuleProject): NarrativeResult {
    const sentences: string[] = [];
    const s = project.summary;

    // Sentence 1: what triggers the app
    const triggerSentence = describeTriggers(s);
    if (triggerSentence) {
        sentences.push(triggerSentence);
    }

    // Sentence 2: what external systems it touches
    const systemsSentence = describeExternalSystems(s);
    if (systemsSentence) {
        sentences.push(systemsSentence);
    }

    // Sentence 3: composition / runtime
    const composition = describeComposition(project);
    if (composition) {
        sentences.push(composition);
    }

    if (sentences.length === 0) {
        return {
            source: 'heuristic',
            text: 'No flows or entry points were detected. The application may use unsupported components or the JAR may be empty.',
        };
    }

    return { source: 'heuristic', text: sentences.join(' ') };
}

function describeTriggers(summary: ProjectSummary): string {
    if (summary.entryPoints.length === 0) {
        return 'This application has no detected entry points (no HTTP listener, scheduler, or message subscriber).';
    }

    const httpEntries = summary.entryPoints.filter(e => e.kind === 'http' || e.kind === 'apikit');
    const schedulerEntries = summary.entryPoints.filter(e => e.kind === 'scheduler');
    const queueEntries = summary.entryPoints.filter(e => e.kind === 'mq-listener' || e.kind === 'jms-listener' || e.kind === 'kafka-listener' || e.kind === 'vm-listener');
    const fileEntries = summary.entryPoints.filter(e => e.kind === 'file-listener' || e.kind === 'sftp-listener');

    const parts: string[] = [];
    if (httpEntries.length > 0) {
        const sample = httpEntries.slice(0, 3).map(e => e.label).join(', ');
        const more = httpEntries.length > 3 ? `, and ${httpEntries.length - 3} more` : '';
        parts.push(`exposes ${httpEntries.length} HTTP endpoint${httpEntries.length === 1 ? '' : 's'} (${sample}${more})`);
    }
    if (schedulerEntries.length > 0) {
        parts.push(`runs on ${schedulerEntries.length} scheduled trigger${schedulerEntries.length === 1 ? '' : 's'} (${schedulerEntries.map(e => e.label).slice(0, 2).join('; ')})`);
    }
    if (queueEntries.length > 0) {
        const KIND_LABELS: Record<string, string> = {
            'mq-listener': 'Anypoint MQ',
            'jms-listener': 'JMS',
            'kafka-listener': 'Kafka',
            'vm-listener': 'VM',
        };
        const sources = Array.from(new Set(queueEntries.map(e => KIND_LABELS[e.kind] || e.kind.replace('-listener', '').toUpperCase())));
        parts.push(`consumes events from ${sources.join(', ')}`);
    }
    if (fileEntries.length > 0) {
        parts.push(`watches ${fileEntries.length} file/SFTP source${fileEntries.length === 1 ? '' : 's'}`);
    }

    if (parts.length === 0) {
        return '';
    }
    return capitalize('This application ' + joinList(parts) + '.');
}

function describeExternalSystems(summary: ProjectSummary): string {
    if (summary.externalSystems.length === 0) {
        return '';
    }
    const named = summary.externalSystems.slice(0, 4).map(s => s.label);
    const more = summary.externalSystems.length > 4 ? `, plus ${summary.externalSystems.length - 4} more` : '';
    return `It integrates with ${joinList(named)}${more}.`;
}

function describeComposition(project: MuleProject): string {
    const c = project.summary.composition;
    const bits: string[] = [];
    bits.push(`${c.flows} flow${c.flows === 1 ? '' : 's'}`);
    if (c.subFlows > 0) {
        bits.push(`${c.subFlows} sub-flow${c.subFlows === 1 ? '' : 's'}`);
    }
    if (c.dataweaveFiles > 0) {
        bits.push(`${c.dataweaveFiles} DataWeave file${c.dataweaveFiles === 1 ? '' : 's'}`);
    }
    if (c.errorHandlers > 0) {
        bits.push(`${c.errorHandlers} global error handler${c.errorHandlers === 1 ? '' : 's'}`);
    }
    const runtime = project.artifact.muleVersion ? ` on Mule ${project.artifact.muleVersion}` : '';
    return `Composed of ${joinList(bits)}${runtime}.`;
}

// ---------------------------------------------------------------------------
// LLM narrative via VS Code Language Model API
// ---------------------------------------------------------------------------

export interface LlmNarrativeOptions {
    /** Optional model family preference, e.g. "gpt-4o", "claude-3-5-sonnet". */
    modelFamily?: string;
    /** Cancellation token from the calling command. */
    token?: vscodeNS.CancellationToken;
}

/**
 * Generates a 2-3 sentence narrative using VS Code's Language Model API.
 *
 * Privacy: only the structured ProjectSummary is sent to the model. No raw XML,
 * DataWeave, properties, or secrets are forwarded. Falls back to the heuristic
 * narrative on any failure.
 */
export async function buildLlmNarrative(
    project: MuleProject,
    opts: LlmNarrativeOptions = {}
): Promise<NarrativeResult> {
    let vscode: typeof vscodeNS;
    try {
        // Lazy require so this module stays importable from plain Node tests.
        vscode = require('vscode');
    } catch {
        return buildHeuristicNarrative(project);
    }

    // The vscode.lm API was added in VS Code 1.90; guard against older hosts.
    const lm: any = (vscode as any).lm;
    if (!lm || typeof lm.selectChatModels !== 'function') {
        return buildHeuristicNarrative(project);
    }

    try {
        const selector: Record<string, string> = {};
        if (opts.modelFamily) {
            selector.family = opts.modelFamily;
        }
        const models = await lm.selectChatModels(selector);
        if (!Array.isArray(models) || models.length === 0) {
            return buildHeuristicNarrative(project);
        }
        const model = models[0];

        const userPrompt = buildLlmPrompt(project);
        const messages = [
            // System-style instructions go in a User message because the public
            // LM API only models user/assistant turns.
            new (vscode as any).LanguageModelChatMessage(0 /* User */, userPrompt),
        ];

        const response = await model.sendRequest(
            messages,
            {},
            opts.token ?? new vscode.CancellationTokenSource().token
        );

        let text = '';
        for await (const fragment of response.text) {
            text += fragment;
        }
        text = text.trim();

        if (!text) {
            return buildHeuristicNarrative(project);
        }
        return {
            source: 'llm',
            text,
            modelName: model.name || model.id || model.family,
        };
    } catch {
        return buildHeuristicNarrative(project);
    }
}

function buildLlmPrompt(project: MuleProject): string {
    // Build a compact, structured payload. No secrets, no XML, no DataWeave bodies.
    const payload = {
        artifact: {
            artifactId: project.artifact.artifactId,
            version: project.artifact.version,
            muleVersion: project.artifact.muleVersion,
        },
        composition: project.summary.composition,
        entryPoints: project.summary.entryPoints.slice(0, 12),
        externalSystems: project.summary.externalSystems,
        flowNames: project.flows.map(f => f.name).slice(0, 30),
        ramlOasTitles: project.ramlOas.apiTitles.slice(0, 5),
    };

    return [
        'You are a senior MuleSoft integration architect.',
        'Given the following structured summary of a Mule 4 application, write 2 to 3 short sentences (max 60 words total) describing what the application does and how it is integrated.',
        'Do not mention you are an AI. Do not invent connectors not listed. Do not include code.',
        'Project summary (JSON):',
        '```json',
        JSON.stringify(payload, null, 2),
        '```',
    ].join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function joinList(parts: string[]): string {
    if (parts.length === 0) {return '';}
    if (parts.length === 1) {return parts[0];}
    if (parts.length === 2) {return `${parts[0]} and ${parts[1]}`;}
    return parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1];
}

function capitalize(s: string): string {
    if (!s) {return s;}
    return s.charAt(0).toUpperCase() + s.slice(1);
}
