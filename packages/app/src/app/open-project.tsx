import { useEffect } from "react";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { OpenProjectScreen } from "@/screens/open-project-screen";
import { IS_BIGBANG } from "@/bigbang/build";
import { returnToBigbang } from "@/bigbang/navigation";

export default function OpenProjectRoute() {
  if (IS_BIGBANG) return <StudioHomeHandoff />;
  return (
    <HostRouteBootstrapBoundary>
      <OpenProjectScreen />
    </HostRouteBootstrapBoundary>
  );
}

/** Bigbang's Studio home replaces this page; every fallback that lands here goes there. */
function StudioHomeHandoff() {
  useEffect(() => returnToBigbang("studio"), []);
  return null;
}
