import { PavraPage } from "@/pavra/page-frame";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { SessionsScreen } from "@/screens/sessions-screen";

export default function SessionsRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <PavraPage>
        <SessionsScreen />
      </PavraPage>
    </HostRouteBootstrapBoundary>
  );
}
