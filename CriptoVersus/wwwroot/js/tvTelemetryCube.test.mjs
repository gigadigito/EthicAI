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
            },
            onRefreshCharts(receivedPayload) {
                assert.equal(receivedPayload, payload);
            }
        });

        controller.init("cube-shell", 5000);
        controller.setFace(2, "test");

        assert.ok(cubeClassList.added.includes("is-face-2"));
        assert.equal(controller.getState().faceIndex, 2);
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
        assert.equal(controller.getState().faceIndex, 5);
    });
}

function testClickRotatesCubeOneFace() {
    withFakeDom(({ cubeClassList, listeners }) => {
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
        listeners.click?.();

        assert.ok(cubeClassList.added.includes("is-face-1"));
        assert.equal(controller.getState().faceIndex, 1);
    });
}

function testReinitSameShellRestartsMissingTimerWithoutDuplicatingActiveOne() {
    withFakeDom(({ intervals }) => {
        const controller = createTelemetryCubeController({
            isReducedMotion: () => false,
            throttleKey() {
                return false;
            },
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
        assert.equal(intervals.length, 1);

        const state = controller.getState();
        state.timerId = null;
        state.paused = false;

        controller.init("cube-shell", 5000);
        assert.equal(intervals.length, 2);
    });
}

function testSetFaceAddsSettledRefreshAfterImmediateRefresh() {
    withFakeDom(({ cubeListeners }) => {
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
            }
        });

        controller.init("cube-shell", 5000);
        controller.setFace(2, "test-settled");

        cubeListeners.transitionend?.({
            target: controller.getState().cube,
            propertyName: "transform"
        });

        assert.equal(controller.getState().faceIndex, 2);
    });
}

testInitCubeSchedulesContainerRetryWhenChartsAreMissing();
testSetFaceRefreshesChartsAndAppliesCssClass();
testNotifyGoalHoldsRotationAndSwitchesFace();
testClickRotatesCubeOneFace();
testReinitSameShellRestartsMissingTimerWithoutDuplicatingActiveOne();
testSetFaceAddsSettledRefreshAfterImmediateRefresh();
console.log("tvTelemetryCube tests passed");
