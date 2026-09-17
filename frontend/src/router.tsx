import { createBrowserRouter, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Auth } from "./pages/Auth";
import { Dashboard } from "./pages/Dashboard";
import { Data } from "./pages/Data";
import { DataSources } from "./pages/DataSources";
import { GeneralSettings, Settings } from "./pages/Settings";
import { Strategies } from "./pages/Strategies";
import { Factors } from "./pages/Factors";
import { AiSettings } from "./pages/AiSettings";
import { Users } from "./pages/Users";

export const router = createBrowserRouter([
  { path: "/login", element: <Auth /> },
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "strategies", element: <Strategies /> },
      { path: "factors", element: <Factors /> },
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
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
