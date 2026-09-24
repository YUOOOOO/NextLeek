import { createBrowserRouter, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Auth } from "./pages/Auth";
import { Data } from "./pages/Data";
import { DataSources } from "./pages/DataSources";
import { GeneralSettings, Settings } from "./pages/Settings";
import { Strategies } from "./pages/Strategies";
import { Factors } from "./pages/Factors";
import { Monitor } from "./pages/Monitor";
import { News } from "./pages/News";
import { Users } from "./pages/Users";
import { AiSettings } from "./pages/AiSettings";

export const router = createBrowserRouter([
  { path: "/login", element: <Auth /> },
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/strategies" replace /> },
      { path: "strategies", element: <Strategies /> },
      { path: "factors", element: <Factors /> },
      { path: "monitor", element: <Monitor /> },
      { path: "news", element: <News /> },
      { path: "data", element: <Data /> },
      {
        path: "settings",
        element: <Settings />,
        children: [
          { index: true, element: <GeneralSettings /> },
          { path: "data", element: <DataSources /> },
          { path: "ai", element: <AiSettings /> },
          { path: "users", element: <Users /> },
        ],
      },
      { path: "users", element: <Navigate to="/settings/users" replace /> },
      { path: "*", element: <Navigate to="/strategies" replace /> },
    ],
  },
]);
