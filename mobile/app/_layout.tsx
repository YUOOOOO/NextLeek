import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerStyle: { backgroundColor: "#08111f" }, headerTintColor: "#ffffff", contentStyle: { backgroundColor: "#08111f" } }} />
    </>
  );
}
