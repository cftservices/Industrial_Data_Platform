import { Suspense } from "react";
import { AlarmsScreen } from "@/components/screens/AlarmsScreen";

export const metadata = { title: "Alarmen, DairyWorks Vla" };

export default function AlarmsPage() {
  return (
    <Suspense>
      <AlarmsScreen />
    </Suspense>
  );
}
