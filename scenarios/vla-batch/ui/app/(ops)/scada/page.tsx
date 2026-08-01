import { Suspense } from "react";
import { Scada } from "@/components/screens/Scada";

export const metadata = { title: "SCADA, DairyWorks Vla" };

export default function ScadaPage() {
  return (
    <Suspense>
      <Scada />
    </Suspense>
  );
}
