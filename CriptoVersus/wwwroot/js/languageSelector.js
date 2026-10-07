let active = null;

function handlePointerDown(event) {
    if (active && !active.element.contains(event.target)) {
        active.dotnet.invokeMethodAsync('CloseFromOutsideAsync');
        unregisterOutsideClick(active.element);
    }
}

export function registerOutsideClick(element, dotnet) {
    if (active && active.element !== element) {
        active.dotnet.invokeMethodAsync('CloseFromOutsideAsync');
    }

    unregisterOutsideClick();
    active = { element, dotnet };
    document.addEventListener('pointerdown', handlePointerDown, true);
}

export function unregisterOutsideClick(element) {
    if (element && active && active.element !== element) {
        return;
    }

    document.removeEventListener('pointerdown', handlePointerDown, true);
    active = null;
}
