'use strict';

// Resolver metrics tracker untuk monitoring health
// Track success/failure rate per client, average resolve time, dll.

const metrics = {
    resolves: {
        total: 0,
        success: 0,
        failure: 0,
        cacheHit: 0,
        cacheMiss: 0,
    },
    clients: {
        // Format: { ANDROID: { attempts: 0, success: 0, avgTime: 0 }, ... }
    },
    failures: {
        // Format: { 'error message': count }
    },
    lastReset: Date.now(),
};

let lastFailureTime = 0;
let consecutiveFailures = 0;

function recordResolveAttempt(videoId, client, success, timeMs, error) {
    metrics.resolves.total++;
    
    if (success) {
        metrics.resolves.success++;
        consecutiveFailures = 0;
    } else {
        metrics.resolves.failure++;
        consecutiveFailures++;
        lastFailureTime = Date.now();
        
        // Track error types
        const errorKey = error?.message?.substring(0, 100) || 'Unknown error';
        metrics.failures[errorKey] = (metrics.failures[errorKey] || 0) + 1;
    }
    
    // Track per-client stats
    if (!metrics.clients[client]) {
        metrics.clients[client] = { attempts: 0, success: 0, totalTime: 0 };
    }
    
    const clientMetric = metrics.clients[client];
    clientMetric.attempts++;
    if (success) {
        clientMetric.success++;
        clientMetric.totalTime += timeMs;
    }
}

function recordCacheHit() {
    metrics.resolves.cacheHit++;
}

function recordCacheMiss() {
    metrics.resolves.cacheMiss++;
}

function getMetrics() {
    const now = Date.now();
    const uptime = now - metrics.lastReset;
    
    // Calculate per-client averages
    const clientStats = {};
    for (const [client, data] of Object.entries(metrics.clients)) {
        clientStats[client] = {
            attempts: data.attempts,
            success: data.success,
            successRate: data.attempts > 0 ? (data.success / data.attempts * 100).toFixed(1) + '%' : 'N/A',
            avgTimeMs: data.success > 0 ? Math.round(data.totalTime / data.success) : 0,
        };
    }
    
    return {
        uptime: Math.round(uptime / 1000 / 60) + ' min',
        resolves: {
            total: metrics.resolves.total,
            success: metrics.resolves.success,
            failure: metrics.resolves.failure,
            successRate: metrics.resolves.total > 0 
                ? (metrics.resolves.success / metrics.resolves.total * 100).toFixed(1) + '%'
                : 'N/A',
        },
        cache: {
            hit: metrics.resolves.cacheHit,
            miss: metrics.resolves.cacheMiss,
            hitRate: (metrics.resolves.cacheHit + metrics.resolves.cacheMiss) > 0
                ? (metrics.resolves.cacheHit / (metrics.resolves.cacheHit + metrics.resolves.cacheMiss) * 100).toFixed(1) + '%'
                : 'N/A',
        },
        clients: clientStats,
        recentFailures: Object.entries(metrics.failures)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([msg, count]) => ({ error: msg, count })),
        health: getHealthStatus(),
    };
}

function getHealthStatus() {
    const successRate = metrics.resolves.total > 0 
        ? metrics.resolves.success / metrics.resolves.total 
        : 1;
    
    const timeSinceLastFailure = Date.now() - lastFailureTime;
    
    if (consecutiveFailures >= 5) return '🔴 CRITICAL - Multiple consecutive failures';
    if (consecutiveFailures >= 3) return '🟠 DEGRADED - Resolver unstable';
    if (successRate < 0.5 && metrics.resolves.total >= 10) return '🟠 DEGRADED - Low success rate';
    if (successRate < 0.8 && metrics.resolves.total >= 10) return '🟡 WARNING - Elevated failures';
    if (timeSinceLastFailure < 60000 && consecutiveFailures > 0) return '🟡 WARNING - Recent failures';
    
    return '🟢 HEALTHY';
}

function resetMetrics() {
    metrics.resolves = { total: 0, success: 0, failure: 0, cacheHit: 0, cacheMiss: 0 };
    metrics.clients = {};
    metrics.failures = {};
    metrics.lastReset = Date.now();
    consecutiveFailures = 0;
}

function shouldThrottle() {
    // If too many consecutive failures, throttle resolve attempts
    if (consecutiveFailures >= 10) {
        const throttleUntil = lastFailureTime + (60000 * Math.min(consecutiveFailures - 9, 10)); // 1-10 min
        if (Date.now() < throttleUntil) {
            return { throttled: true, waitMs: throttleUntil - Date.now() };
        }
    }
    return { throttled: false };
}

module.exports = {
    recordResolveAttempt,
    recordCacheHit,
    recordCacheMiss,
    getMetrics,
    resetMetrics,
    shouldThrottle,
};
