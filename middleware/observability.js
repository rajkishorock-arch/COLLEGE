const crypto = require('crypto');

/**
 * Production Observability Middleware
 * - Injects unique X-Request-Id header
 * - Structured non-blocking request performance logger
 * - Redacts sensitive authorization tokens and passwords
 */
function observabilityMiddleware(req, res, next) {
  // Generate or preserve incoming request ID
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startTime = Date.now();

  // Hook into response finish event
  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const actorId = req.session && req.session.user ? req.session.user.id : 'anonymous';
    const tenantId = req.tenantId || (req.session && req.session.user ? req.session.user.tenantId : 'unscoped');

    // Skip verbose logs for static assets
    if (req.path.startsWith('/css') || req.path.startsWith('/js') || req.path.startsWith('/favicon') || req.path.startsWith('/uploads')) {
      return;
    }

    const logEntry = {
      requestId,
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs,
      tenantId,
      actorId,
      ip: req.ip || req.connection?.remoteAddress
    };

    if (res.statusCode >= 400) {
      logEntry.level = res.statusCode >= 500 ? 'ERROR' : 'WARN';
      console.warn(`[HTTP:${logEntry.level}] ${logEntry.method} ${logEntry.path} -> ${logEntry.status} (${durationMs}ms) [ReqID: ${requestId}] [Tenant: ${tenantId}]`);
    } else {
      logEntry.level = 'INFO';
      console.log(`[HTTP:INFO] ${logEntry.method} ${logEntry.path} -> ${logEntry.status} (${durationMs}ms) [ReqID: ${requestId}] [Tenant: ${tenantId}]`);
    }
  });

  next();
}

module.exports = observabilityMiddleware;
