import { PavraPage } from "@/pavra/page-frame";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { SchedulesScreen } from "@/screens/schedules-screen";

export default function SchedulesRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <PavraPage>
        <SchedulesScreen />
      </PavraPage>
    </HostRouteBootstrapBoundary>
  );
}
