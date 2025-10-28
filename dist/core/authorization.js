/**
 * Authorization framework for MCP tools
 *
 * This module provides role-based access control (RBAC) for MCP tools,
 * addressing P0 security vulnerability where any authenticated user
 * could perform destructive operations.
 */
import { getAuthConfig } from '../config/auth-config.js';
/**
 * Role hierarchy mapping
 */
const ROLE_HIERARCHY = {
    guest: 0,
    user: 1,
    developer: 2,
    admin: 3,
};
/**
 * Default role permissions
 */
const DEFAULT_ROLE_PERMISSIONS = {
    guest: ['read'],
    user: ['read', 'write'],
    developer: ['read', 'write', 'delete'],
    admin: ['read', 'write', 'delete', 'admin'],
};
/**
 * Tool authorization requirements mapping
 */
const TOOL_AUTH_REQUIREMENTS = {
    // File operations - most dangerous
    files_write_content: {
        category: 'files',
        requiredLevel: 'write',
        dangerous: true,
        auditLog: true,
    },
    files_write_lines: {
        category: 'files',
        requiredLevel: 'write',
        dangerous: true,
        auditLog: true,
    },
    files_list_directory: {
        category: 'files',
        requiredLevel: 'read',
        dangerous: false,
        auditLog: false,
    },
    files_tree_directory: {
        category: 'files',
        requiredLevel: 'read',
        dangerous: false,
        auditLog: false,
    },
    files_view_file: {
        category: 'files',
        requiredLevel: 'read',
        dangerous: false,
        auditLog: false,
    },
    files_search: {
        category: 'files',
        requiredLevel: 'read',
        dangerous: false,
        auditLog: false,
    },
    // Command execution - extremely dangerous
    exec_run: {
        category: 'exec',
        requiredLevel: 'admin',
        requiredRoles: ['developer', 'admin'],
        dangerous: true,
        auditLog: true,
    },
    exec_list: {
        category: 'exec',
        requiredLevel: 'read',
        dangerous: false,
        auditLog: false,
    },
    // Kanban operations - task management
    kanban_delete_task: {
        category: 'kanban',
        requiredLevel: 'delete',
        dangerous: true,
        auditLog: true,
    },
    kanban_archive_task: {
        category: 'kanban',
        requiredLevel: 'write',
        dangerous: true,
        auditLog: true,
    },
    kanban_bulk_archive: {
        category: 'kanban',
        requiredLevel: 'delete',
        dangerous: true,
        auditLog: true,
    },
    kanban_merge_tasks: {
        category: 'kanban',
        requiredLevel: 'write',
        dangerous: true,
        auditLog: true,
    },
    kanban_update_status: {
        category: 'kanban',
        requiredLevel: 'write',
        dangerous: false,
        auditLog: true,
    },
    kanban_move_task: {
        category: 'kanban',
        requiredLevel: 'write',
        dangerous: false,
        auditLog: true,
    },
    kanban_update_task_description: {
        category: 'kanban',
        requiredLevel: 'write',
        dangerous: false,
        auditLog: true,
    },
    kanban_rename_task: {
        category: 'kanban',
        requiredLevel: 'write',
        dangerous: false,
        auditLog: true,
    },
    kanban_analyze_task: {
        category: 'kanban',
        requiredLevel: 'read',
        dangerous: false,
        auditLog: false,
    },
    kanban_rewrite_task: {
        category: 'kanban',
        requiredLevel: 'write',
        dangerous: true,
        auditLog: true,
    },
    kanban_breakdown_task: {
        category: 'kanban',
        requiredLevel: 'write',
        dangerous: true,
        auditLog: true,
    },
    kanban_get_board: {
        category: 'kanban',
        requiredLevel: 'read',
        dangerous: false,
        auditLog: false,
    },
    kanban_get_column: {
        category: 'kanban',
        requiredLevel: 'read',
        dangerous: false,
        auditLog: false,
    },
    kanban_find_task: {
        category: 'kanban',
        requiredLevel: 'read',
        dangerous: false,
        auditLog: false,
    },
    kanban_find_task_by_title: {
        category: 'kanban',
        requiredLevel: 'read',
        dangerous: false,
        auditLog: false,
    },
    kanban_search: {
        category: 'kanban',
        requiredLevel: 'read',
        dangerous: false,
        auditLog: false,
    },
    kanban_sync_board: {
        category: 'kanban',
        requiredLevel: 'write',
        dangerous: false,
        auditLog: true,
    },
    // GitHub operations
    github_apply_patch: {
        category: 'github',
        requiredLevel: 'write',
        dangerous: true,
        auditLog: true,
    },
    github_contents_write: {
        category: 'github',
        requiredLevel: 'write',
        dangerous: true,
        auditLog: true,
    },
    github_pr_review_submit: {
        category: 'github',
        requiredLevel: 'write',
        dangerous: true,
        auditLog: true,
    },
    github_review_open_pull_request: {
        category: 'github',
        requiredLevel: 'write',
        dangerous: true,
        auditLog: true,
    },
    github_review_commit: {
        category: 'github',
        requiredLevel: 'write',
        dangerous: true,
        auditLog: true,
    },
    github_review_push: {
        category: 'github',
        requiredLevel: 'write',
        dangerous: true,
        auditLog: true,
    },
    // Process management
    process_enqueue_task: {
        category: 'process',
        requiredLevel: 'write',
        dangerous: true,
        auditLog: true,
    },
    process_stop: {
        category: 'process',
        requiredLevel: 'delete',
        dangerous: true,
        auditLog: true,
    },
    process_update_task_runner_config: {
        category: 'process',
        requiredLevel: 'admin',
        requiredRoles: ['admin'],
        dangerous: true,
        auditLog: true,
    },
    // Sandbox operations
    sandbox_create: {
        category: 'sandbox',
        requiredLevel: 'write',
        dangerous: true,
        auditLog: true,
    },
    sandbox_delete: {
        category: 'sandbox',
        requiredLevel: 'delete',
        dangerous: true,
        auditLog: true,
    },
    // System operations
    apply_patch: {
        category: 'system',
        requiredLevel: 'write',
        dangerous: true,
        auditLog: true,
    },
    pnpm_add: {
        category: 'system',
        requiredLevel: 'write',
        dangerous: true,
        auditLog: true,
    },
    pnpm_remove: {
        category: 'system',
        requiredLevel: 'delete',
        dangerous: true,
        auditLog: true,
    },
    nx_generate_package: {
        category: 'system',
        requiredLevel: 'write',
        dangerous: true,
        auditLog: true,
    },
    // Meta tools - generally safe
    mcp_help: {
        category: 'meta',
        requiredLevel: 'read',
        dangerous: false,
        auditLog: false,
    },
    mcp_toolset: {
        category: 'meta',
        requiredLevel: 'read',
        dangerous: false,
        auditLog: false,
    },
    mcp_endpoints: {
        category: 'meta',
        requiredLevel: 'read',
        dangerous: false,
        auditLog: false,
    },
    mcp_validate_config: {
        category: 'meta',
        requiredLevel: 'read',
        dangerous: false,
        auditLog: false,
    },
};
/**
 * In-memory audit log (in production, use persistent storage)
 */
class AuditLogger {
    entries = [];
    maxSize = 10000; // Keep last 10k entries
    log(entry) {
        this.entries.push(entry);
        // Trim old entries
        if (this.entries.length > this.maxSize) {
            this.entries = this.entries.slice(-this.maxSize);
        }
        // Log to console for immediate visibility
        const level = entry.result === 'denied' ? 'WARN' : 'INFO';
        console.log(`[AUDIT:${level}] ${entry.timestamp.toISOString()} ${entry.userId}:${entry.role} ${entry.toolName} ${entry.action} ${entry.result}${entry.reason ? ` - ${entry.reason}` : ''}`);
    }
    getRecent(count = 100) {
        return this.entries.slice(-count);
    }
    getByUser(userId, count = 100) {
        return this.entries.filter((entry) => entry.userId === userId).slice(-count);
    }
    getDenied(count = 100) {
        return this.entries.filter((entry) => entry.result === 'denied').slice(-count);
    }
}
export const auditLogger = new AuditLogger();
/**
 * Check if a role has sufficient hierarchy level
 */
function hasRequiredRole(userRole, requiredRoles) {
    if (!requiredRoles || requiredRoles.length === 0) {
        return true;
    }
    const userLevel = ROLE_HIERARCHY[userRole];
    return requiredRoles.some((requiredRole) => ROLE_HIERARCHY[requiredRole] <= userLevel);
}
/**
 * Check if a role has the required permission level
 */
function hasRequiredPermission(userRole, requiredLevel) {
    const userPermissions = DEFAULT_ROLE_PERMISSIONS[userRole];
    const requiredIndex = getPermissionLevelIndex(requiredLevel);
    return userPermissions.some((permission) => getPermissionLevelIndex(permission) >= requiredIndex);
}
/**
 * Get numeric index for permission level comparison
 */
function getPermissionLevelIndex(level) {
    switch (level) {
        case 'read':
            return 0;
        case 'write':
            return 1;
        case 'delete':
            return 2;
        case 'admin':
            return 3;
        default:
            return -1;
    }
}
/**
 * Extract user context from environment or headers
 */
function extractAuthContext(ctx) {
    // In a real implementation, this would extract from JWT tokens,
    // API keys, or other authentication mechanisms
    const env = ctx.env;
    const config = getAuthConfig();
    // For now, use environment variables as a simple auth mechanism
    // In production, replace with proper authentication
    const userId = env.MCP_USER_ID || 'anonymous';
    const userRole = env.MCP_USER_ROLE || config.defaultRole;
    const sessionToken = env.MCP_SESSION_TOKEN;
    const ipAddress = env.REMOTE_ADDR;
    const userAgent = env.USER_AGENT;
    // Validate role
    if (!['guest', 'user', 'developer', 'admin'].includes(userRole)) {
        throw new Error(`Invalid user role: ${userRole}`);
    }
    return {
        userId,
        role: userRole,
        permissions: DEFAULT_ROLE_PERMISSIONS[userRole],
        sessionToken,
        ipAddress,
        userAgent,
    };
}
/**
 * Authorize a tool invocation with enhanced security controls
 */
function authorizeTool(toolName, authContext, _args) {
    const config = getAuthConfig();
    const requirements = TOOL_AUTH_REQUIREMENTS[toolName];
    // 1. Strict mode: deny by default for unknown tools
    if (!requirements) {
        if (config.strictMode) {
            return {
                allowed: false,
                reason: `Tool '${toolName}' not found in authorization configuration (strict mode enabled)`,
            };
        }
        // Default to safe if tool not explicitly configured and strict mode is disabled
        return { allowed: true };
    }
    // 2. Enforce requireAuthForDangerous for dangerous operations
    if (requirements.dangerous && config.requireAuthForDangerous) {
        // Require authentication (non-guest role) for dangerous operations
        if (authContext.role === 'guest' || authContext.userId === 'anonymous') {
            return {
                allowed: false,
                reason: `Authentication required for dangerous operation '${toolName}' (requireAuthForDangerous enabled)`,
            };
        }
    }
    // 3. Admin IP whitelist validation for admin operations
    if (authContext.role === 'admin' && config.adminIpWhitelist.length > 0) {
        const clientIp = authContext.ipAddress || 'unknown';
        if (!config.adminIpWhitelist.includes(clientIp)) {
            return {
                allowed: false,
                reason: `Admin access denied from IP ${clientIp}. Whitelisted IPs: ${config.adminIpWhitelist.join(', ')}`,
            };
        }
    }
    // 4. Check role requirements (existing logic)
    if (!hasRequiredRole(authContext.role, requirements.requiredRoles)) {
        return {
            allowed: false,
            reason: `Role '${authContext.role}' not in required roles: ${requirements.requiredRoles?.join(', ') || 'none'}`,
        };
    }
    // 5. Check permission level (existing logic)
    if (!hasRequiredPermission(authContext.role, requirements.requiredLevel)) {
        return {
            allowed: false,
            reason: `Role '${authContext.role}' lacks required permission level: ${requirements.requiredLevel}`,
        };
    }
    // 6. Additional checks for dangerous operations (existing logic, now redundant with #2 but kept for compatibility)
    if (requirements.dangerous && authContext.role === 'guest') {
        return {
            allowed: false,
            reason: 'Guest users cannot perform dangerous operations',
        };
    }
    return { allowed: true };
}
/**
 * Create an authorized tool factory wrapper
 */
export function createAuthorizedToolFactory(originalFactory, toolName) {
    return (ctx) => {
        const originalTool = originalFactory(ctx);
        const authorizedInvoke = async (args) => {
            const authContext = extractAuthContext(ctx);
            const config = getAuthConfig();
            const authResult = authorizeTool(toolName, authContext, args);
            const auditEntry = {
                timestamp: new Date(),
                userId: authContext.userId,
                role: authContext.role,
                toolName,
                action: 'invoke',
                args,
                result: authResult.allowed ? 'allowed' : 'denied',
                reason: authResult.reason,
                ipAddress: authContext.ipAddress,
                userAgent: authContext.userAgent,
            };
            // Respect audit logging configuration
            if (config.enableAuditLog) {
                auditLogger.log(auditEntry);
            }
            if (!authResult.allowed) {
                throw new Error(`Authorization denied: ${authResult.reason}`);
            }
            // Proceed with the original tool invocation
            try {
                const result = await originalTool.invoke(args);
                // Log successful completion for dangerous operations if audit is enabled
                const requirements = TOOL_AUTH_REQUIREMENTS[toolName];
                if (config.enableAuditLog && requirements?.auditLog) {
                    auditLogger.log({
                        ...auditEntry,
                        action: 'complete',
                        result: 'allowed',
                    });
                }
                return result;
            }
            catch (error) {
                // Log errors for dangerous operations if audit is enabled
                const requirements = TOOL_AUTH_REQUIREMENTS[toolName];
                if (config.enableAuditLog && requirements?.auditLog) {
                    auditLogger.log({
                        ...auditEntry,
                        action: 'error',
                        result: 'allowed',
                    });
                }
                throw error;
            }
        };
        return {
            spec: {
                ...originalTool.spec,
                description: `${originalTool.spec.description} [Authorization required]`,
            },
            invoke: authorizedInvoke,
        };
    };
}
/**
 * Apply authorization to all tool factories
 */
export function applyAuthorization(factories, toolNames) {
    return factories.map((factory, index) => {
        const toolName = toolNames[index];
        if (!toolName) {
            throw new Error(`Tool name not found for factory at index ${index}`);
        }
        return createAuthorizedToolFactory(factory, toolName);
    });
}
/**
 * Get authorization requirements for a tool
 */
export function getToolAuthRequirements(toolName) {
    return TOOL_AUTH_REQUIREMENTS[toolName];
}
/**
 * Get all tools requiring specific permission level
 */
export function getToolsByPermissionLevel(level) {
    return Object.entries(TOOL_AUTH_REQUIREMENTS)
        .filter(([, req]) => req.requiredLevel === level)
        .map(([name]) => name);
}
/**
 * Get all dangerous tools
 */
export function getDangerousTools() {
    return Object.entries(TOOL_AUTH_REQUIREMENTS)
        .filter(([, req]) => req.dangerous)
        .map(([name]) => name);
}
/**
 * Get current authorization configuration
 */
export function getCurrentAuthConfig() {
    return getAuthConfig();
}
/**
 * Check if strict mode is enabled
 */
export function isStrictModeEnabled() {
    return getAuthConfig().strictMode;
}
/**
 * Check if authentication is required for dangerous operations
 */
export function isAuthRequiredForDangerous() {
    return getAuthConfig().requireAuthForDangerous;
}
/**
 * Check if an IP address is whitelisted for admin access
 */
export function isAdminIpWhitelisted(ipAddress) {
    const config = getAuthConfig();
    return config.adminIpWhitelist.includes(ipAddress);
}
/**
 * Validate admin IP address against whitelist
 */
export function validateAdminIp(ipAddress) {
    if (!ipAddress) {
        return { valid: false, reason: 'IP address not provided' };
    }
    const config = getAuthConfig();
    if (config.adminIpWhitelist.length === 0) {
        return { valid: true }; // No whitelist configured
    }
    if (!config.adminIpWhitelist.includes(ipAddress)) {
        return {
            valid: false,
            reason: `IP ${ipAddress} not in admin whitelist: ${config.adminIpWhitelist.join(', ')}`,
        };
    }
    return { valid: true };
}
/**
 * Get all tools that would be denied under strict mode
 */
export function getStrictModeDeniedTools() {
    return Object.keys(TOOL_AUTH_REQUIREMENTS).filter((toolName) => !TOOL_AUTH_REQUIREMENTS[toolName]);
}
/**
 * Authorization health check - returns configuration status
 */
export function getAuthorizationHealth() {
    const config = getAuthConfig();
    const configuredTools = Object.keys(TOOL_AUTH_REQUIREMENTS).length;
    const dangerousTools = getDangerousTools().length;
    return {
        strictMode: config.strictMode,
        requireAuthForDangerous: config.requireAuthForDangerous,
        adminIpWhitelistSize: config.adminIpWhitelist.length,
        auditLogEnabled: config.enableAuditLog,
        configuredTools,
        dangerousTools,
    };
}
//# sourceMappingURL=authorization.js.map