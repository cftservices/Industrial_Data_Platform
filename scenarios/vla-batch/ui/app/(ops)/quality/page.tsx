import { Suspense } from "react";
import { QualityScreen } from "@/components/screens/QualityScreen";

export const metadata = { title: "Kwaliteit, DairyWorks Vla" };

export default function QualityPage() {
  return (
    <Suspense>
      <QualityScreen />
    </Suspense>
  );
}
