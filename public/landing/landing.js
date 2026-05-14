(function () {
    const visual = document.querySelector('[data-hero-visual]');
    if (!visual) return;

    const prefersReduced =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced) {
        visual.classList.add('is-visible');
        return;
    }

    function reveal() {
        visual.classList.add('is-visible');
    }

    if (typeof IntersectionObserver !== 'function') {
        reveal();
        return;
    }

    const io = new IntersectionObserver(
        function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                reveal();
                io.disconnect();
            });
        },
        { root: null, rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );

    io.observe(visual);

    requestAnimationFrame(function () {
        const rect = visual.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) {
            reveal();
            io.disconnect();
        }
    });
})();
