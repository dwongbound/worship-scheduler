// Route-level loading UI: Next.js renders this during Suspense while a
// segment loads. Shows the full-screen worship splash.
import LoadingScreen from "@/components/common/LoadingScreen";

export default function Loading() {
  return <LoadingScreen />;
}
