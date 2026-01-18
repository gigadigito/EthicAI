// interop/blazor.ts

import { updateWorkerDashboard } from "../dashboard/index";

// expõe função global pro Blazor
declare global {
    interface Window {
        updateWorkerDashboard: (data: any) => void;
    }
}

window.updateWorkerDashboard = (data: any) => {
    updateWorkerDashboard(data);
};
