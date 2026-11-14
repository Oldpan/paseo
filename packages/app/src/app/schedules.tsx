import { IS_PAVRA } from "@/pavra/build";
import { PavraPage } from "@/pavra/page-frame";
import { RoutinesSection } from "@/pavra/ui/RoutinesSection";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { SchedulesScreen } from "@/screens/schedules-screen";

export default function SchedulesRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <PavraPage>
        {IS_PAVRA ? <RoutinesSection /> : null}
        <SchedulesScreen />
      </PavraPage>
    </HostRouteBootstrapBoundary>
  );
}
