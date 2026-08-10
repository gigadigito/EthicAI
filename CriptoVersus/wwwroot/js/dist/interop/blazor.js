// interop/blazor.ts
import { updateWorkerDashboard } from "../dashboard/index";
window.updateWorkerDashboard = (data) => {
    updateWorkerDashboard(data);
};
