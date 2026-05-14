const AuthService = require('../services/auth.service');

class AuthController {
    constructor(pool) {
        this.pool = pool;
        this.authService = new AuthService(pool);
    }

    sanitizeUser(userRow) {
        if (!userRow) return null;
        return {
            id: userRow.id,
            username: userRow.username,
            first_name: userRow.first_name,
            last_name: userRow.last_name,
            created_at: userRow.created_at
        };
    }

    async register(req, res) {
        try {
            const firstName = String(req.body?.first_name || '').trim();
            const lastName = String(req.body?.last_name || '').trim();
            const username = String(req.body?.username || '').trim().toLowerCase();
            const password = String(req.body?.password || '');

            if (!firstName || !lastName || !username || !password) {
                return res.status(400).json({ error: 'Заполните обязательные поля' });
            }
            if (username.length < 3) {
                return res.status(400).json({ error: 'Логин должен содержать минимум 3 символа' });
            }
            if (password.length < 8) {
                return res.status(400).json({ error: 'Пароль должен содержать минимум 8 символов' });
            }

            const existing = await this.authService.findUserByUsername(username);
            if (existing) {
                return res.status(409).json({ error: 'Этот логин уже занят' });
            }

            const recoveryCode = this.authService.generateRecoveryCode();
            const passwordHash = this.authService.hashSecret(password);
            const recoveryCodeHash = this.authService.hashSecret(recoveryCode);

            const result = await this.pool.query(
                `INSERT INTO users (username, first_name, last_name, password_hash, recovery_code_hash)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING id, username, first_name, last_name, created_at`,
                [username, firstName, lastName, passwordHash, recoveryCodeHash]
            );

            const user = this.sanitizeUser(result.rows[0]);
            const token = this.authService.signToken(user.id);
            this.authService.setAuthCookie(res, token);

            return res.status(201).json({
                success: true,
                user,
                recovery_code: recoveryCode
            });
        } catch (error) {
            console.error('Ошибка регистрации:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    async login(req, res) {
        try {
            const username = String(req.body?.username || '').trim().toLowerCase();
            const password = String(req.body?.password || '');
            if (!username || !password) {
                return res.status(400).json({ error: 'Укажите логин и пароль' });
            }

            const user = await this.authService.findUserByUsername(username);
            if (!user) {
                return res.status(401).json({ error: 'Неверный логин или пароль' });
            }

            const isValidPassword = this.authService.verifySecret(password, user.password_hash);
            if (!isValidPassword) {
                return res.status(401).json({ error: 'Неверный логин или пароль' });
            }

            const token = this.authService.signToken(user.id);
            this.authService.setAuthCookie(res, token);

            return res.json({
                success: true,
                user: this.sanitizeUser(user)
            });
        } catch (error) {
            console.error('Ошибка входа:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    async logout(req, res) {
        this.authService.clearAuthCookie(res);
        return res.json({ success: true });
    }

    async me(req, res) {
        try {
            const token = this.authService.readAuthToken(req);
            const payload = this.authService.verifyToken(token);
            if (!payload) {
                return res.status(401).json({ error: 'Не авторизован' });
            }

            const user = await this.authService.findUserPublicById(payload.userId);
            if (!user) {
                this.authService.clearAuthCookie(res);
                return res.status(401).json({ error: 'Не авторизован' });
            }

            return res.json({
                success: true,
                user: this.sanitizeUser(user)
            });
        } catch (error) {
            console.error('Ошибка /auth/me:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    async resetPassword(req, res) {
        try {
            const username = String(req.body?.username || '').trim().toLowerCase();
            const recoveryCode = String(req.body?.recovery_code || '').trim().toUpperCase();
            const newPassword = String(req.body?.new_password || '');

            if (!username || !recoveryCode || !newPassword) {
                return res.status(400).json({ error: 'Заполните все поля' });
            }
            if (newPassword.length < 8) {
                return res.status(400).json({ error: 'Новый пароль должен содержать минимум 8 символов' });
            }

            const user = await this.authService.findUserByUsername(username);
            if (!user) {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }

            const isValidCode = this.authService.verifySecret(recoveryCode, user.recovery_code_hash);
            if (!isValidCode) {
                return res.status(401).json({ error: 'Неверный код восстановления' });
            }

            const newRecoveryCode = this.authService.generateRecoveryCode();
            const passwordHash = this.authService.hashSecret(newPassword);
            const recoveryCodeHash = this.authService.hashSecret(newRecoveryCode);

            await this.pool.query(
                `UPDATE users
                 SET password_hash = $2,
                     recovery_code_hash = $3
                 WHERE id = $1`,
                [user.id, passwordHash, recoveryCodeHash]
            );

            return res.json({
                success: true,
                recovery_code: newRecoveryCode
            });
        } catch (error) {
            console.error('Ошибка reset-password:', error);
            return res.status(500).json({ error: error.message });
        }
    }
}

module.exports = AuthController;
