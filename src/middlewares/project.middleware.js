function createRequireProjectMember(pool) {
    return async function requireProjectMember(req, res, next) {
        try {
            const projectId = Number(req.params.projectId);
            if (!Number.isInteger(projectId) || projectId <= 0) {
                return res.status(400).json({ error: 'Некорректный projectId' });
            }

            const result = await pool.query(
                `
                SELECT role
                FROM project_members
                WHERE project_id = $1 AND user_id = $2
                LIMIT 1
                `,
                [projectId, req.user.id]
            );

            if (result.rows.length === 0) {
                return res.status(403).json({ error: 'Нет доступа к проекту' });
            }

            req.projectId = projectId;
            req.projectRole = result.rows[0].role;
            return next();
        } catch (error) {
            console.error('Ошибка project middleware:', error);
            return res.status(500).json({ error: error.message });
        }
    };
}

module.exports = {
    createRequireProjectMember
};
