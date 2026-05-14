const state = {
    projectId: null,
    experimentId: null,
    experimentLink: '',
    experimentStatus: 'draft',
    experiments: [],
    summary: {
        totals: { users: 0, sessions: 0, events: 0, avg_duration_sec: 0, test_duration_sec: 0 },
        by_group: {
            A: { users: 0, sessions: 0, events: 0, avg_duration_sec: 0 },
            B: { users: 0, sessions: 0, events: 0, avg_duration_sec: 0 }
        }
    },
    metricsRows: [],
    scrollFunnel: {
        steps: [25, 50, 75, 90, 100],
        groups: { A: [0, 0, 0, 0, 0], B: [0, 0, 0, 0, 0] }
    },
    devices: [],
    formFunnel: {
        focus: { total: 0, A: 0, B: 0 },
        input: { total: 0, A: 0, B: 0 },
        submit: { total: 0, A: 0, B: 0 }
    }
};

let chartMain;
let chartScroll;
let chartDevices;
let newExperimentModal;
let experimentInfoPopover;

function getExperimentsBasePath() {
    if (!state.projectId) {
        return null;
    }
    return `/api/projects/${state.projectId}/experiments`;
}

function formatNumber(value) {
    return Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function formatDurationCompact(totalSeconds) {
    const seconds = Math.max(0, Math.floor(Number(totalSeconds || 0)));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h${minutes}m`;
}

function getDiffPct(a, b) {
    if (!a) return 0;
    return ((b - a) / a) * 100;
}

function mapStatus(status) {
    const s = (status || '').toLowerCase();
    if (s === 'running') return 'Активный';
    if (s === 'completed') return 'Завершен';
    if (s === 'paused') return 'На паузе';
    if (s === 'archived') return 'Архив';
    return 'Черновик';
}

function getStatusBadgeClass(status) {
    const s = (status || '').toLowerCase();
    if (s === 'running') return 'status-active';
    if (s === 'paused') return 'status-paused';
    if (s === 'completed') return 'status-completed';
    if (s === 'archived') return 'status-archived';
    return 'status-draft';
}

function getStatusActions(status) {
    const s = (status || '').toLowerCase();
    if (s === 'running') return ['pause', 'complete', 'archive'];
    if (s === 'paused') return ['resume', 'complete', 'archive'];
    if (s === 'completed') return ['archive'];
    if (s === 'archived') return [];
    return ['start', 'archive'];
}

function getActionLabel(action) {
    if (action === 'start') return 'Запустить';
    if (action === 'pause') return 'На паузу';
    if (action === 'resume') return 'Возобновить';
    if (action === 'complete') return 'Завершить';
    if (action === 'archive') return 'Архивировать';
    return action;
}

function mapDeviceLabel(device) {
    const key = String(device || '').toLowerCase();
    if (key.includes('mobile') || key.includes('phone')) return 'Телефоны';
    if (key.includes('tablet')) return 'Планшеты';
    if (key.includes('desktop') || key.includes('laptop')) return 'Ноутбуки';
    return device || 'Не указано';
}

function formatCi(ciLower, ciUpper) {
    if (ciLower === null || ciUpper === null || ciLower === undefined || ciUpper === undefined) {
        return '—';
    }
    return `[${Number(ciLower).toFixed(2)}; ${Number(ciUpper).toFixed(2)}]`;
}

function safeJsonParse(response) {
    return response.json().catch(() => ({}));
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function updateExperimentInfoPopover(experiment) {
    const infoBtn = document.getElementById('experimentInfoBtn');
    if (!infoBtn) return;

    const hypothesis = String(experiment?.hypothesis || '').trim();
    const description = String(experiment?.description || '').trim();
    const hasInfo = Boolean(hypothesis || description);

    if (!hasInfo) {
        infoBtn.classList.add('d-none');
        if (experimentInfoPopover) {
            experimentInfoPopover.dispose();
            experimentInfoPopover = null;
        }
        return;
    }

    const lines = [];
    if (hypothesis) {
        lines.push(`<div><strong>Гипотеза:</strong><br>${escapeHtml(hypothesis)}</div>`);
    }
    if (description) {
        lines.push(`<div class="mt-2"><strong>Описание:</strong><br>${escapeHtml(description)}</div>`);
    }

    infoBtn.classList.remove('d-none');
    infoBtn.setAttribute('data-bs-html', 'true');
    infoBtn.setAttribute('data-bs-title', 'Детали эксперимента');
    infoBtn.setAttribute('data-bs-content', lines.join(''));

    if (experimentInfoPopover) {
        experimentInfoPopover.dispose();
    }
    experimentInfoPopover = new bootstrap.Popover(infoBtn, {
        trigger: 'click',
        html: true,
        placement: 'bottom',
        container: 'body'
    });
}

function renderExperimentsList() {
    const container = document.getElementById('experimentsList');
    container.innerHTML = '';

    const list = state.experiments.length ? state.experiments : [];

    list.forEach((exp, index) => {
        const btn = document.createElement('button');
        btn.className = `experiment-item ${exp.experiment_id === state.experimentId ? 'active' : ''}`;
        btn.innerHTML = `
            <div class="experiment-name">● ${exp.name || `Тест #${index + 1}`}</div>
            <div class="experiment-note">${exp.hypothesis || mapStatus(exp.status) || 'Описание эксперимента'}</div>
        `;
        btn.addEventListener('click', async () => {
            state.experimentId = exp.experiment_id;
            await hydrateFromApi(exp.experiment_id);
            renderAll();
        });
        container.appendChild(btn);
    });
}

function renderSummary() {
    const { totals, by_group } = state.summary;
    document.getElementById('kpiUsers').textContent = formatNumber(totals.users || 0);
    document.getElementById('kpiSessions').textContent = formatNumber(totals.sessions || 0);
    document.getElementById('kpiEvents').textContent = formatNumber(totals.events || 0);
    document.getElementById('kpiDuration').textContent = formatDurationCompact(totals.test_duration_sec || 0);

    document.getElementById('kpiUsersAB').textContent = `A: ${formatNumber(by_group.A?.users || 0)}  B: ${formatNumber(by_group.B?.users || 0)}`;
    document.getElementById('kpiSessionsAB').textContent = `A: ${formatNumber(by_group.A?.sessions || 0)}  B: ${formatNumber(by_group.B?.sessions || 0)}`;
    document.getElementById('kpiEventsAB').textContent = `A: ${formatNumber(by_group.A?.events || 0)}  B: ${formatNumber(by_group.B?.events || 0)}`;
}

function renderMetricsTable() {
    const tbody = document.getElementById('metricsTableBody');
    tbody.innerHTML = '';

    state.metricsRows.forEach((row) => {
        const diff = getDiffPct(row.value_a, row.value_b);
        const hasP = row.p_value !== null && row.p_value !== undefined;
        const isSignificant = hasP && row.p_value < 0.05;
        const significanceText = !hasP ? '—' : (isSignificant ? 'Значимо' : 'Не значимо');
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.metric_name}</td>
            <td>${formatNumber(row.value_a)}</td>
            <td>${formatNumber(row.value_b)}</td>
            <td>${diff.toFixed(0)}%</td>
            <td>${hasP ? row.p_value.toFixed(3) : '—'}</td>
            <td class="${isSignificant ? 'metric-significant' : 'metric-not-significant'}">${significanceText}</td>
            <td>${row.power !== null && row.power !== undefined ? row.power.toFixed(2) : '—'}</td>
            <td>${row.ci || '—'}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderDevicesTable() {
    const tbody = document.getElementById('devicesTableBody');
    tbody.innerHTML = '';
    state.devices.forEach((row) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${row.device}</td><td>${formatNumber(row.sessions)}</td>`;
        tbody.appendChild(tr);
    });
}

function renderFormCards() {
    document.getElementById('focusValue').textContent = state.formFunnel.focus.total;
    document.getElementById('focusAB').textContent = `A: ${state.formFunnel.focus.A}  B: ${state.formFunnel.focus.B}`;
    document.getElementById('inputValue').textContent = state.formFunnel.input.total;
    document.getElementById('inputAB').textContent = `A: ${state.formFunnel.input.A}  B: ${state.formFunnel.input.B}`;
    document.getElementById('submitValue').textContent = state.formFunnel.submit.total;
    document.getElementById('submitAB').textContent = `A: ${state.formFunnel.submit.A}  B: ${state.formFunnel.submit.B}`;
}

function renderMainChart() {
    const labels = state.metricsRows.slice(0, 4).map((m) => m.metric_name);
    const aValues = state.metricsRows.slice(0, 4).map((m) => m.value_a);
    const bValues = state.metricsRows.slice(0, 4).map((m) => m.value_b);

    if (chartMain) chartMain.destroy();
    chartMain = new Chart(document.getElementById('mainMetricsChart'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'A', data: aValues, backgroundColor: '#6069f1' },
                { label: 'B', data: bValues, backgroundColor: '#9ecce8' }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', align: 'start' } },
            scales: { y: { beginAtZero: true, grid: { color: '#edf1f7' } } }
        }
    });
}

function renderScrollChart() {
    const labels = (state.scrollFunnel.steps || []).map((step) => `${step}%`);
    const aValues = state.scrollFunnel.groups?.A || [];
    const bValues = state.scrollFunnel.groups?.B || [];

    if (chartScroll) chartScroll.destroy();
    chartScroll = new Chart(document.getElementById('scrollFunnelChart'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'A', data: aValues, backgroundColor: '#6069f1' },
                { label: 'B', data: bValues, backgroundColor: '#9ecce8' }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', align: 'start' } },
            scales: { y: { beginAtZero: true, grid: { color: '#edf1f7' } } }
        }
    });
}

function renderDevicesChart() {
    if (chartDevices) chartDevices.destroy();
    const labels = state.devices.map((d) => d.device);
    const values = state.devices.map((d) => d.sessions);
    chartDevices = new Chart(document.getElementById('devicesChart'), {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: ['#d8d9de', '#9ecce8', '#3f80f6'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 1,
            cutout: '70%',
            plugins: {
                legend: {
                    position: 'bottom',
                    align: 'start',
                    labels: {
                        boxWidth: 18,
                        boxHeight: 18,
                        padding: 14,
                        color: '#5c687d',
                        font: { size: 15, family: 'Roboto' }
                    }
                }
            }
        }
    });
}

function renderHeaderMeta(experiment) {
    const nameEl = document.getElementById('experimentName');
    const periodEl = document.getElementById('experimentPeriod');
    const linkInput = document.getElementById('experimentLinkInput');
    const statusNode = document.getElementById('experimentStatus');

    if (!experiment) {
        state.experimentId = null;
        state.experimentStatus = 'draft';
        state.experimentLink = '';
        nameEl.textContent = '—';
        periodEl.textContent = '—';
        linkInput.value = '';
        statusNode.textContent = '—';
        statusNode.className = 'status-badge status-placeholder';
        updateExperimentInfoPopover(null);
        renderStatusActions();
        return;
    }

    nameEl.textContent = experiment.name || 'Эксперимент';
    updateExperimentInfoPopover(experiment);
    state.experimentId = experiment.experiment_id;
    state.experimentStatus = (experiment.status || 'draft').toLowerCase();
    statusNode.textContent = mapStatus(state.experimentStatus);
    statusNode.className = `status-badge ${getStatusBadgeClass(state.experimentStatus)}`;
    const from = experiment.started_at ? new Date(experiment.started_at).toLocaleDateString('ru-RU') : '—';
    const to = experiment.completed_at ? new Date(experiment.completed_at).toLocaleDateString('ru-RU') : '…';
    periodEl.textContent = `${from} - ${to}`;
    state.experimentLink = experiment.link || `${window.location.origin}/exp/${experiment.experiment_id}`;
    linkInput.value = state.experimentLink;
    renderStatusActions();
}

function renderStatusActions() {
    const menu = document.getElementById('statusActionsMenu');
    menu.innerHTML = '';

    if (!state.experimentId) {
        const li = document.createElement('li');
        li.innerHTML = '<span class="dropdown-item-text text-muted px-3 py-2 d-block small">Выберите эксперимент в списке слева или создайте новый.</span>';
        menu.appendChild(li);
        return;
    }

    const actions = getStatusActions(state.experimentStatus);

    if (!actions.length) {
        const li = document.createElement('li');
        li.innerHTML = '<span class="dropdown-item-text text-muted">Нет доступных действий</span>';
        menu.appendChild(li);
        return;
    }

    actions.forEach((action) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dropdown-item';
        btn.dataset.statusAction = action;
        btn.textContent = getActionLabel(action);
        li.appendChild(btn);
        menu.appendChild(li);
    });
}

async function loadExperiments(preferredId = null) {
    if (!state.projectId) {
        state.experiments = [];
        state.experimentId = null;
        window.__dashboardExperimentCount = 0;
        window.__dashboardActiveExperimentCount = 0;
        renderHeaderMeta(null);
        return null;
    }

    const base = getExperimentsBasePath();
    if (!base) {
        renderHeaderMeta(null);
        return null;
    }
    const response = await fetch(base, { credentials: 'include' });
    if (!response.ok) {
        renderHeaderMeta(null);
        return null;
    }
    const experiments = await response.json();
    if (!Array.isArray(experiments) || experiments.length === 0) {
        window.__dashboardExperimentCount = 0;
        window.__dashboardActiveExperimentCount = 0;
        renderHeaderMeta(null);
        return null;
    }

    state.experiments = experiments;
    window.__dashboardExperimentCount = experiments.length;
    window.__dashboardActiveExperimentCount = experiments.filter((exp) => String(exp.status || '').toLowerCase() === 'running').length;

    let selected = experiments[0];
    if (preferredId) {
        const found = experiments.find((exp) => exp.experiment_id === preferredId);
        if (found) selected = found;
    }

    state.experimentId = selected.experiment_id;
    renderHeaderMeta(selected);
    return selected.experiment_id;
}

async function hydrateFromApi(experimentId) {
    try {
        const base = getExperimentsBasePath();
        if (!base) return;
        const basePath = `${base}/${experimentId}`;
        const fetchOpts = { credentials: 'include' };
        const [expRes, metricsRes, summaryRes, statsRes, scrollRes, devicesRes, formRes] = await Promise.all([
            fetch(`${basePath}`, fetchOpts),
            fetch(`${basePath}/metrics`, fetchOpts),
            fetch(`${basePath}/summary`, fetchOpts),
            fetch(`${basePath}/statistics`, fetchOpts),
            fetch(`${basePath}/scroll-funnel`, fetchOpts),
            fetch(`${basePath}/devices`, fetchOpts),
            fetch(`${basePath}/form-funnel`, fetchOpts)
        ]);

        if (expRes.ok) {
            const experiment = await expRes.json();
            renderHeaderMeta(experiment);
        }

        const statsByMetric = {};
        if (statsRes.ok) {
            const statisticsPayload = await safeJsonParse(statsRes);
            const statistics = Array.isArray(statisticsPayload.statistics) ? statisticsPayload.statistics : [];
            statistics.forEach((stat) => {
                statsByMetric[Number(stat.metric_id)] = stat;
            });
        }

        if (metricsRes.ok) {
            const metricsPayload = await metricsRes.json();
            if (Array.isArray(metricsPayload.metrics) && metricsPayload.metrics.length > 0) {
                state.metricsRows = metricsPayload.metrics.map((metric) => {
                    const valA = metric.values?.A ?? 0;
                    const valB = metric.values?.B ?? 0;
                    const stat = statsByMetric[Number(metric.id)];
                    return {
                        metric_id: metric.id,
                        metric_name: metric.name,
                        value_a: valA,
                        value_b: valB,
                        p_value: stat?.p_value ?? null,
                        power: stat?.power ?? null,
                        ci: formatCi(stat?.ci_lower, stat?.ci_upper)
                    };
                });
            } else {
                state.metricsRows = [];
            }
        }

        if (summaryRes.ok) {
            const summaryPayload = await safeJsonParse(summaryRes);
            if (summaryPayload && summaryPayload.totals && summaryPayload.by_group) {
                state.summary = summaryPayload;
            }
        }

        if (scrollRes.ok) {
            const scrollPayload = await safeJsonParse(scrollRes);
            if (scrollPayload && Array.isArray(scrollPayload.steps) && scrollPayload.groups) {
                state.scrollFunnel = {
                    steps: scrollPayload.steps,
                    groups: {
                        A: Array.isArray(scrollPayload.groups.A) ? scrollPayload.groups.A : scrollPayload.steps.map(() => 0),
                        B: Array.isArray(scrollPayload.groups.B) ? scrollPayload.groups.B : scrollPayload.steps.map(() => 0)
                    }
                };
            }
        }

        if (devicesRes.ok) {
            const devicesPayload = await safeJsonParse(devicesRes);
            const distribution = Array.isArray(devicesPayload.distribution) ? devicesPayload.distribution : [];
            state.devices = distribution.map((item) => ({
                device: mapDeviceLabel(item.device_category),
                sessions: Number(item.sessions || 0)
            }));
        }

        if (formRes.ok) {
            const formPayload = await safeJsonParse(formRes);
            const stages = Array.isArray(formPayload.stages) ? formPayload.stages : [];
            const getStage = (key) => stages.find((stage) => stage.key === key) || { total: 0, by_group: {} };
            const focus = getStage('form_focus');
            const input = getStage('form_input');
            const submit = getStage('form_submit');
            state.formFunnel = {
                focus: { total: Number(focus.total || 0), A: Number(focus.by_group?.A || 0), B: Number(focus.by_group?.B || 0) },
                input: { total: Number(input.total || 0), A: Number(input.by_group?.A || 0), B: Number(input.by_group?.B || 0) },
                submit: { total: Number(submit.total || 0), A: Number(submit.by_group?.A || 0), B: Number(submit.by_group?.B || 0) }
            };
        }
    } catch (error) {
        console.warn('Не удалось обновить данные эксперимента:', error.message);
    }
}

async function initExperiments() {
    if (!state.projectId) {
        return;
    }
    try {
        const selectedId = await loadExperiments();
        if (selectedId) {
            await hydrateFromApi(selectedId);
        }
    } catch (error) {
        console.warn('Не удалось загрузить список экспериментов:', error.message);
    }
}

function renderAll() {
    renderExperimentsList();
    renderSummary();
    renderMetricsTable();
    renderDevicesTable();
    renderFormCards();
    renderMainChart();
    renderScrollChart();
    renderDevicesChart();
}

async function copyExperimentLink() {
    const input = document.getElementById('experimentLinkInput');
    const copyButton = document.getElementById('copyLinkBtn');
    const link = input.value;
    try {
        await navigator.clipboard.writeText(link);
        const prev = copyButton.textContent;
        copyButton.textContent = 'Скопировано';
        setTimeout(() => {
            copyButton.textContent = prev;
        }, 1200);
    } catch {
        input.select();
        document.execCommand('copy');
    }
}

function showModalError(message) {
    const errorNode = document.getElementById('newExperimentError');
    errorNode.textContent = message;
    errorNode.classList.remove('d-none');
}

function clearModalError() {
    const errorNode = document.getElementById('newExperimentError');
    errorNode.textContent = '';
    errorNode.classList.add('d-none');
}

async function handleCreateExperiment(event) {
    event.preventDefault();
    clearModalError();

    const form = event.currentTarget;
    const saveButton = document.getElementById('saveExperimentBtn');

    const formData = new FormData(form);
    const name = String(formData.get('name') || '').trim();
    const hypothesis = String(formData.get('hypothesis') || '').trim();
    const description = String(formData.get('description') || '').trim();
    const variantA = formData.get('variant_a');
    const variantB = formData.get('variant_b');

    if (!name || !hypothesis) {
        showModalError('Заполните обязательные поля: название и гипотеза.');
        return;
    }

    if (!(variantA instanceof File) || !(variantB instanceof File) || !variantA.name || !variantB.name) {
        showModalError('Загрузите оба файла вариантов: A и B.');
        return;
    }

    if (variantA.name !== 'variant_A.html' || variantB.name !== 'variant_B.html') {
        showModalError('Названия файлов должны быть строго variant_A.html и variant_B.html.');
        return;
    }

    saveButton.disabled = true;
    const initialLabel = saveButton.textContent;
    saveButton.textContent = 'Сохранение...';

    const base = getExperimentsBasePath();
    if (!base) {
        showModalError('Сначала откройте проект в списке слева.');
        return;
    }

    try {
        const response = await fetch(base, {
            method: 'POST',
            credentials: 'include',
            body: formData
        });

        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.error || 'Не удалось создать эксперимент');
        }

        const createdId = Number(payload.experiment_id);
        form.reset();
        newExperimentModal.hide();

        const selectedId = await loadExperiments(createdId);
        if (selectedId) {
            await hydrateFromApi(selectedId);
        }
        renderAll();
    } catch (error) {
        showModalError(error.message);
    } finally {
        saveButton.disabled = false;
        saveButton.textContent = initialLabel;
    }
}

function getCalculateMetricsUrl() {
    if (!state.experimentId) return null;
    const base = getExperimentsBasePath();
    if (!base) return null;
    return `${base}/${state.experimentId}/calculate`;
}

async function refreshMetricsAndStatistics() {
    const url = getCalculateMetricsUrl();
    if (!url) return;

    const btn = document.getElementById('refreshMetricsBtn');
    const prev = btn?.textContent;
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Считаем…';
    }
    try {
        const response = await fetch(url, {
            method: 'POST',
            credentials: 'include'
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || 'Не удалось пересчитать метрики');
        }
        await hydrateFromApi(state.experimentId);
        renderAll();
    } catch (error) {
        alert(error.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = prev || 'Обновить метрики';
        }
    }
}

async function handleStatusAction(action) {
    if (!state.experimentId) return;
    if (!getExperimentsBasePath()) return;

    const routeMap = {
        start: 'start',
        pause: 'pause',
        resume: 'resume',
        complete: 'complete',
        archive: 'archive'
    };
    const route = routeMap[action];
    if (!route) return;

    try {
        const response = await fetch(`${getExperimentsBasePath()}/${state.experimentId}/${route}`, {
            method: 'POST',
            credentials: 'include'
        });
        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.error || 'Не удалось сменить статус');
        }

        const selectedId = await loadExperiments(state.experimentId);
        if (selectedId) {
            await hydrateFromApi(selectedId);
        }
        renderAll();
    } catch (error) {
        alert(error.message);
    }
}

async function openProjectDashboard(projectId) {
    state.projectId = Number(projectId) || null;
    state.experimentId = null;
    state.experiments = [];
    renderHeaderMeta(null);
    state.metricsRows = [];
    state.devices = [];
    state.formFunnel = {
        focus: { total: 0, A: 0, B: 0 },
        input: { total: 0, A: 0, B: 0 },
        submit: { total: 0, A: 0, B: 0 }
    };
    state.summary = {
        totals: { users: 0, sessions: 0, events: 0, avg_duration_sec: 0, test_duration_sec: 0 },
        by_group: {
            A: { users: 0, sessions: 0, events: 0, avg_duration_sec: 0 },
            B: { users: 0, sessions: 0, events: 0, avg_duration_sec: 0 }
        }
    };
    state.scrollFunnel = {
        steps: [25, 50, 75, 90, 100],
        groups: { A: [0, 0, 0, 0, 0], B: [0, 0, 0, 0, 0] }
    };

    const selectedId = await loadExperiments();
    if (selectedId) {
        await hydrateFromApi(selectedId);
    }
    renderAll();
}

window.dashboardApi = {
    openProjectDashboard
};

document.addEventListener('DOMContentLoaded', async () => {
    renderHeaderMeta(null);
    renderAll();
    document.getElementById('copyLinkBtn').addEventListener('click', copyExperimentLink);
    const refreshBtn = document.getElementById('refreshMetricsBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => refreshMetricsAndStatistics());
    }

    const modalNode = document.getElementById('newExperimentModal');
    newExperimentModal = new bootstrap.Modal(modalNode, {
        backdrop: true,
        keyboard: true
    });

    document.getElementById('newExperimentBtn').addEventListener('click', () => {
        clearModalError();
        newExperimentModal.show();
        setTimeout(() => {
            document.getElementById('newExperimentName').focus();
        }, 120);
    });

    document.getElementById('newExperimentForm').addEventListener('submit', handleCreateExperiment);
    document.getElementById('statusActionsMenu').addEventListener('click', async (event) => {
        const button = event.target.closest('[data-status-action]');
        if (!button) return;
        await handleStatusAction(button.dataset.statusAction);
    });
    modalNode.addEventListener('hidden.bs.modal', () => {
        clearModalError();
    });
});
