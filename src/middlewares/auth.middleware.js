const AuthService = require('../services/auth.service');

function createRequireAuth(pool) {
    const authService = new AuthService(pool);

    return async function requireAuth(req, res, next) {
        try {
            const token = authService.readAuthToken(req);
            const payload = authService.verifyToken(token);
            if (!payload?.userId) {
                return res.status(401).json({ error: 'Не авторизован' });
            }

            const user = await authService.findUserPublicById(payload.userId);
            if (!user) {
                authService.clearAuthCookie(res);
                return res.status(401).json({ error: 'Не авторизован' });
            }

            req.user = {
                id: Number(user.id),
                username: user.username,
                first_name: user.first_name,
                last_name: user.last_name
            };
            return next();
        } catch (error) {
            console.error('Ошибка auth middleware:', error);
            return res.status(500).json({ error: error.message });
        }
    };
}

module.exports = {
    createRequireAuth
};
