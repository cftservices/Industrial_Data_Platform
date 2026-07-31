import { Suspense } from "react";
import { ManagementOverview } from "@/components/screens/ManagementOverview";

export const metadata = { title: "Management, DairyWorks Vla" };

export default function ManagementPage() {
  // useSearchParams vereist een Suspense-grens bij statische prerendering.
  return (
    <Suspense>
      <ManagementOverview />
    </Suspense>
  );
}
