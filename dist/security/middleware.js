/**
 * @fileoverview Comprehensive security middleware for MCP service
 * Provides rate limiting, security headers, audit logging, and abuse prevention
 */
import crypto from 'node:crypto';
import { createHash } from 'node:crypto';
export const DEFAULT_SECURITY_CONFIG = {
    rateLimitWindowMs: 15 * 60 * 1000, // 15 minutes
    rateLimitMaxRequests: 1000, // 1000 requests per window
    globalRateLimitMaxPerMinute: 1000, // Global per-minute limit
    globalRateLimitMaxPerHour: 10000, // Global per-hour limit
    maxFailedAttempts: 10, // Block after 10 failed attempts
    ipBlockDurationMs: 60 * 60 * 1000, // 1 hour block
    violationDecayHours: 24, // Violations decay after 24 hours
    maxRequestSizeBytes: 10 * 1024 * 1024, // 10MB
    maxUrlLength: 2048, // 2KB URL max
    enableSecurityHeaders: true,
    allowedOrigins: ['*'],
    enableAuditLog: true,
    auditLogSensitiveData: false,
};
// ============================================================================
// In-Memory Stores (for production, use Redis or database)
// ============================================================================
class RateLimitStore {
    requests = new Map();
    globalRequests = new Map();
    isAllowed(key, windowMs, maxRequests) {
        const now = Date.now();
        const existing = this.requests.get(key);
        if (!existing || now > existing.resetTime) {
            const resetTime = now + windowMs;
            this.requests.set(key, { count: 1, resetTime });
            return { allowed: true, resetTime };
        }
        if (existing.count >= maxRequests) {
            return { allowed: false, resetTime: existing.resetTime };
        }
        existing.count++;
        return { allowed: true, resetTime: existing.resetTime };
    }
    isAllowedGlobal(maxPerMinute, maxPerHour) {
        const now = Date.now();
        const minuteMs = 60 * 1000;
        const hourMs = 60 * 60 * 1000;
        let globalEntry = this.globalRequests.get('global');
        if (!globalEntry || now > globalEntry.resetTime) {
            const resetTime = now + hourMs;
            globalEntry = {
                count: 0,
                windowStart: now,
                resetTime,
            };
            this.globalRequests.set('global', globalEntry);
        }
        // Check per-minute limit
        const timeInMinute = now - globalEntry.windowStart;
        if (timeInMinute < minuteMs && globalEntry.count >= maxPerMinute) {
            return {
                allowed: false,
                resetTime: globalEntry.windowStart + minuteMs,
                reason: 'Global per-minute rate limit exceeded',
            };
        }
        // Check per-hour limit
        if (globalEntry.count >= maxPerHour) {
            return {
                allowed: false,
                resetTime: globalEntry.resetTime,
                reason: 'Global per-hour rate limit exceeded',
            };
        }
        globalEntry.count++;
        return {
            allowed: true,
            resetTime: globalEntry.resetTime,
            reason: 'OK',
        };
    }
    cleanup() {
        const now = Date.now();
        for (const [key, data] of this.requests.entries()) {
            if (now > data.resetTime) {
                this.requests.delete(key);
            }
        }
        for (const [key, data] of this.globalRequests.entries()) {
            if (now > data.resetTime) {
                this.globalRequests.delete(key);
            }
        }
    }
}
class BlockedIpStore {
    blockedIps = new Map();
    isBlocked(ip) {
        const blocked = this.blockedIps.get(ip);
        if (!blocked)
            return { blocked: false };
        if (Date.now() > blocked.blockedUntil) {
            this.blockedIps.delete(ip);
            return { blocked: false };
        }
        return {
            blocked: true,
            reason: blocked.reason,
            blockedUntil: blocked.blockedUntil,
        };
    }
    blockIp(ip, durationMs, reason) {
        const existing = this.blockedIps.get(ip);
        const blockedUntil = Date.now() + durationMs;
        this.blockedIps.set(ip, {
            blockedUntil,
            reason,
            attempts: (existing?.attempts || 0) + 1,
        });
    }
    cleanup() {
        const now = Date.now();
        for (const [ip, data] of this.blockedIps.entries()) {
            if (now > data.blockedUntil) {
                this.blockedIps.delete(ip);
            }
        }
    }
}
// ============================================================================
// Security Middleware Implementation
// ============================================================================
export class McpSecurityMiddleware {
    config;
    rateLimitStore = new RateLimitStore();
    blockedIpStore = new BlockedIpStore();
    auditLog = [];
    cleanupInterval;
    constructor(config = {}) {
        this.config = { ...DEFAULT_SECURITY_CONFIG, ...config };
        // Set up periodic cleanup
        this.cleanupInterval = setInterval(() => {
            this.rateLimitStore.cleanup();
            this.blockedIpStore.cleanup();
            this.trimAuditLog();
        }, 5 * 60 * 1000); // Every 5 minutes
    }
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
    }
    // ============================================================================
    // Main Middleware Registration
    // ============================================================================
    register(app) {
        // Add security context to each request
        app.addHook('onRequest', async (request, reply) => {
            console.log(`🔒 SECURITY HOOK: createSecurityContext START`);
            const start = Date.now();
            try {
                this.createSecurityContext(request, reply);
                console.log(`🔒 SECURITY HOOK: createSecurityContext END (${Date.now() - start}ms)`);
            }
            catch (error) {
                console.log(`🔒 SECURITY HOOK: createSecurityContext ERROR (${Date.now() - start}ms):`, error);
                throw error;
            }
        });
        // Suspicious pattern detection
        app.addHook('onRequest', async (request, reply) => {
            console.log(`🔒 SECURITY HOOK: detectSuspiciousPatterns START`);
            const start = Date.now();
            try {
                this.detectSuspiciousPatterns(request, reply);
                console.log(`🔒 SECURITY HOOK: detectSuspiciousPatterns END (${Date.now() - start}ms)`);
            }
            catch (error) {
                console.log(`🔒 SECURITY HOOK: detectSuspiciousPatterns ERROR (${Date.now() - start}ms):`, error);
                throw error;
            }
        });
        // Rate limiting and IP blocking
        app.addHook('onRequest', async (request, reply) => {
            console.log(`🔒 SECURITY HOOK: enforceRateLimit START`);
            const start = Date.now();
            try {
                this.enforceRateLimit(request, reply);
                console.log(`🔒 SECURITY HOOK: enforceRateLimit END (${Date.now() - start}ms)`);
            }
            catch (error) {
                console.log(`🔒 SECURITY HOOK: enforceRateLimit ERROR (${Date.now() - start}ms):`, error);
                throw error;
            }
        });
        // Request size and URL validation
        app.addHook('onRequest', async (request, reply) => {
            console.log(`🔒 SECURITY HOOK: validateRequestSize START`);
            const start = Date.now();
            try {
                this.validateRequestSize(request, reply);
                console.log(`🔒 SECURITY HOOK: validateRequestSize END (${Date.now() - start}ms)`);
            }
            catch (error) {
                console.log(`🔒 SECURITY HOOK: validateRequestSize ERROR (${Date.now() - start}ms):`, error);
                throw error;
            }
        });
        // Security headers
        if (this.config.enableSecurityHeaders) {
            app.addHook('onSend', async (request, reply, payload) => {
                console.log(`🔒 SECURITY HOOK: addSecurityHeaders START`);
                const start = Date.now();
                try {
                    await this.addSecurityHeaders(request, reply, payload);
                    console.log(`🔒 SECURITY HOOK: addSecurityHeaders END (${Date.now() - start}ms)`);
                }
                catch (error) {
                    console.log(`🔒 SECURITY HOOK: addSecurityHeaders ERROR (${Date.now() - start}ms):`, error);
                    throw error;
                }
            });
        }
        // Audit logging
        if (this.config.enableAuditLog) {
            app.addHook('onRequest', async (request, reply) => {
                console.log(`🔒 SECURITY HOOK: logRequestStart START`);
                const start = Date.now();
                try {
                    this.logRequestStart(request, reply);
                    console.log(`🔒 SECURITY HOOK: logRequestStart END (${Date.now() - start}ms)`);
                }
                catch (error) {
                    console.log(`🔒 SECURITY HOOK: logRequestStart ERROR (${Date.now() - start}ms):`, error);
                    throw error;
                }
            });
            app.addHook('onResponse', async (request, reply) => {
                console.log(`🔒 SECURITY HOOK: logRequestEnd START`);
                const start = Date.now();
                try {
                    this.logRequestEnd(request, reply);
                    console.log(`🔒 SECURITY HOOK: logRequestEnd END (${Date.now() - start}ms)`);
                }
                catch (error) {
                    console.log(`🔒 SECURITY HOOK: logRequestEnd ERROR (${Date.now() - start}ms):`, error);
                    throw error;
                }
            });
            app.addHook('onError', async (request, reply, error) => {
                console.log(`🔒 SECURITY HOOK: logError START`);
                const start = Date.now();
                try {
                    this.logError(request, reply, error);
                    console.log(`🔒 SECURITY HOOK: logError END (${Date.now() - start}ms)`);
                }
                catch (error) {
                    console.log(`🔒 SECURITY HOOK: logError ERROR (${Date.now() - start}ms):`, error);
                    throw error;
                }
            });
        }
    }
    // ============================================================================
    // Security Context Creation
    // ============================================================================
    createSecurityContext(request, reply) {
        const clientIp = this.getClientIp(request);
        const userAgent = request.headers['user-agent'] || 'unknown';
        const userAgentHash = createHash('sha256').update(userAgent).digest('hex').substring(0, 16);
        const context = {
            requestId: crypto.randomUUID(),
            clientIp,
            userAgent,
            timestamp: Date.now(),
            method: request.method,
            url: request.url,
            path: request.routerPath || request.url,
            userAgentHash,
        };
        // Store context for later hooks
        request.securityContext = context;
        reply.securityContext = context;
    }
    // ============================================================================
    // Rate Limiting and IP Blocking
    // ============================================================================
    enforceRateLimit(request, reply) {
        const context = request.securityContext;
        // Check if IP is blocked
        const blockStatus = this.blockedIpStore.isBlocked(context.clientIp);
        if (blockStatus.blocked) {
            const violation = {
                type: 'blocked_ip',
                severity: 'high',
                message: `IP blocked: ${blockStatus.reason}`,
                context,
                timestamp: Date.now(),
            };
            this.logViolation(violation);
            this.sendSecurityResponse(reply, 403, 'IP_BLOCKED', 'Your IP address has been blocked due to suspicious activity');
            return;
        }
        // Check global rate limiting first
        const globalRateStatus = this.rateLimitStore.isAllowedGlobal(this.config.globalRateLimitMaxPerMinute, this.config.globalRateLimitMaxPerHour);
        if (!globalRateStatus.allowed) {
            const violation = {
                type: 'rate_limit',
                severity: 'medium',
                message: `Global rate limit exceeded: ${globalRateStatus.reason}. Try again after ${new Date(globalRateStatus.resetTime).toISOString()}`,
                context,
                timestamp: Date.now(),
            };
            this.logViolation(violation);
            this.handleRepeatedViolations(context.clientIp);
            reply.header('X-RateLimit-Limit', this.config.globalRateLimitMaxPerMinute);
            reply.header('X-RateLimit-Remaining', 0);
            reply.header('X-RateLimit-Reset', new Date(globalRateStatus.resetTime).getTime());
            this.sendSecurityResponse(reply, 429, 'GLOBAL_RATE_LIMITED', 'Global rate limit exceeded');
            return;
        }
        // Check per-IP rate limiting
        const rateLimitKey = `${context.clientIp}:${context.userAgentHash}`;
        const rateStatus = this.rateLimitStore.isAllowed(rateLimitKey, this.config.rateLimitWindowMs, this.config.rateLimitMaxRequests);
        if (!rateStatus.allowed) {
            const violation = {
                type: 'rate_limit',
                severity: 'medium',
                message: `Rate limit exceeded. Try again after ${new Date(rateStatus.resetTime).toISOString()}`,
                context,
                timestamp: Date.now(),
            };
            this.logViolation(violation);
            // Block IP if too many violations
            this.handleRepeatedViolations(context.clientIp);
            reply.header('X-RateLimit-Limit', this.config.rateLimitMaxRequests);
            reply.header('X-RateLimit-Remaining', 0);
            reply.header('X-RateLimit-Reset', new Date(rateStatus.resetTime).getTime());
            this.sendSecurityResponse(reply, 429, 'RATE_LIMITED', 'Too many requests');
            return;
        }
        // Add rate limit headers
        reply.header('X-RateLimit-Limit', this.config.rateLimitMaxRequests);
        reply.header('X-RateLimit-Remaining', Math.max(0, this.config.rateLimitMaxRequests - 1));
        reply.header('X-RateLimit-Reset', new Date(rateStatus.resetTime).getTime());
    }
    // ============================================================================
    // Request Validation
    // ============================================================================
    validateRequestSize(request, reply) {
        const context = request.securityContext;
        // Check URL length
        if (context.url.length > this.config.maxUrlLength) {
            const violation = {
                type: 'invalid_url',
                severity: 'medium',
                message: `URL too long: ${context.url.length} > ${this.config.maxUrlLength}`,
                context,
                timestamp: Date.now(),
            };
            this.logViolation(violation);
            this.sendSecurityResponse(reply, 414, 'URL_TOO_LONG', 'Request URL too long');
            return;
        }
        // Check query parameter length
        const queryString = context.url.split('?')[1] || '';
        if (queryString.length > 2000) {
            const violation = {
                type: 'oversized_input',
                severity: 'medium',
                message: `Query string too long: ${queryString.length} > 2000`,
                context,
                timestamp: Date.now(),
            };
            this.logViolation(violation);
            this.sendSecurityResponse(reply, 414, 'QUERY_TOO_LONG', 'Query string too long');
            return;
        }
        // Check header size
        const headerSize = JSON.stringify(request.headers).length;
        if (headerSize > 8000) {
            const violation = {
                type: 'oversized_input',
                severity: 'medium',
                message: `Headers too large: ${headerSize} > 8000`,
                context,
                timestamp: Date.now(),
            };
            this.logViolation(violation);
            this.sendSecurityResponse(reply, 431, 'HEADERS_TOO_LARGE', 'Request headers too large');
            return;
        }
        // Check content length for POST/PUT requests
        const contentLength = request.headers['content-length'];
        if (contentLength && parseInt(contentLength, 10) > this.config.maxRequestSizeBytes) {
            const violation = {
                type: 'large_request',
                severity: 'medium',
                message: `Request too large: ${contentLength} > ${this.config.maxRequestSizeBytes}`,
                context,
                timestamp: Date.now(),
            };
            this.logViolation(violation);
            this.sendSecurityResponse(reply, 413, 'REQUEST_TOO_LARGE', 'Request entity too large');
            return;
        }
    }
    // ============================================================================
    // Suspicious Pattern Detection
    // ============================================================================
    detectSuspiciousPatterns(request, reply) {
        const context = request.securityContext;
        // Check for path traversal patterns
        const pathTraversalPatterns = ['../', '..\\', '%2e%2e%2f', '%2e%2e\\', '....//', '....\\\\'];
        for (const pattern of pathTraversalPatterns) {
            if (context.url.toLowerCase().includes(pattern)) {
                const violation = {
                    type: 'path_traversal_attempt',
                    severity: 'critical',
                    message: `Path traversal attempt detected: ${pattern}`,
                    context,
                    timestamp: Date.now(),
                };
                this.logViolation(violation);
                this.handleRepeatedViolations(context.clientIp);
                this.sendSecurityResponse(reply, 400, 'BAD_REQUEST', 'Suspicious request pattern detected');
                return;
            }
        }
        // Check for injection patterns
        const injectionPatterns = [
            '<script',
            'javascript:',
            'vbscript:',
            'onload=',
            'onerror=',
            'onclick=',
            'eval(',
            'alert(',
            'prompt(',
            'confirm(',
            'document.cookie',
            'window.location',
            'union select',
            'drop table',
            'insert into',
            'delete from',
            'update set',
            'exec(',
            'system(',
            'shell_exec',
            'passthru',
        ];
        const fullRequest = context.url + JSON.stringify(request.query) + JSON.stringify(request.body);
        const fullRequestLower = fullRequest.toLowerCase();
        for (const pattern of injectionPatterns) {
            if (fullRequestLower.includes(pattern)) {
                const violation = {
                    type: 'injection_attempt',
                    severity: 'critical',
                    message: `Injection attempt detected: ${pattern}`,
                    context,
                    timestamp: Date.now(),
                };
                this.logViolation(violation);
                this.handleRepeatedViolations(context.clientIp);
                this.sendSecurityResponse(reply, 400, 'BAD_REQUEST', 'Suspicious request pattern detected');
                return;
            }
        }
        // Check for suspicious user agents
        const suspiciousUserAgents = [
            'sqlmap',
            'nikto',
            'nmap',
            'masscan',
            'zap',
            'burp',
            'scanner',
            'crawler',
        ];
        const userAgentLower = context.userAgent.toLowerCase();
        for (const pattern of suspiciousUserAgents) {
            if (userAgentLower.includes(pattern)) {
                const violation = {
                    type: 'suspicious_pattern',
                    severity: 'medium',
                    message: `Suspicious user agent detected: ${pattern}`,
                    context,
                    timestamp: Date.now(),
                };
                this.logViolation(violation);
                // Don't block immediately for suspicious user agents, just log
                break;
            }
        }
    }
    // ============================================================================
    // Security Headers
    // ============================================================================
    async addSecurityHeaders(request, reply, _payload) {
        const context = request.securityContext;
        // Use context to avoid unused variable warning
        void context;
        // Security headers
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('X-Frame-Options', 'DENY');
        reply.header('X-XSS-Protection', '1; mode=block');
        reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
        reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
        reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        // Content Security Policy
        reply.header('Content-Security-Policy', "default-src 'self'; " +
            "script-src 'self' 'unsafe-inline'; " +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data:; " +
            "font-src 'self'; " +
            "connect-src 'self'");
        // Remove server information
        reply.header('Server', '');
        reply.header('X-Powered-By', '');
        // CORS headers
        const origin = request.headers.origin;
        if (this.config.allowedOrigins.includes('*') ||
            (origin && this.config.allowedOrigins.includes(origin))) {
            reply.header('Access-Control-Allow-Origin', origin || '*');
            reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, MCP-Session-ID');
            reply.header('Access-Control-Allow-Credentials', 'true');
            reply.header('Access-Control-Max-Age', '86400');
        }
    }
    // ============================================================================
    // Audit Logging
    // ============================================================================
    logRequestStart(request, _reply) {
        const context = request.securityContext;
        const entry = {
            timestamp: new Date(context.timestamp).toISOString(),
            requestId: context.requestId,
            clientIp: context.clientIp,
            method: context.method,
            url: context.url,
            path: context.path,
            userAgent: context.userAgent,
            blocked: false,
        };
        // Store request start time
        request.requestStartTime = context.timestamp;
        request.auditEntry = entry;
    }
    logRequestEnd(request, reply) {
        const entry = request.auditEntry;
        if (!entry)
            return;
        const startTime = request.requestStartTime || Date.now();
        const duration = Date.now() - startTime;
        entry.statusCode = reply.statusCode;
        entry.duration = duration;
        entry.requestSize = parseInt(request.headers['content-length'] || '0', 10);
        entry.responseSize = reply.getHeader('content-length')
            ? parseInt(reply.getHeader('content-length'), 10)
            : 0;
        this.addAuditEntry(entry);
    }
    logError(request, reply, error) {
        const context = request.securityContext;
        if (!context)
            return;
        const entry = {
            timestamp: new Date().toISOString(),
            requestId: context.requestId,
            clientIp: context.clientIp,
            method: context.method,
            url: context.url,
            path: context.path,
            userAgent: context.userAgent,
            statusCode: reply.statusCode || 500,
            blocked: false,
            reason: `Error: ${error.message}`,
        };
        this.addAuditEntry(entry);
    }
    // ============================================================================
    // Security Violation Handling
    // ============================================================================
    handleRepeatedViolations(clientIp) {
        // Count recent violations for this IP with decay
        const now = Date.now();
        const decayHours = this.config.violationDecayHours;
        const decayWindowMs = decayHours * 60 * 60 * 1000;
        const recentViolations = this.auditLog
            .filter((entry) => entry.clientIp === clientIp && now - new Date(entry.timestamp).getTime() < decayWindowMs) // Within decay window
            .filter((entry) => entry.blocked);
        // Apply decay - older violations count less
        let weightedViolations = 0;
        for (const violation of recentViolations) {
            const ageHours = (now - new Date(violation.timestamp).getTime()) / (60 * 60 * 1000);
            const weight = Math.max(0.1, 1 - ageHours / decayHours); // Decay from 1 to 0.1
            weightedViolations += weight;
        }
        if (weightedViolations >= this.config.maxFailedAttempts) {
            this.blockedIpStore.blockIp(clientIp, this.config.ipBlockDurationMs, `Too many security violations: ${Math.round(weightedViolations)} weighted violations in last ${decayHours} hours`);
        }
    }
    logViolation(violation) {
        const entry = {
            timestamp: new Date(violation.timestamp).toISOString(),
            requestId: violation.context.requestId,
            clientIp: violation.context.clientIp,
            method: violation.context.method,
            url: violation.context.url,
            path: violation.context.path,
            userAgent: violation.context.userAgent,
            blocked: true,
            reason: `${violation.type}: ${violation.message}`,
            violations: [violation],
        };
        this.addAuditEntry(entry);
        // Also log to console for immediate visibility
        console.warn(`🚨 SECURITY VIOLATION [${violation.severity.toUpperCase()}]`);
        console.warn(`   Type: ${violation.type}`);
        console.warn(`   IP: ${violation.context.clientIp}`);
        console.warn(`   Message: ${violation.message}`);
        console.warn(`   URL: ${violation.context.method} ${violation.context.url}`);
        console.warn(`   Time: ${new Date(violation.timestamp).toISOString()}`);
    }
    // ============================================================================
    // Utility Methods
    // ============================================================================
    getClientIp(request) {
        // Check various headers for real IP
        const forwardedFor = request.headers['x-forwarded-for'];
        if (forwardedFor) {
            const parts = forwardedFor.split(',');
            return parts[0]?.trim() || 'unknown';
        }
        const realIp = request.headers['x-real-ip'];
        if (realIp) {
            return realIp.trim();
        }
        return request.ip || 'unknown';
    }
    sendSecurityResponse(reply, statusCode, code, message) {
        reply.status(statusCode).header('content-type', 'application/json').send({
            error: code,
            message,
            timestamp: new Date().toISOString(),
        });
    }
    addAuditEntry(entry) {
        this.auditLog.push(entry);
        // Trim audit log to prevent memory issues (keep last 10000 entries)
        if (this.auditLog.length > 10000) {
            this.auditLog = this.auditLog.slice(-5000);
        }
    }
    trimAuditLog() {
        // Remove entries older than 24 hours
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        this.auditLog = this.auditLog.filter((entry) => new Date(entry.timestamp).getTime() > cutoff);
    }
    // ============================================================================
    // Public API Methods
    // ============================================================================
    getAuditLog(options = {}) {
        let filtered = this.auditLog;
        if (options.clientIp) {
            filtered = filtered.filter((entry) => entry.clientIp === options.clientIp);
        }
        if (options.startTime) {
            filtered = filtered.filter((entry) => new Date(entry.timestamp) >= options.startTime);
        }
        if (options.endTime) {
            filtered = filtered.filter((entry) => new Date(entry.timestamp) <= options.endTime);
        }
        if (options.onlyViolations) {
            filtered = filtered.filter((entry) => entry.blocked || entry.violations?.length);
        }
        // Sort by timestamp descending and limit
        filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        if (options.limit) {
            filtered = filtered.slice(0, options.limit);
        }
        return filtered;
    }
    getBlockedIps() {
        // This would need to be exposed from BlockedIpStore
        // For now, return empty array
        return [];
    }
    getSecurityStats() {
        const totalRequests = this.auditLog.length;
        const blockedRequests = this.auditLog.filter((entry) => entry.blocked).length;
        const violationsByType = {};
        const ipCounts = {};
        this.auditLog.forEach((entry) => {
            if (entry.blocked) {
                ipCounts[entry.clientIp] = (ipCounts[entry.clientIp] || 0) + 1;
                if (entry.reason) {
                    const reasonParts = entry.reason.split(':');
                    const type = reasonParts[0] || 'unknown';
                    violationsByType[type] = (violationsByType[type] || 0) + 1;
                }
            }
        });
        const topBlockedIps = Object.entries(ipCounts)
            .map(([ip, count]) => ({ ip, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);
        return {
            totalRequests,
            blockedRequests,
            violationsByType,
            topBlockedIps,
        };
    }
}
// ============================================================================
// Factory Function
// ============================================================================
export function createSecurityMiddleware(config = {}) {
    return new McpSecurityMiddleware(config);
}
//# sourceMappingURL=middleware.js.map