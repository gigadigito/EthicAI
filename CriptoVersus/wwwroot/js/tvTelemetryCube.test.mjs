import assert from "node:assert/strict";

import { createTelemetryCubeController } from "./tvTelemetryCube.mjs";

function createFakeClassList() {
    return {
        added: [],
        removed: [],
        remove(...tokens) {
            this.removed.push(...tokens);
        },
        add(token) {
            this.added.push(token);
        },
        toggle() {
        }
    };
}

function withFakeDom(run) {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;

    const timers = [];
    const intervals = [];
    const listeners = {};
    const cubeListeners = {};
    const cubeClassList = createFakeClassList();
    const shell = {
        dataset: {},
        classList: createFakeClassList(),
        querySelector(selector) {
            if (selector === ".tv-telemetry-cube") {
                return cube;
            }

            return null;
        },
        addEventListener(type, handler) {
            listeners[type] = handler;
        }
    };
    const cube = {
        classList: cubeClassList,
        addEventListener(type, handler) {
            cubeListeners[type] = handler;
        }
    };

    globalThis.window = {
        innerWidth: 1280,
        setTimeout(handler, delay) {
            timers.push(delay);
            handler();
            return timers.length;
        },
        clearTimeout() {
        },
        setInterval(handler, delay) {
            intervals.push(delay);
            return intervals.length;
        },
        clearInterval() {
        },
        addEventListener(type, handler) {
            listeners[type] = handler;
        }
    };

    globalThis.document = {
        hidden: false,
        getElementById(id) {
            return id === "cube-shell" ? shell : null;
        }
    };

    try {
        run({ shell, cube, cubeClassList, timers, intervals, listeners, cubeListeners });
    } finally {
        globalThis.window = originalWindow;
        globalThis.document = originalDocument;
    }
}

function testInitCubeSchedulesContainerRetryWhenChartsAreMissing() {
    withFakeDom(() => {
        let scheduledReason = null;
        const controller = createTelemetryCubeController({
            isReducedMotion: () => false,
            throttleKey: () => false,
            logCube() {
            },
            logChart() {
            },
            hasChartContainers: () => false,
            scheduleContainerRetry(reason) {
                scheduledReason = reason;
            },
            getLastPayload: () => null,
            onResizeCharts() {
            },
            onRefreshCharts() {
            }
        });

        controller.init("cube-shell", 5000);
        assert.equal(scheduledReason, "initTelemetryCube");
    });
}

function testSetFaceRefreshesChartsAndAppliesCssClass() {
    withFakeDom(({ cubeClassList, timers }) => {
        let resizeCalls = 0;
        let refreshCalls = 0;
        const payload = { left: [{ time: 1, value: 1 }] };
        const controller = createTelemetryCubeController({
            isReducedMotion: () => false,
            throttleKey: () => true,
            logCube() {
            },
            logChart() {
            },
            hasChartContainers: () => true,
            scheduleContainerRetry() {
            },
            getLastPayload: () => payload,
            onResizeCharts() {
                resizeCalls += 1;
            },
            onRefreshCharts(receivedPayload) {
                refreshCalls += 1;
                assert.equal(receivedPayload, payload);
            }
        });

        controller.init("cube-shell", 5000);
        controller.setFace(2, "test");

        assert.ok(cubeClassList.added.includes("is-face-2"));
        assert.ok(timers.includes(0));
        assert.ok(resizeCalls >= 4);
        assert.ok(refreshCalls >= 1);
    });
}

function testNotifyGoalHoldsRotationAndSwitchesFace() {
    withFakeDom(({ cubeClassList }) => {
        const controller = createTelemetryCubeController({
            isReducedMotion: () => false,
            throttleKey: () => false,
            logCube() {
            },
            logChart() {
            },
            hasChartContainers: () => true,
            scheduleContainerRetry() {
            },
            getLastPayload: () => null,
            onResizeCharts() {
            },
            onRefreshCharts() {
            }
        });

        controller.init("cube-shell", 5000);
        controller.notify("goal");

        assert.ok(cubeClassList.added.includes("is-face-5"));
    });
}

function testClickRotatesCubeOneFace() {
    withFakeDom(({ cubeClassList, listeners }) => {
        let refreshCalls = 0;
        const payload = { left: [{ time: 1, value: 1 }] };
        const controller = createTelemetryCubeController({
            isReducedMotion: () => false,
            throttleKey: () => false,
            logCube() {
            },
            logChart() {
            },
            hasChartContainers: () => true,
            scheduleContainerRetry() {
            },
            getLastPayload: () => payload,
            onResizeCharts() {
            },
            onRefreshCharts() {
                refreshCalls += 1;
            }
        });

        controller.init("cube-shell", 5000);
        listeners.click?.();

        assert.ok(cubeClassList.added.includes("is-face-1"));
        assert.equal(controller.getState().faceIndex, 1);
        assert.ok(refreshCalls >= 1);
    });
}

function testSetFaceAddsSettledRefreshAfterImmediateRefresh() {
    withFakeDom(({ cubeListeners }) => {
        let refreshCalls = 0;
        const payload = { left: [{ time: 1, value: 1 }] };
        const controller = createTelemetryCubeController({
            isReducedMotion: () => false,
            throttleKey: () => false,
            logCube() {
            },
            logChart() {
            },
            hasChartContainers: () => true,
            scheduleContainerRetry() {
            },
            getLastPayload: () => payload,
            onResizeCharts() {
            },
            onRefreshCharts() {
                refreshCalls += 1;
            }
        });

        controller.init("cube-shell", 5000);
        const beforeSetFace = refreshCalls;
        controller.setFace(2, "test-settled");
        assert.ok(refreshCalls >= beforeSetFace + 2);

        const beforeTransition = refreshCalls;
        cubeListeners.transitionend?.({
            target: controller.getState().cube,
            propertyName: "transform"
        });

        assert.equal(refreshCalls, beforeTransition);
    });
}

testInitCubeSchedulesContainerRetryWhenChartsAreMissing();
testSetFaceRefreshesChartsAndAppliesCssClass();
testNotifyGoalHoldsRotationAndSwitchesFace();
testClickRotatesCubeOneFace();
testSetFaceAddsSettledRefreshAfterImmediateRefresh();
console.log("tvTelemetryCube tests passed");
