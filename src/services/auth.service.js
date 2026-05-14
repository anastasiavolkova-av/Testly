const crypto = require('crypto');
const jwt = require('jsonwebtoken');

class AuthService {
    constructor(pool) {
        this.pool = pool;
        this.tokenSecret = process.env.AUTH_TOKEN_SECRET || 'dev_auth_secret_change_me';
        this.cookieName = 'ab_auth_token';
        this.tokenTtlMs = 7 * 24 * 60 * 60 * 1000;
        this.jwtAlgorithm = 'HS256';
    }

    signToken(userId) {
        return jwt.sign({ uid: Number(userId) }, this.tokenSecret, {
            algorithm: this.jwtAlgorithm,
            expiresIn: this.tokenTtlMs / 1000
        });
    }

    verifyToken(token) {
        if (!token || typeof token !== 'string') return null;
        try {
            const decoded = jwt.verify(token, this.tokenSecret, {
                algorithms: [this.jwtAlgorithm]
            });
            if (!decoded || decoded.uid == null) return null;
            return { userId: Number(decoded.uid) };
        } catch {
            return null;
        }
    }

    hashSecret(value) {
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.scryptSync(value, salt, 64).toString('hex');
        return `${salt}:${hash}`;
    }

    verifySecret(value, storedHash) {
        if (!storedHash || typeof storedHash !== 'string' || !storedHash.includes(':')) return false;
        const [salt, originalHash] = storedHash.split(':');
        const checkHash = crypto.scryptSync(value, salt, 64).toString('hex');
        const originalBuffer = Buffer.from(originalHash, 'hex');
        const checkBuffer = Buffer.from(checkHash, 'hex');
        return (
            originalBuffer.length === checkBuffer.length &&
            crypto.timingSafeEqual(originalBuffer, checkBuffer)
        );
    }

    generateRecoveryCode() {
        const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
        const chunk = () =>
            Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
        return `ABT-${chunk()}-${chunk()}`;
    }

    setAuthCookie(res, token) {
        res.cookie(this.cookieName, token, {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            maxAge: this.tokenTtlMs,
            path: '/'
        });
    }

    clearAuthCookie(res) {
        res.clearCookie(this.cookieName, {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            path: '/'
        });
    }

    readAuthToken(req) {
        return req.cookies?.[this.cookieName] || null;
    }

    async findUserByUsername(username) {
        const result = await this.pool.query(
            `SELECT id, username, first_name, last_name, password_hash, recovery_code_hash, created_at
             FROM users
             WHERE LOWER(username) = LOWER($1)
             LIMIT 1`,
            [username]
        );
        return result.rows[0] || null;
    }

    async findUserPublicById(userId) {
        const result = await this.pool.query(
            `SELECT id, username, first_name, last_name, created_at
             FROM users
             WHERE id = $1
             LIMIT 1`,
            [userId]
        );
        return result.rows[0] || null;
    }
}

module.exports = AuthService;
