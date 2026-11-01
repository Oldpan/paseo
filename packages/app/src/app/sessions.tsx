import { BigbangPage } from "@/bigbang/page-frame";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { SessionsScreen } from "@/screens/sessions-screen";

export default function SessionsRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <BigbangPage>
        <SessionsScreen />
      </BigbangPage>
    </HostRouteBootstrapBoundary>
  );
}
