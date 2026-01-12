/**
 * ABTestTracker PRO – улучшенная версия для UX A/B тестов
 * Собирает полные данные: клики, скролл, формы (фокус+ввод+отправка) + ошибки
 */

class AbTestTracker {
    constructor() {
        this.config = {
            apiEndpoint: '/api/track',
            batchSize: 5,
            debug: true,
            trackFormInput: true,       // Отслеживать ввод текста
            inputDebounceDelay: 1000    // Задержка для отслеживания ввода
        };

        this.userId = this.getOrCreateUserId();
        this.sessionId = this.generateSessionId();
        this.abTestGroup = this.assignAbTestGroup();

        this.eventQueue = [];
        this.sessionStartTime = Date.now();
        this.scrollDepth = 0;
        
        // Для отслеживания ввода текста
        this.inputTimeout = null;
        this.lastInputValue = '';
        this.inputStartTime = null;

        this.init();
    }

    // ========== ИДЕНТИФИКАТОРЫ ==========
    getOrCreateUserId() {
        const key = 'ab_user_id';
        let id = localStorage.getItem(key);
        if (!id) {
            id = 'u_' + Math.random().toString(36).substr(2, 8);
            localStorage.setItem(key, id);
        }
        return id;
    }

    generateSessionId() {
        return 's_' + Date.now().toString(36);
    }

    assignAbTestGroup() {
    const getGroupFromCookie = () => {
        const match = document.cookie.match(/ab_group=([AB])/);
        return match ? match[1] : 'unknown';
    };
    
    const group = getGroupFromCookie();
    
    console.log('🎯 Группа из куки:', group);
    return group;
    }

    getDeviceInfo() {
        const ua = navigator.userAgent.toLowerCase();
        let deviceType = 'desktop';
        if (/mobile|iphone|ipod|android.*mobile/.test(ua)) deviceType = 'mobile';
        else if (/tablet|ipad|android(?!.*mobile)/.test(ua)) deviceType = 'tablet';
        
        let browser = 'other';
        if (/chrome/.test(ua)) browser = 'chrome';
        else if (/firefox/.test(ua)) browser = 'firefox';
        else if (/safari/.test(ua) && !/chrome/.test(ua)) browser = 'safari';
        else if (/edge|edg/.test(ua)) browser = 'edge';
        
        return {
            device_type: deviceType,
            browser: browser,
            screen_size: this.getScreenSizeCategory(),
            screen_width: window.innerWidth,
            screen_height: window.innerHeight
        };
    }

    getScreenSizeCategory() {
        const width = window.innerWidth;
        if (width < 576) return 'xs';
        if (width < 768) return 'sm';
        if (width < 992) return 'md';
        if (width < 1200) return 'lg';
        return 'xl';
    }

    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    init() {
        if (this.config.debug) {
            console.log('AB Tracker PRO:', {
                user: this.userId,
                session: this.sessionId,
                group: this.abTestGroup,
                device: this.getDeviceInfo()
            });
        }

        // Старт сессии
        this.trackEvent('session_start', {
            url: window.location.pathname,
            referrer: document.referrer || 'direct',
            device: this.getDeviceInfo(),
            group: this.abTestGroup
        });

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setupTracking());
        } else {
            this.setupTracking();
        }

        window.addEventListener('beforeunload', () => {
            this.trackEvent('session_end', {
                duration: Date.now() - this.sessionStartTime,
                scroll_max: this.scrollDepth,
                total_events: this.eventQueue.length + 1
            });
            this.flushQueue(true);
        });
    }

    setupTracking() {
        this.trackPageView();
        this.trackClicks();
        this.trackScroll();
        this.trackForms();
        this.trackErrors(); // Отслеживание ошибок
    }

    // ========== ОТСЛЕЖИВАНИЕ СОБЫТИЙ ==========
    trackPageView() {
        this.trackEvent('page_view', {
            title: document.title,
            url: window.location.pathname,
            full_url: window.location.href
        });
    }

    trackClicks() {
        document.addEventListener('click', (e) => {
            const target = e.target;
            if (!this.isClickMeaningful(target)) return;
            
            this.trackEvent('click', {
                element: this.getElementInfo(target),
                position: {
                    x: e.clientX,          // ТОЛЬКО пиксели от окна
                    y: e.clientY           // ТОЛЬКО пиксели от окна
                }
            });
        });
    }

    isClickMeaningful(element) {
        const ignoreTags = ['script', 'style', 'meta', 'link', 'br', 'hr'];
        if (ignoreTags.includes(element.tagName.toLowerCase())) return false;
        
        const hasContent = element.textContent?.trim() || 
                          element.id || 
                          element.className ||
                          element.href ||
                          element.value;
        
        return !!hasContent;
    }

    getElementInfo(element) {
        return {
            tag: element.tagName.toLowerCase(),
            id: element.id || null,
            class: element.className || null, // Все классы
            type: element.type || null,
            name: element.name || null,
            value: element.value ? element.value.substring(0, 50) : null,
            text: element.textContent?.trim().substring(0, 100) || null,
            role: element.getAttribute('role') || null,
            placeholder: element.placeholder || null
        };
    }

    trackScroll() {
        let lastReported = 0;
        const thresholds = [25, 50, 75, 90, 100];
        
        window.addEventListener('scroll', () => {
            const scrolled = window.scrollY;
            const total = document.documentElement.scrollHeight - window.innerHeight;
            const percent = total > 0 ? Math.round((scrolled / total) * 100) : 0;
            
            this.scrollDepth = Math.max(this.scrollDepth, percent);
            
            thresholds.forEach(threshold => {
                if (percent >= threshold && lastReported < threshold) {
                    this.trackEvent('scroll', { 
                        depth: threshold,
                        scroll_position: scrolled,
                        total_scrollable: total
                    });
                    lastReported = threshold;
                }
            });
        }, { passive: true });
    }

    trackForms() {
        // 1. ФОКУС НА ПОЛЕ
        document.addEventListener('focusin', (e) => {
            if (e.target.matches('input, textarea, select')) {
                this.inputStartTime = Date.now();
                this.lastInputValue = e.target.value || '';
                
                this.trackEvent('form_focus', {
                    field: e.target.name || e.target.id || 'field',
                    field_type: e.target.type || 'text',
                    field_id: e.target.id || null,
                    field_name: e.target.name || null,
                    placeholder: e.target.placeholder || null,
                    initial_value: this.lastInputValue
                });
            }
        });

        // 2. ВВОД ТЕКСТА
        if (this.config.trackFormInput) {
            document.addEventListener('input', (e) => {
                if (e.target.matches('input[type="text"], input[type="email"], input[type="tel"], input[type="number"], textarea')) {
                    clearTimeout(this.inputTimeout);
                    
                    this.inputTimeout = setTimeout(() => {
                        const currentValue = e.target.value || '';
                        const changed = currentValue !== this.lastInputValue;
                        
                        if (changed && currentValue.length > 0) {
                            this.trackEvent('form_input', {
                                field: e.target.name || e.target.id || 'field',
                                field_type: e.target.type || 'text',
                                value_length: currentValue.length,
                                time_since_focus: Date.now() - this.inputStartTime,
                                has_content: currentValue.trim().length > 0
                            });
                            
                            this.lastInputValue = currentValue;
                        }
                    }, this.config.inputDebounceDelay);
                }
            });
        }

        // 3. ПОТЕРЯ ФОКУСА
        document.addEventListener('focusout', (e) => {
            if (e.target.matches('input, textarea, select')) {
                const currentValue = e.target.value || '';
                const timeInField = Date.now() - this.inputStartTime;
                
                if (currentValue !== this.lastInputValue && currentValue.length > 0) {
                    this.trackEvent('form_blur', {
                        field: e.target.name || e.target.id || 'field',
                        field_type: e.target.type || 'text',
                        value_length: currentValue.length,
                        time_in_field: timeInField,
                        was_modified: currentValue !== (e.target.defaultValue || '')
                    });
                }
            }
        });

        // 4. ОТПРАВКА ФОРМЫ
        document.addEventListener('submit', (e) => {
            const form = e.target;
            const inputs = form.querySelectorAll('input, textarea, select');
            const filled = Array.from(inputs).filter(i => i.value?.trim()).length;
            
            // Собираем данные полей (без чувствительной информации)
            const fieldData = Array.from(inputs).map(input => ({
                type: input.type,
                name: input.name || 'unnamed',
                filled: !!input.value?.trim(),
                value_length: input.value ? input.value.length : 0
            }));
            
            this.trackEvent('form_submit', {
                form_id: form.id || 'form',
                form_class: form.className || null,
                fields_total: inputs.length,
                fields_filled: filled,
                completion_rate: Math.round((filled / inputs.length) * 100),
                field_types: fieldData
            });
        });
    }

    // Отслеживание ошибок JavaScript
    trackErrors() {
        // Ошибки JavaScript
        window.addEventListener('error', (e) => {
            this.trackEvent('js_error', {
                message: e.message.substring(0, 200),
                filename: e.filename || 'unknown',
                lineno: e.lineno || 'unknown',
                colno: e.colno || 'unknown',
                error_type: 'runtime_error'
            });
        });

        // Ошибки Promise
        window.addEventListener('unhandledrejection', (e) => {
            this.trackEvent('promise_error', {
                reason: String(e.reason).substring(0, 200),
                error_type: 'promise_rejection'
            });
        });

        // Ошибки загрузки ресурсов
        window.addEventListener('error', (e) => {
            const target = e.target;
            if (target && (target.tagName === 'IMG' || target.tagName === 'SCRIPT' || target.tagName === 'LINK')) {
                this.trackEvent('resource_error', {
                    element: target.tagName.toLowerCase(),
                    src: target.src || target.href || 'unknown',
                    error_type: 'resource_load_error'
                });
            }
        }, true);
    }

    // ========== ОСНОВНОЙ МЕТОД ==========
    trackEvent(name, properties = {}) {
        const event = {
            event_id: 'e_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            event_name: name,
            timestamp: new Date().toISOString(),
            user_id: this.userId,
            session_id: this.sessionId,
            ab_group: this.abTestGroup,
            page: window.location.pathname,
            page_url: window.location.href,
            properties: properties
        };

        this.eventQueue.push(event);

        if (this.config.debug) {
            console.log(`[Track] ${name} (группа ${this.abTestGroup})`, properties);
        }

        if (this.eventQueue.length >= this.config.batchSize) {
            this.flushQueue();
        }

        return event;
    }

    // ========== ОТПРАВКА ==========
    flushQueue(force = false) {
        if (!this.eventQueue.length && !force) return;

        const events = [...this.eventQueue];
        
        fetch(this.config.apiEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(events),
            keepalive: force
        })
        .then(() => {
            this.eventQueue = [];
            if (this.config.debug) {
                console.log(`✅ Отправлено ${events.length} событий`);
            }
        })
        .catch(error => {
            console.warn('Ошибка отправки:', error);
            this.saveToLocalStorage(events);
        });
    }

    saveToLocalStorage(events) {
        try {
            const failed = JSON.parse(localStorage.getItem('ab_failed_events') || '[]');
            failed.push(...events.map(e => ({
                ...e,
                _failed_at: new Date().toISOString()
            })));
            
            if (failed.length > 50) failed.splice(0, failed.length - 50);
            localStorage.setItem('ab_failed_events', JSON.stringify(failed));
        } catch (e) {
            console.error('Ошибка сохранения:', e);
        }
    }

    retryFailedEvents() {
        try {
            const failed = JSON.parse(localStorage.getItem('ab_failed_events') || '[]');
            if (failed.length > 0) {
                console.log(`🔄 Повторная отправка ${failed.length} событий`);
                this.flushQueue(true);
                localStorage.removeItem('ab_failed_events');
            }
        } catch (e) {
            console.error('Ошибка повторной отправки:', e);
        }
    }

    // ========== PUBLIC API ==========
    trackConversion(name, value = 1, data = {}) {
        return this.trackEvent('conversion_' + name, { 
            value: value,
            ...data 
        });
    }

    trackCustomEvent(name, properties = {}) {
        return this.trackEvent(name, properties);
    }

    getInfo() {
        return {
            user: this.userId,
            group: this.abTestGroup,
            session: this.sessionId,
            device: this.getDeviceInfo(),
            page: window.location.href,
            events_in_queue: this.eventQueue.length
        };
    }
}

// ========== АВТОМАТИЧЕСКАЯ ИНИЦИАЛИЗАЦИЯ ==========
if (typeof window !== 'undefined') {
    setTimeout(() => {
        window.abTracker = new AbTestTracker();
        
        // Хелперы для ручного трекинга
        window.trackEvent = (name, props) => window.abTracker?.trackEvent(name, props);
        window.trackConversion = (name, value, data) => 
            window.abTracker?.trackConversion(name, value, data);
        
        console.log('✅ A/B Tracker PRO готов');
        
        // Повторная отправка сохранённых событий
        setTimeout(() => window.abTracker?.retryFailedEvents(), 3000);
    }, 100);
}