import "./index.css";

import { routeTree } from "./routeTree.gen";
import {
  createHashHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const hashHistory = createHashHistory();
const queryClient = new QueryClient();

const router = createRouter({
  routeTree,
  history: hashHistory,
  context: { queryClient },
  defaultPreload: "intent",
  // Since we're using React Query, we don't want loader calls to ever be stale
  // This will ensure that the loader is always called when the route is preloaded or visited
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

export default App;
