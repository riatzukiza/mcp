import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { validateMcpOperation } from './validation/index.js';
// Resolve base path from env or CWD,
// this is the 'sandbox' root.
export const getMcpRoot = () => {
    const base = process.env.MCP_ROOT_PATH || process.cwd();
    return path.resolve(base);
};
/** Strip a leading "../" etc. and never return a path outside the root. */
export const normalizeToRoot = (ROOT_PATH, rel = '.') => {
    const base = path.resolve(ROOT_PATH);
    // If rel is already absolute, check if it's inside the root
    if (rel && path.isAbsolute(rel)) {
        const abs = path.resolve(rel);
        if (isInsideRoot(ROOT_PATH, abs)) {
            return abs;
        }
        throw new Error('path outside root');
    }
    // Otherwise resolve relative to the base
    const abs = path.resolve(base, rel || '.');
    const relToBase = path.relative(base, abs);
    if (relToBase.startsWith('..') || path.isAbsolute(relToBase)) {
        throw new Error('path outside root');
    }
    return abs;
};
/** Check if an absolute path is still inside the sandbox root. */
export const isInsideRoot = (ROOT_PATH, absOrRel) => {
    const base = path.resolve(ROOT_PATH);
    // If absOrRel is already absolute, use it directly
    const abs = path.isAbsolute(absOrRel) ? path.resolve(absOrRel) : path.resolve(base, absOrRel);
    const relToBase = path.relative(base, abs);
    return !(relToBase.startsWith('..') || path.isAbsolute(relToBase));
};
// Resolve the absolute path for a string, only return if it's a file and stays within root.
export const resolvePath = async (ROOT_PATH, p) => {
    if (!p)
        return null;
    // Use comprehensive validation first
    const validationResult = await validateMcpOperation(ROOT_PATH, p, 'read');
    if (!validationResult.valid) {
        return null;
    }
    try {
        const absCandidate = normalizeToRoot(ROOT_PATH, validationResult.sanitizedPath);
        if (!isInsideRoot(ROOT_PATH, absCandidate))
            return null;
        const st = await fs.stat(absCandidate);
        if (st.isFile())
            return absCandidate;
    }
    catch {
        return null;
    }
    return null;
};
// Read a file within sandbox.
export const viewFile = async (ROOT_PATH, relOrFuzzy, line = 1, context = 25) => {
    // Validate input using comprehensive framework
    const validationResult = await validateMcpOperation(ROOT_PATH, relOrFuzzy, 'read');
    if (!validationResult.valid) {
        throw new Error(`Invalid path: ${validationResult.error}`);
    }
    const abs = await resolvePath(ROOT_PATH, relOrFuzzy);
    if (!abs)
        throw new Error('file not found');
    const rel = path.relative(ROOT_PATH, abs).replace(/\\/g, '/');
    const raw = await fs.readFile(abs, 'utf8');
    const lines = raw.split(/\r?\n/);
    const L = Math.max(1, Math.min(lines.length, Number(line) || 1));
    const ctx = Math.max(0, Number(context) || 0);
    const start = Math.max(1, L - ctx);
    const end = Math.min(lines.length, L + ctx);
    return {
        path: rel,
        totalLines: lines.length,
        startLine: start,
        endLine: end,
        focusLine: L,
        snippet: lines.slice(start - 1, end).join('\n'),
    };
};
export const listDirectory = async (ROOT_PATH, rel, options = {}) => {
    // Validate input using comprehensive framework
    const validationResult = await validateMcpOperation(ROOT_PATH, rel || '.', 'list');
    if (!validationResult.valid) {
        throw new Error(`Invalid path: ${validationResult.error}`);
    }
    const includeHidden = Boolean(options.hidden ?? options.includeHidden);
    const abs = normalizeToRoot(ROOT_PATH, validationResult.sanitizedPath);
    const dirents = await fs.readdir(abs, { withFileTypes: true });
    const entries = dirents
        .filter((entry) => !entry.name.startsWith('.') || includeHidden)
        .map(async (entry) => {
        const childAbs = path.resolve(abs, entry.name);
        if (!isInsideRoot(ROOT_PATH, childAbs))
            return null;
        const stats = await fs.stat(childAbs).catch(() => null);
        const size = stats && !entry.isDirectory() ? stats.size : null;
        const mtimeMs = stats ? stats.mtimeMs : null;
        return {
            name: entry.name,
            path: entry.name,
            type: entry.isDirectory() ? 'dir' : 'file',
            size,
            mtimeMs,
        };
    });
    const materialized = (await Promise.all(entries)).filter((e) => e !== null);
    materialized.sort((a, b) => {
        if (a.type !== b.type)
            return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
    return {
        ok: true,
        base: path.relative(ROOT_PATH, abs).replace(/\\/g, '/') || '.',
        entries: materialized,
    };
};
// Depth-tree with filters (basic version of bridge's tree)
export const treeDirectory = async (ROOT_PATH, sel, options = {}) => {
    // Validate input using comprehensive framework
    const validationResult = await validateMcpOperation(ROOT_PATH, sel || '.', 'tree');
    if (!validationResult.valid) {
        throw new Error(`Invalid path: ${validationResult.error}`);
    }
    const includeHidden = options.includeHidden ?? false;
    const maxDepth = Math.max(1, Number(options.depth || 1));
    const abs = normalizeToRoot(ROOT_PATH, validationResult.sanitizedPath);
    const baseRel = (path.relative(ROOT_PATH, abs) || '.').replace(/\\/g, '/');
    const walk = async (currentAbs, relToRoot, level) => {
        const dirents = await fs.readdir(currentAbs, { withFileTypes: true });
        const nodes = await Promise.all(dirents.map(async (entry) => {
            if (entry.name.startsWith('.') && !includeHidden)
                return null;
            const childAbs = path.join(currentAbs, entry.name);
            if (!isInsideRoot(ROOT_PATH, childAbs))
                return null;
            const childRel = relToRoot === '.' ? entry.name : `${relToRoot}/${entry.name}`;
            const stats = await fs.stat(childAbs).catch(() => null);
            const baseNode = {
                name: entry.name,
                path: childRel,
                type: entry.isDirectory() ? 'dir' : 'file',
                ...(stats && !entry.isDirectory() ? { size: stats.size } : {}),
                ...(stats ? { mtimeMs: stats.mtimeMs } : {}),
            };
            if (!entry.isDirectory() || level >= maxDepth) {
                return baseNode;
            }
            const children = await walk(childAbs, childRel, level + 1);
            return { ...baseNode, children };
        }));
        const materialized = nodes.filter((node) => node !== null);
        materialized.sort((a, b) => {
            if (a.type !== b.type)
                return a.type === 'dir' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        return materialized;
    };
    const tree = await walk(abs, baseRel === '' ? '.' : baseRel, 1);
    return { ok: true, base: baseRel, tree };
};
// Check if any component of the path is a symlink that could escape the sandbox
const validatePathSecurity = async (ROOT_PATH, targetPath) => {
    const root = path.resolve(ROOT_PATH);
    const target = path.resolve(targetPath);
    // Check each path component for symlinks
    const components = path.relative(root, target).split(path.sep);
    let currentPath = root;
    for (const component of components) {
        if (component === '..') {
            throw new Error('path traversal detected');
        }
        if (component === '')
            continue; // Skip empty components
        currentPath = path.join(currentPath, component);
        try {
            const stats = await fs.lstat(currentPath);
            if (stats.isSymbolicLink()) {
                const linkTarget = await fs.readlink(currentPath);
                const resolvedTarget = path.resolve(path.dirname(currentPath), linkTarget);
                // Check if the symlink target would escape the sandbox
                if (!isInsideRoot(root, resolvedTarget)) {
                    throw new Error('symlink escape detected');
                }
            }
        }
        catch (error) {
            // If we can't stat the path, continue checking parent directories
            // This handles cases where we're creating new files/directories
            // But don't swallow symlink escape errors
            if (error instanceof Error && error.message.includes('symlink escape detected')) {
                throw error;
            }
        }
    }
    // Also check all parent directories up to the root
    let checkPath = target;
    while (checkPath !== root && checkPath !== path.dirname(checkPath)) {
        checkPath = path.dirname(checkPath);
        try {
            const stats = await fs.lstat(checkPath);
            if (stats.isSymbolicLink()) {
                const linkTarget = await fs.readlink(checkPath);
                const resolvedTarget = path.resolve(path.dirname(checkPath), linkTarget);
                // Check if the symlink target would escape the sandbox
                if (!isInsideRoot(root, resolvedTarget)) {
                    throw new Error('parent symlink escape detected');
                }
            }
        }
        catch (error) {
            // Directory doesn't exist or can't be accessed
            // But don't swallow symlink escape errors
            if (error instanceof Error && error.message.includes('symlink escape detected')) {
                throw error;
            }
        }
    }
};
// Write a file with utf8 encoding.
export const writeFileContent = async (ROOT_PATH, filePath, content) => {
    // Validate input using comprehensive framework first
    const validationResult = await validateMcpOperation(ROOT_PATH, filePath, 'write');
    if (!validationResult.valid) {
        throw new Error(`Invalid path: ${validationResult.error}`);
    }
    const abs = normalizeToRoot(ROOT_PATH, validationResult.sanitizedPath);
    // Validate path security before any file operations
    await validatePathSecurity(ROOT_PATH, abs);
    // Also validate the parent directory path before mkdir
    const parentDir = path.dirname(abs);
    if (parentDir !== abs) {
        await validatePathSecurity(ROOT_PATH, parentDir);
    }
    await fs.mkdir(parentDir, { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
    return { path: filePath };
};
// Append and/or insert lines, persistent and pure.
export const writeFileLines = async (ROOT_PATH, filePath, lines, startLine) => {
    // Validate input using comprehensive framework first
    const validationResult = await validateMcpOperation(ROOT_PATH, filePath, 'write');
    if (!validationResult.valid) {
        throw new Error(`Invalid path: ${validationResult.error}`);
    }
    const abs = normalizeToRoot(ROOT_PATH, validationResult.sanitizedPath);
    // Validate path security before writing
    await validatePathSecurity(ROOT_PATH, abs);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    let fileLines = [];
    try {
        const raw = await fs.readFile(abs, 'utf8');
        fileLines = raw.split(/\r?\n/);
    }
    catch {
        // Missing file: start from empty and proceed with inserts.
    }
    const idx = Math.max(0, Math.min(fileLines.length, startLine - 1));
    const next = [...fileLines.slice(0, idx), ...lines, ...fileLines.slice(idx)];
    await fs.writeFile(abs, next.join('\n'), 'utf8');
    return { path: filePath };
};
export default {
    getMcpRoot,
    normalizeToRoot,
    isInsideRoot,
    resolvePath,
    viewFile,
    listDirectory,
    treeDirectory,
    writeFileContent,
    writeFileLines,
};
//# sourceMappingURL=files.js.map