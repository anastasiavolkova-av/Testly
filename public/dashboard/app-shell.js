const appState = {
    user: null,
    currentProjectId: null,
    projects: [],
    members: []
};

let createProjectModal;
let membersModal;
let recoveryCodeModal;

function getEl(id) {
    return document.getElementById(id);
}

function showAuthError(nodeId, message) {
    const node = getEl(nodeId);
    if (!node) return;
    node.textContent = message;
    node.classList.remove('d-none');
}

function clearAuthError(nodeId) {
    const node = getEl(nodeId);
    if (!node) return;
    node.textContent = '';
    node.classList.add('d-none');
}

function toDisplayName(user) {
    const name = `${user.first_name || ''} ${user.last_name || ''}`.trim();
    return name || user.username || 'Пользователь';
}

async function apiRequest(url, options = {}) {
    try {
        const response = await fetch(url, {
            credentials: 'include',
            ...options
        });
        const payload = await response.json().catch(() => ({}));
        return {
            ok: response.ok,
            status: response.status,
            payload
        };
    } catch (error) {
        return {
            ok: false,
            status: 0,
            payload: { error: error.message || 'Сеть недоступна' }
        };
    }
}

function switchAuthCard(cardId) {
    const cardIds = ['loginCard', 'registerCard', 'resetCard'];
    cardIds.forEach((id) => getEl(id).classList.toggle('d-none', id !== cardId));
    clearAuthError('loginError');
    clearAuthError('registerError');
    clearAuthError('resetError');
}

function switchView(viewId) {
    const views = ['authView', 'projectsView', 'dashboardView'];
    views.forEach((id) => getEl(id).classList.toggle('d-none', id !== viewId));
}

function updateWelcome() {
    getEl('projectsUserName').textContent = appState.user ? appState.user.first_name : 'Пользователь';
}

async function openMembersModalForProject(projectId) {
    const id = Number(projectId);
    if (!id) return;
    appState.currentProjectId = id;
    await loadProjects();
    clearAuthError('inviteMemberError');
    getEl('inviteMemberForm').reset();
    const membersRes = await loadProjectMembers(id);
    if (!membersRes.ok) {
        showAuthError('inviteMemberError', membersRes.payload?.error || 'Не удалось загрузить участников');
    }
    renderProjectMembers();
    membersModal.show();
}

async function openDashboardForProject(project) {
    appState.currentProjectId = Number(project.project_id);
    await loadProjects();
    getEl('sidebarProjectName').textContent = `Проект ${project.name}`;
    switchView('dashboardView');
    if (window.dashboardApi?.openProjectDashboard) {
        window.dashboardApi.openProjectDashboard(appState.currentProjectId);
    }
}

function getCurrentProject() {
    return appState.projects.find((project) => Number(project.project_id) === Number(appState.currentProjectId)) || null;
}

async function loadProjects() {
    const response = await apiRequest('/api/projects');
    if (!response.ok) {
        appState.projects = [];
        return;
    }
    appState.projects = Array.isArray(response.payload?.projects) ? response.payload.projects : [];
}

function renderProjects() {
    const grid = getEl('projectsGrid');
    grid.innerHTML = '';

    const projects = appState.projects.slice().sort((a, b) => Number(b.project_id) - Number(a.project_id));

    projects.forEach((project) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = `project-card ${project.project_id === appState.currentProjectId ? 'active' : ''}`;
        card.innerHTML = `
            <div class="project-card-title">Проект<br>"${project.name}"</div>
            <div class="project-card-meta">
                <div>Участников: ${Number(project.members_count || 0)}</div>
                <div>Активных тестов: ${Number(project.active_experiments_count || 0)}</div>
                <div>Всего тестов: ${Number(project.experiments_count || 0)}</div>
            </div>
        `;
        const gearBtn = document.createElement('button');
        gearBtn.type = 'button';
        gearBtn.className = 'project-card-gear-btn';
        gearBtn.title = 'Участники и доступ к проекту';
        gearBtn.setAttribute('aria-label', 'Участники проекта');
        gearBtn.innerHTML = '<i class="bi bi-gear" aria-hidden="true"></i>';
        gearBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            event.preventDefault();
            void openMembersModalForProject(project.project_id);
        });
        card.appendChild(gearBtn);
        card.addEventListener('click', (event) => {
            if (event.target.closest('.project-card-gear-btn')) return;
            void openDashboardForProject(project);
        });
        grid.appendChild(card);
    });

    const createCard = document.createElement('button');
    createCard.type = 'button';
    createCard.className = 'project-card project-card-create';
    createCard.innerHTML = '+';
    createCard.title = 'Создать проект';
    createCard.addEventListener('click', () => {
        clearAuthError('createProjectError');
        getEl('createProjectForm').reset();
        createProjectModal.show();
    });
    grid.appendChild(createCard);
}

function renderProjectMembers() {
    const list = getEl('membersList');
    list.innerHTML = '';

    const members = appState.members || [];
    members.forEach((row) => {
        const item = document.createElement('div');
        item.className = 'member-row';
        item.innerHTML = `
            <span>${toDisplayName(row)}</span>
            <span class="member-role">${row.role === 'owner' ? 'Владелец' : 'Участник'}</span>
        `;
        list.appendChild(item);
    });

    const currentMember = members.find((member) => Number(member.user_id) === Number(appState.user?.id));
    const isOwner = currentMember?.role === 'owner';
    getEl('inviteMemberForm').classList.toggle('d-none', !isOwner);
}

async function loadProjectMembers(projectId) {
    const response = await apiRequest(`/api/projects/${projectId}/members`);
    if (!response.ok) {
        appState.members = [];
        return response;
    }
    appState.members = Array.isArray(response.payload?.members) ? response.payload.members : [];
    return response;
}

async function logout() {
    await apiRequest('/api/auth/logout', { method: 'POST' });
    appState.user = null;
    appState.currentProjectId = null;
    appState.projects = [];
    appState.members = [];
    switchView('authView');
    switchAuthCard('loginCard');
}

/** Выйти из экрана дашборда к списку проектов (сессия сохраняется). */
async function exitDashboardToProjects() {
    await loadProjects();
    switchView('projectsView');
    renderProjects();
}

function setupAuthHandlers() {
    getEl('goToRegisterBtn').addEventListener('click', () => switchAuthCard('registerCard'));
    getEl('goToLoginBtn').addEventListener('click', () => switchAuthCard('loginCard'));
    getEl('goToResetBtn').addEventListener('click', () => switchAuthCard('resetCard'));
    getEl('backToLoginBtn').addEventListener('click', () => switchAuthCard('loginCard'));

    getEl('loginForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        clearAuthError('loginError');
        const formData = new FormData(event.currentTarget);
        const username = String(formData.get('username') || '').trim().toLowerCase();
        const password = String(formData.get('password') || '');

        const loginRes = await apiRequest('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        if (!loginRes.ok || !loginRes.payload?.user) {
            showAuthError('loginError', loginRes.payload?.error || 'Неверный логин или пароль');
            return;
        }

        appState.user = loginRes.payload.user;
        updateWelcome();
        await loadProjects();
        switchView('projectsView');
        renderProjects();
    });

    getEl('registerForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        clearAuthError('registerError');
        const formData = new FormData(event.currentTarget);
        const firstName = String(formData.get('first_name') || '').trim();
        const lastName = String(formData.get('last_name') || '').trim();
        const username = String(formData.get('username') || '').trim().toLowerCase();
        const password = String(formData.get('password') || '');
        const confirmPassword = String(formData.get('confirm_password') || '');

        if (!firstName || !lastName || !username) {
            showAuthError('registerError', 'Заполните имя, фамилию и логин');
            return;
        }
        if (password.length < 8) {
            showAuthError('registerError', 'Пароль должен содержать минимум 8 символов');
            return;
        }
        if (password !== confirmPassword) {
            showAuthError('registerError', 'Пароли не совпадают');
            return;
        }

        const registerRes = await apiRequest('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                first_name: firstName,
                last_name: lastName,
                username,
                password
            })
        });

        if (!registerRes.ok || !registerRes.payload?.user) {
            showAuthError('registerError', registerRes.payload?.error || 'Не удалось зарегистрироваться');
            return;
        }

        appState.user = registerRes.payload.user;
        updateWelcome();
        getEl('recoveryCodeValue').textContent = registerRes.payload.recovery_code || '—';
        recoveryCodeModal.show();
        await loadProjects();
        switchView('projectsView');
        renderProjects();
        event.currentTarget.reset();
    });

    getEl('resetForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        clearAuthError('resetError');

        const formData = new FormData(event.currentTarget);
        const username = String(formData.get('username') || '').trim().toLowerCase();
        const recoveryCode = String(formData.get('recovery_code') || '').trim().toUpperCase();
        const newPassword = String(formData.get('new_password') || '');
        const confirmPassword = String(formData.get('confirm_password') || '');

        if (newPassword.length < 8) {
            showAuthError('resetError', 'Новый пароль должен содержать минимум 8 символов');
            return;
        }
        if (newPassword !== confirmPassword) {
            showAuthError('resetError', 'Пароли не совпадают');
            return;
        }

        const resetRes = await apiRequest('/api/auth/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username,
                recovery_code: recoveryCode,
                new_password: newPassword
            })
        });
        if (!resetRes.ok) {
            showAuthError('resetError', resetRes.payload?.error || 'Не удалось сбросить пароль');
            return;
        }

        getEl('recoveryCodeValue').textContent = resetRes.payload?.recovery_code || '—';
        recoveryCodeModal.show();
        event.currentTarget.reset();
        switchAuthCard('loginCard');
    });
}

function setupProjectHandlers() {
    getEl('projectsLogoutBtn').addEventListener('click', logout);
    getEl('dashboardLogoutBtn').addEventListener('click', () => {
        void exitDashboardToProjects();
    });
    getEl('sidebarProjectName').addEventListener('click', async () => {
        await loadProjects();
        switchView('projectsView');
        renderProjects();
    });

    getEl('createProjectForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        clearAuthError('createProjectError');

        const formData = new FormData(event.currentTarget);
        const name = String(formData.get('name') || '').trim();
        const description = String(formData.get('description') || '').trim();
        if (!name) {
            showAuthError('createProjectError', 'Введите название проекта');
            return;
        }

        const response = await apiRequest('/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description })
        });
        if (!response.ok) {
            showAuthError('createProjectError', response.payload?.error || 'Не удалось создать проект');
            return;
        }

        createProjectModal.hide();
        await loadProjects();
        renderProjects();
    });

    getEl('projectMembersBtn').addEventListener('click', async () => {
        if (!appState.currentProjectId) return;
        await openMembersModalForProject(appState.currentProjectId);
    });

    getEl('inviteMemberForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        clearAuthError('inviteMemberError');
        const project = getCurrentProject();
        if (!project) return;

        const formData = new FormData(event.currentTarget);
        const username = String(formData.get('username') || '').trim().toLowerCase();
        if (!username) {
            showAuthError('inviteMemberError', 'Введите логин участника');
            return;
        }

        const response = await apiRequest(`/api/projects/${project.project_id}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        if (!response.ok) {
            showAuthError('inviteMemberError', response.payload?.error || 'Не удалось добавить участника');
            return;
        }

        const added = response.payload?.member;
        if (added && added.user_id) {
            const normalized = {
                user_id: added.user_id,
                role: added.role,
                joined_at: added.joined_at,
                username: added.username,
                first_name: added.first_name,
                last_name: added.last_name
            };
            const others = appState.members.filter((m) => Number(m.user_id) !== Number(normalized.user_id));
            appState.members = [...others, normalized];
            renderProjectMembers();
        }

        event.currentTarget.reset();
        await loadProjectMembers(project.project_id);
        await loadProjects();
        renderProjectMembers();
        renderProjects();
    });

    getEl('copyRecoveryCodeBtn').addEventListener('click', async () => {
        const code = getEl('recoveryCodeValue').textContent;
        const button = getEl('copyRecoveryCodeBtn');
        try {
            await navigator.clipboard.writeText(code);
            const prev = button.textContent;
            button.textContent = 'Скопировано';
            setTimeout(() => {
                button.textContent = prev;
            }, 1200);
        } catch {
            window.prompt('Скопируйте код вручную', code);
        }
    });
}

function bootstrapModals() {
    createProjectModal = new bootstrap.Modal(getEl('createProjectModal'));
    membersModal = new bootstrap.Modal(getEl('membersModal'));
    recoveryCodeModal = new bootstrap.Modal(getEl('recoveryCodeModal'));
}

async function restoreSession() {
    const meRes = await apiRequest('/api/auth/me');
    if (!meRes.ok || !meRes.payload?.user) {
        switchView('authView');
        switchAuthCard('loginCard');
        return;
    }

    appState.user = meRes.payload.user;
    updateWelcome();
    await loadProjects();
    switchView('projectsView');
    renderProjects();
}

document.addEventListener('DOMContentLoaded', async () => {
    bootstrapModals();
    setupAuthHandlers();
    setupProjectHandlers();
    await restoreSession();
});
