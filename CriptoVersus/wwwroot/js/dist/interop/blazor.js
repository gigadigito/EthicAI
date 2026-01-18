// interop/blazor.ts
import { updateWorkerDashboard } from "../dashboard/index.js";
window.updateWorkerDashboard = (data) => {
    updateWorkerDashboard(data);
};
