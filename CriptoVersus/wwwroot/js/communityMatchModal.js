window.CriptoVersusCommunityMatch = (() => {
    const captchaWidgets = new Map();
    const focusHandlers = new Map();

    function lockBodyScroll() {
        document.body.classList.add('community-match-modal-open');
    }

    function unlockBodyScroll() {
        document.body.classList.remove('community-match-modal-open');
    }

    function focusFirstInteractive(modal) {
        if (!modal) {
            return;
        }

        const focusable = modal.querySelector('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
        if (focusable) {
            focusable.focus();
        }
    }

    function renderCaptcha(captchaId, dotnetRef, siteKey) {
        if (!captchaId || !siteKey || !window.turnstile) {
            return;
        }

        const container = document.getElementById(captchaId);
        if (!container || container.dataset.rendered === '1') {
            return;
        }

        container.dataset.rendered = '1';
        const widgetId = window.turnstile.render(container, {
            sitekey: siteKey,
            theme: 'dark',
            callback: token => dotnetRef.invokeMethodAsync('OnCaptchaSuccess', token),
            'expired-callback': () => dotnetRef.invokeMethodAsync('OnCaptchaExpired'),
            'error-callback': () => dotnetRef.invokeMethodAsync('OnCaptchaError', 'captcha-error')
        });

        captchaWidgets.set(captchaId, widgetId);
    }

    function mount(modalId, captchaId, dotnetRef, siteKey, openerButtonId) {
        const modal = document.getElementById(modalId);
        if (!modal) {
            return;
        }

        lockBodyScroll();
        renderCaptcha(captchaId, dotnetRef, siteKey);

        const handler = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                dotnetRef.invokeMethodAsync('RequestCloseFromJs');
                return;
            }

            if (event.key !== 'Tab') {
                return;
            }

            const selectors = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
            const focusables = [...modal.querySelectorAll(selectors)].filter(el => el.offsetParent !== null);
            if (focusables.length === 0) {
                return;
            }

            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            const active = document.activeElement;

            if (event.shiftKey && active === first) {
                last.focus();
                event.preventDefault();
            } else if (!event.shiftKey && active === last) {
                first.focus();
                event.preventDefault();
            }
        };

        modal.addEventListener('keydown', handler);
        focusHandlers.set(modalId, handler);
        window.setTimeout(() => focusFirstInteractive(modal), 0);
    }

    function unmount(modalId, openerButtonId) {
        const modal = document.getElementById(modalId);
        const handler = focusHandlers.get(modalId);
        if (modal && handler) {
            modal.removeEventListener('keydown', handler);
        }

        focusHandlers.delete(modalId);
        unlockBodyScroll();

        const opener = document.getElementById(openerButtonId);
        if (opener) {
            opener.focus();
        }
    }

    function getCaptchaToken(captchaId) {
        const container = document.getElementById(captchaId);
        const input = container?.querySelector('input[name="cf-turnstile-response"]');
        return input?.value || '';
    }

    function resetCaptcha(captchaId) {
        const widgetId = captchaWidgets.get(captchaId);
        if (widgetId !== undefined && window.turnstile) {
            window.turnstile.reset(widgetId);
        }
    }

    return {
        mount,
        unmount,
        getCaptchaToken,
        resetCaptcha
    };
})();
