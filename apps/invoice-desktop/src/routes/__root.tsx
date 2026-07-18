import {
  Link,
  Outlet,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { SyncProvider } from "@/components/sync-provider";
import { ThemeProvider } from "@/contexts/theme-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import OnlineFooter from "@/components/online-footer";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  component: RootComponent,
  notFoundComponent: () => {
    return (
      <div>
        <p>This is the notFoundComponent configured on root route</p>
        <Link to="/">Start Over</Link>
      </div>
    );
  },
});

function RootComponent() {
  return (
    <main>
      <SyncProvider>
        <ThemeProvider storageKey="theme">
          <TooltipProvider>
            <Outlet />
            <ReactQueryDevtools buttonPosition="bottom-right" />
            <TanStackRouterDevtools position="bottom-right" />
            <OnlineFooter />
          </TooltipProvider>
        </ThemeProvider>
      </SyncProvider>
    </main>
  );
}
