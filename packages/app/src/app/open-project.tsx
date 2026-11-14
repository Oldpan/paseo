import { useEffect } from "react";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { OpenProjectScreen } from "@/screens/open-project-screen";
import { IS_PAVRA } from "@/pavra/build";
import { returnToPavra } from "@/pavra/navigation";

export default function OpenProjectRoute() {
  if (IS_PAVRA) return <StudioHomeHandoff />;
  return (
    <HostRouteBootstrapBoundary>
      <OpenProjectScreen />
    </HostRouteBootstrapBoundary>
  );
}

/** Pavra's Studio home replaces this page; every fallback that lands here goes there. */
function StudioHomeHandoff() {
  useEffect(() => returnToPavra("studio"), []);
  return null;
}
