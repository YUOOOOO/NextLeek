import { createBrowserRouter, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Auth } from "./pages/Auth";
import { Dashboard } from "./pages/Dashboard";
import { GeneralSettings, Settings } from "./pages/Settings";
import { Users } from "./pages/Users";

export const router = createBrowserRouter([
  { path: "/login", element: <Auth /> },
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Dashboard /> },
      {
        path: "settings",
        element: <Settings />,
        children: [
          { index: true, element: <GeneralSettings /> },
          { path: "users", element: <Users /> },
        ],
      },
      { path: "users", element: <Navigate to="/settings/users" replace /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
