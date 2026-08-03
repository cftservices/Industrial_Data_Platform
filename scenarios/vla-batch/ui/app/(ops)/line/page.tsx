import { Suspense } from "react";
import { LineOverview } from "@/components/screens/LineOverview";

export const metadata = { title: "Lijn Vla, DairyWorks" };

export default function LinePage() {
  return (
    <Suspense>
      <LineOverview />
    </Suspense>
  );
}
