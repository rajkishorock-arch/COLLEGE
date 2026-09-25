/**
 * Lightweight, production-safe sliding window rate limiter
 * Protects login, signup, password reset, and invitations from brute-force/DoS
 * without requiring external Redis dependency for single or modest multi-instance scale.
 */

class SlidingWindowRateLimiter {
  constructor(windowMs, maxRequests, message = 'Too many requests. Please try again later.') {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.message = message;
    this.hits = new Map();

    // Periodic sweep to prevent memory leak
    setInterval(() => this.cleanup(), Math.min(this.windowMs, 60000)).unref();
  }

  cleanup() {
    const now = Date.now();
    for (const [key, timestamps] of this.hits.entries()) {
      const valid = timestamps.filter(t => now - t < this.windowMs);
      if (valid.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, valid);
      }
    }
  }

  middleware() {
    return (req, res, next) => {
      // In development/testing, allow bypass if TEST_MODE is set
      if (process.env.TEST_MODE === 'true') {
        return next();
      }

      const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
      const key = `${clientIp}:${req.baseUrl || ''}${req.path}`;
      const now = Date.now();

      const timestamps = this.hits.get(key) || [];
      const validTimestamps = timestamps.filter(t => now - t < this.windowMs);

      if (validTimestamps.length >= this.maxRequests) {
        res.setHeader('Retry-After', Math.ceil(this.windowMs / 1000));
        res.setHeader('X-RateLimit-Limit', this.maxRequests);
        res.setHeader('X-RateLimit-Remaining', 0);

        if (typeof req.accepts === 'function' && req.accepts('html')) {
          return res.status(429).render('error', {
            statusCode: 429,
            title: 'Too Many Requests',
            message: this.message,
            user: req.session ? req.session.user : null
          });
        }
        return res.status(429).json({ error: this.message, retryAfterSeconds: Math.ceil(this.windowMs / 1000) });
      }

      validTimestamps.push(now);
      this.hits.set(key, validTimestamps);

      res.setHeader('X-RateLimit-Limit', this.maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, this.maxRequests - validTimestamps.length));

      next();
    };
  }
}

// Pre-configured limiters for critical paths:
// 1. Auth limiter: 25 attempts per 5 minutes per IP
const authLimiter = new SlidingWindowRateLimiter(5 * 60 * 1000, 25, 'Too many authentication attempts from this network. Please wait a few minutes before trying again.').middleware();

// 2. Sensitive action limiter (password changes, invitations): 15 attempts per 10 minutes
const sensitiveActionLimiter = new SlidingWindowRateLimiter(10 * 60 * 1000, 15, 'Action rate limit reached. Please wait a few minutes before submitting again.').middleware();

module.exports = {
  authLimiter,
  sensitiveActionLimiter,
  SlidingWindowRateLimiter
};
