import { Suspense } from "react";
import { PlantOverview } from "@/components/screens/PlantOverview";

export const metadata = { title: "DairyWorks Vla" };

export default function Home() {
  return (
    <Suspense>
      <PlantOverview />
    </Suspense>
  );
}
