class ProjectsController {
    constructor(pool) {
        this.pool = pool;
    }

    async getProjects(req, res) {
        try {
            const userId = req.user.id;
            const result = await this.pool.query(
                `
                SELECT
                    p.project_id,
                    p.name,
                    p.description,
                    p.status,
                    p.owner_id,
                    p.created_at,
                    COUNT(DISTINCT pm.user_id)::int AS members_count,
                    COUNT(DISTINCT e.experiment_id)::int AS experiments_count,
                    COUNT(DISTINCT e.experiment_id) FILTER (WHERE e.status = 'running')::int AS active_experiments_count
                FROM projects p
                INNER JOIN project_members my_membership
                    ON my_membership.project_id = p.project_id
                    AND my_membership.user_id = $1
                LEFT JOIN project_members pm
                    ON pm.project_id = p.project_id
                LEFT JOIN experiments e
                    ON e.project_id = p.project_id
                WHERE p.status <> 'archived'
                GROUP BY p.project_id
                ORDER BY p.created_at DESC
                `,
                [userId]
            );

            return res.json({
                success: true,
                projects: result.rows
            });
        } catch (error) {
            console.error('Ошибка получения проектов:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    async createProject(req, res) {
        const client = await this.pool.connect();
        try {
            const userId = req.user.id;
            const name = String(req.body?.name || '').trim();
            const description = String(req.body?.description || '').trim() || null;

            if (!name) {
                return res.status(400).json({ error: 'Введите название проекта' });
            }

            await client.query('BEGIN');

            const created = await client.query(
                `
                INSERT INTO projects (name, description, owner_id, status)
                VALUES ($1, $2, $3, 'active')
                RETURNING project_id, name, description, status, owner_id, created_at
                `,
                [name, description, userId]
            );

            const project = created.rows[0];

            await client.query(
                `
                INSERT INTO project_members (project_id, user_id, role)
                VALUES ($1, $2, 'owner')
                ON CONFLICT (project_id, user_id) DO NOTHING
                `,
                [project.project_id, userId]
            );

            await client.query('COMMIT');
            return res.status(201).json({
                success: true,
                project: {
                    ...project,
                    members_count: 1,
                    experiments_count: 0,
                    active_experiments_count: 0
                }
            });
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Ошибка создания проекта:', error);
            return res.status(500).json({ error: error.message });
        } finally {
            client.release();
        }
    }

    async getMembers(req, res) {
        try {
            const userId = req.user.id;
            const projectId = Number(req.params.projectId);
            if (!Number.isInteger(projectId) || projectId <= 0) {
                return res.status(400).json({ error: 'Некорректный projectId' });
            }

            const hasAccess = await this.pool.query(
                `
                SELECT 1
                FROM project_members
                WHERE project_id = $1 AND user_id = $2
                LIMIT 1
                `,
                [projectId, userId]
            );
            if (hasAccess.rows.length === 0) {
                return res.status(403).json({ error: 'Нет доступа к проекту' });
            }

            const result = await this.pool.query(
                `
                SELECT
                    pm.user_id,
                    pm.role,
                    pm.joined_at,
                    u.username,
                    u.first_name,
                    u.last_name
                FROM project_members pm
                INNER JOIN users u ON u.id = pm.user_id
                WHERE pm.project_id = $1
                ORDER BY
                    CASE WHEN pm.role = 'owner' THEN 0 ELSE 1 END,
                    pm.joined_at ASC
                `,
                [projectId]
            );

            return res.json({
                success: true,
                members: result.rows
            });
        } catch (error) {
            console.error('Ошибка получения участников проекта:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    async addMember(req, res) {
        try {
            const userId = req.user.id;
            const projectId = Number(req.params.projectId);
            const username = String(req.body?.username || '').trim().toLowerCase();

            if (!Number.isInteger(projectId) || projectId <= 0) {
                return res.status(400).json({ error: 'Некорректный projectId' });
            }
            if (!username) {
                return res.status(400).json({ error: 'Укажите username участника' });
            }

            const actorRoleRes = await this.pool.query(
                `
                SELECT role
                FROM project_members
                WHERE project_id = $1 AND user_id = $2
                LIMIT 1
                `,
                [projectId, userId]
            );
            if (actorRoleRes.rows.length === 0) {
                return res.status(403).json({ error: 'Нет доступа к проекту' });
            }
            if (actorRoleRes.rows[0].role !== 'owner') {
                return res.status(403).json({ error: 'Только владелец может добавлять участников' });
            }

            const targetUserRes = await this.pool.query(
                `
                SELECT id, username, first_name, last_name
                FROM users
                WHERE LOWER(username) = LOWER($1)
                LIMIT 1
                `,
                [username]
            );
            if (targetUserRes.rows.length === 0) {
                return res.status(404).json({ error: 'Пользователь с таким логином не найден' });
            }
            const targetUser = targetUserRes.rows[0];

            const inserted = await this.pool.query(
                `
                INSERT INTO project_members (project_id, user_id, role)
                VALUES ($1, $2, 'member')
                ON CONFLICT (project_id, user_id) DO NOTHING
                RETURNING project_id, user_id, role, joined_at
                `,
                [projectId, targetUser.id]
            );

            if (inserted.rows.length === 0) {
                return res.status(409).json({ error: 'Этот участник уже добавлен в проект' });
            }

            return res.status(201).json({
                success: true,
                member: {
                    ...inserted.rows[0],
                    username: targetUser.username,
                    first_name: targetUser.first_name,
                    last_name: targetUser.last_name
                }
            });
        } catch (error) {
            console.error('Ошибка добавления участника:', error);
            return res.status(500).json({ error: error.message });
        }
    }
}

module.exports = ProjectsController;
