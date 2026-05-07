/**
 * Extracts a downloaded application JAR once to the extension's globalStorage
 * directory and exposes it as a workspace-like read-only filesystem so the
 * diagram webview can offer "open this flow's source file" interactions.
 *
 * Caching key: <artifactId>@<version>-<sha8(jarBytes)> so a fresh deployment
 * version transparently invalidates the cache.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import JSZip from 'jszip';

export interface ExtractedJar {
    /** Root directory on disk for this artifact's exploded contents. */
    rootUri: vscode.Uri;
    /** Map of normalized JAR-relative path -> absolute on-disk path (forward slashes). */
    pathMap: Record<string, string>;
    /** Map of normalized JAR-relative path -> raw text content (for parser use). */
    textFiles: Record<string, string>;
}

export interface ExtractOptions {
    artifactId: string;
    version?: string;
    /**
     * Optional pre-computed fingerprint. If omitted, the workspace derives a
     * stable fingerprint from the JAR's file list (path + uncompressed size +
     * CRC32) so the same JAR always maps to the same cache key without
     * re-buffering the entire archive.
     */
    fingerprint?: string;
}

/** Maximum size of any single entry we will write to disk (defense-in-depth). */
const MAX_ENTRY_BYTES = 50 * 1024 * 1024;
/** Maximum total bytes written for one JAR. */
const MAX_TOTAL_BYTES = 250 * 1024 * 1024;
/** Cap on text content we keep in memory for the parser. */
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
/** How many JAR entries we decompress + write in parallel. */
const EXTRACT_CONCURRENCY = 16;

/**
 * File extensions whose contents we materialize on disk so the diagram webview
 * can offer "open this flow's source" for them. Anything else (class files,
 * vendored JARs under repository/, native libs, signature files, indexes…) is
 * skipped completely — that's where 80–95 % of a Mule deployment artifact's
 * file count comes from and we don't need any of it for the diagram.
 */
const TEXT_EXTENSIONS = new Set([
    '.xml', '.properties', '.yaml', '.yml', '.json', '.raml', '.dwl',
    '.txt', '.md', '.cfg', '.conf',
]);

/**
 * Path prefixes we always skip during extraction. These are large dependency
 * trees that pad the artifact but contain nothing the diagram parser uses.
 *   - repository/ : the Mule app's vendored Maven repo (full of *.jar / *.pom)
 *   - lib/        : runtime jars
 *   - META-INF/maven/ : binary maven indexes (we already parse pom.xml at root)
 */
const SKIP_PREFIXES = ['repository/', 'lib/', 'meta-inf/maven/'];

/**
 * Extracts the JAR (provided as a JSZip instance and original bytes for hashing)
 * into globalStorage. Reuses an existing extraction if the cache key matches.
 *
 * Performance-critical: typical Mule deployment JARs contain 300–2,000 entries
 * but only ~30–80 of those are useful for the diagram (the rest are vendored
 * jars, .class files, signature files, etc.). We filter aggressively before
 * decompressing and parallelize disk I/O so this stays sub-second on a warm
 * cache and a few seconds on a cold one.
 */
export async function extractJarToWorkspace(
    context: vscode.ExtensionContext,
    zip: JSZip,
    opts: ExtractOptions
): Promise<ExtractedJar> {
    const fingerprint = opts.fingerprint || fingerprintFromZip(zip);
    const cacheKey = sanitizeSegment(`${opts.artifactId}@${opts.version || 'unknown'}-${fingerprint}`);

    const baseDir = vscode.Uri.joinPath(context.globalStorageUri, 'diagram-cache');
    const rootUri = vscode.Uri.joinPath(baseDir, cacheKey);

    // If we already extracted this JAR, just rebuild the in-memory maps from disk.
    const existing = await tryLoadExisting(rootUri);
    if (existing) {
        return existing;
    }

    await vscode.workspace.fs.createDirectory(rootUri);

    // Pass 1: collect entries that we actually want, after a cheap filter.
    // Anything skipped here costs us essentially nothing — JSZip hasn't
    // decompressed it yet.
    type Candidate = { safeRel: string; file: any };
    const candidates: Candidate[] = [];
    zip.forEach((relPath, file) => {
        if (file.dir) {
            return;
        }
        const safeRel = sanitizeRelativePath(relPath);
        if (!safeRel) {
            return;
        }
        const lower = safeRel.toLowerCase();
        if (SKIP_PREFIXES.some(p => lower.startsWith(p))) {
            return;
        }
        const ext = path.extname(lower);
        // Text files are the only thing the parser needs. We skip *everything*
        // else — including class files, jars-in-jars, native libs, and
        // signature blobs — because they would just bloat the cache and slow
        // disk writes without helping the diagram.
        if (!TEXT_EXTENSIONS.has(ext)) {
            return;
        }
        candidates.push({ safeRel, file });
    });

    // Pre-create every parent directory once. Doing this in a single pass
    // (instead of per-file) is significantly faster on slow filesystems where
    // mkdir is the dominant cost on cold caches.
    const dirs = new Set<string>();
    for (const c of candidates) {
        const parent = path.posix.dirname(c.safeRel);
        if (parent && parent !== '.') {
            // Add this dir and every ancestor up to root (createDirectory
            // recursive on Code's FS API only creates the leaf reliably).
            const parts = parent.split('/');
            for (let i = 1; i <= parts.length; i++) {
                dirs.add(parts.slice(0, i).join('/'));
            }
        }
    }
    await Promise.all(
        Array.from(dirs).map(async d => {
            try {
                await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(rootUri, d));
            } catch {
                // ignore concurrent / pre-existing dirs
            }
        })
    );

    // Pass 2: decompress + write in bounded-parallel batches. JSZip
    // decompression itself is CPU-bound, but disk writes are I/O-bound and
    // benefit from running ~16 in flight.
    const pathMap: Record<string, string> = {};
    const textFiles: Record<string, string> = {};
    let totalBytes = 0;
    let stoppedForBudget = false;

    for (let i = 0; i < candidates.length && !stoppedForBudget; i += EXTRACT_CONCURRENCY) {
        const batch = candidates.slice(i, i + EXTRACT_CONCURRENCY);
        const results = await Promise.all(
            batch.map(async ({ safeRel, file }) => {
                const content = await file.async('uint8array') as Uint8Array;
                return { safeRel, content };
            })
        );

        // Sequentially apply size budget (so it's deterministic) but issue
        // writes in parallel.
        const writes: Promise<void>[] = [];
        for (const { safeRel, content } of results) {
            if (content.length > MAX_ENTRY_BYTES) {
                continue;
            }
            if (totalBytes + content.length > MAX_TOTAL_BYTES) {
                stoppedForBudget = true;
                break;
            }
            totalBytes += content.length;
            const targetUri = vscode.Uri.joinPath(rootUri, safeRel);
            writes.push(Promise.resolve(vscode.workspace.fs.writeFile(targetUri, content)));
            pathMap[safeRel] = targetUri.fsPath;
            if (content.length < MAX_TEXT_BYTES) {
                try {
                    textFiles[safeRel] = Buffer.from(content).toString('utf8');
                } catch {
                    // skip non-utf8 entries
                }
            }
        }
        await Promise.all(writes);
    }

    return { rootUri, pathMap, textFiles };
}

/**
 * Resolves a JAR-relative path to its on-disk absolute path, opens it in the
 * editor (read-only-friendly: opens as a normal document; the file is in the
 * extension's globalStorage which the user shouldn't edit but isn't strictly
 * locked).
 */
export async function openExtractedFile(
    extracted: ExtractedJar,
    relativePath: string
): Promise<void> {
    const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const absolute = extracted.pathMap[normalized];
    if (!absolute) {
        vscode.window.showWarningMessage(`File not found in extracted JAR: ${normalized}`);
        return;
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absolute));
    await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function fingerprintFromZip(zip: JSZip): string {
    // Build a stable summary: sorted "path:size" entries hashed to 8 hex chars.
    // We avoid reading per-entry contents to keep this fast.
    const entries: string[] = [];
    zip.forEach((relPath, file) => {
        if (file.dir) {return;}
        const internal: any = file as any;
        // jszip exposes the uncompressed size and CRC32 via internal options
        const size = internal._data?.uncompressedSize ?? internal._data?.compressedSize ?? 0;
        const crc = internal._data?.crc32 ?? 0;
        entries.push(`${relPath}:${size}:${crc}`);
    });
    entries.sort();
    return crypto.createHash('sha256').update(entries.join('\n')).digest('hex').slice(0, 8);
}

function sanitizeSegment(segment: string): string {
    return segment.replace(/[^a-zA-Z0-9._@-]/g, '_').slice(0, 80);
}

/**
 * Path traversal hardening: reject absolute paths, dotdot segments, and any
 * components containing path separators after normalization.
 */
function sanitizeRelativePath(rel: string): string | undefined {
    if (!rel) {return undefined;}
    const normalized = rel.replace(/\\/g, '/').replace(/^\/+/, '');
    if (normalized.includes('..')) {return undefined;}
    if (path.isAbsolute(normalized)) {return undefined;}
    // Reject any segment that resolves outside the cache root
    const parts = normalized.split('/').filter(Boolean);
    if (parts.some(p => p === '.' || p === '..')) {return undefined;}
    return parts.join('/');
}

/**
 * Cache-hit path. Walks the previously-extracted directory in parallel and
 * only re-reads files whose extension is in TEXT_EXTENSIONS — same filter we
 * applied during extraction, so this should be the only thing on disk anyway.
 */
async function tryLoadExisting(rootUri: vscode.Uri): Promise<ExtractedJar | undefined> {
    try {
        const stat = await vscode.workspace.fs.stat(rootUri);
        if (stat.type !== vscode.FileType.Directory) {
            return undefined;
        }
    } catch {
        return undefined;
    }

    const pathMap: Record<string, string> = {};
    const textFiles: Record<string, string> = {};

    // Phase 1: walk the tree in parallel to enumerate every file path.
    const fileTasks: Array<Promise<void>> = [];
    async function walk(dirUri: vscode.Uri, prefix: string): Promise<void> {
        const items = await vscode.workspace.fs.readDirectory(dirUri);
        const subdirs: Promise<void>[] = [];
        for (const [name, type] of items) {
            const childRel = prefix ? `${prefix}/${name}` : name;
            const childUri = vscode.Uri.joinPath(dirUri, name);
            if (type === vscode.FileType.Directory) {
                subdirs.push(walk(childUri, childRel));
            } else if (type === vscode.FileType.File) {
                pathMap[childRel] = childUri.fsPath;
                const ext = path.extname(childRel).toLowerCase();
                if (TEXT_EXTENSIONS.has(ext)) {
                    fileTasks.push((async () => {
                        try {
                            const bytes = await vscode.workspace.fs.readFile(childUri);
                            if (bytes.length < MAX_TEXT_BYTES) {
                                textFiles[childRel] = Buffer.from(bytes).toString('utf8');
                            }
                        } catch {
                            // skip
                        }
                    })());
                }
            }
        }
        await Promise.all(subdirs);
    }

    try {
        await walk(rootUri, '');
        // Phase 2: bounded-parallel file reads.
        for (let i = 0; i < fileTasks.length; i += EXTRACT_CONCURRENCY) {
            await Promise.all(fileTasks.slice(i, i + EXTRACT_CONCURRENCY));
        }
    } catch {
        return undefined;
    }

    if (Object.keys(pathMap).length === 0) {
        return undefined;
    }

    return { rootUri, pathMap, textFiles };
}
